import { prisma } from '@/server/db/prisma';
import { requireScheduleEditor } from '@/server/auth/schedule-edit';
import {
  backfillSiteCompanyName,
  ensurePartnerByName,
  findMatchingSite,
  normalizeOptionalRegistryText,
  normalizeRegistryText,
} from '@/server/site-registry';
import { z } from 'zod';
import * as XLSX from 'xlsx';

export const runtime = 'nodejs';

const QuerySchema = z
  .object({
    kind: z.enum(['normal', 'daily']).optional(),
  })
  .passthrough();

type ImportedSiteRow = {
  companyName: string | null;
  name: string;
};

const COMPANY_HEADERS = ['請求先', '請求先名', '会社名', '会社', '取引先', '得意先'];
const SITE_HEADERS = ['件名', '現場名', '現場', '現場名称', '工事件名'];

function normalizeHeader(input: string | null | undefined) {
  return normalizeRegistryText(input).replace(/\s+/g, '').toLocaleLowerCase('ja-JP');
}

function looksLikeHeader(value: string) {
  const text = normalizeRegistryText(value);
  if (!text) return true;
  const lowered = text.toLocaleLowerCase('ja-JP');
  const banned = new Set([
    '月',
    '火',
    '水',
    '木',
    '金',
    '土',
    '日',
    '曜日',
    '日付',
    '日程',
    '予定',
    '担当',
    '氏名',
    '名前',
    '請求先',
    '件名',
    'am',
    'pm',
    '午前',
    '午後',
    '休',
    '休み',
    '休日',
    '備考',
    'メモ',
  ]);
  if (banned.has(lowered)) return true;
  if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$/.test(text)) return true;
  if (/^\d{1,2}[:：]\d{2}/.test(text)) return true;
  if (/^\d+$/.test(text)) return true;
  return false;
}

function toCellText(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function findColumnIndex(row: unknown[], headerCandidates: string[]) {
  const normalizedCandidates = headerCandidates.map((header) => normalizeHeader(header));
  for (let column = 0; column < row.length; column++) {
    const header = normalizeHeader(toCellText(row[column]));
    if (!header) continue;
    if (
      normalizedCandidates.some(
        (candidate) => header === candidate || header.includes(candidate) || candidate.includes(header),
      )
    ) {
      return column;
    }
  }
  return -1;
}

function extractFallbackRows(grid: unknown[][]) {
  const names: ImportedSiteRow[] = [];
  const headerRows = Math.min(20, grid.length);
  let bestCol: number | null = null;
  let bestScore = 0;

  for (let rowIndex = 0; rowIndex < headerRows; rowIndex++) {
    const row = grid[rowIndex] ?? [];
    for (let column = 0; column < row.length; column++) {
      const text = normalizeRegistryText(toCellText(row[column]));
      if (!text) continue;
      if (SITE_HEADERS.some((header) => text === header || text.includes(header))) {
        const score = (text === '件名' || text === '現場名' ? 5 : 3) + (20 - rowIndex);
        if (score > bestScore) {
          bestScore = score;
          bestCol = column;
        }
      }
    }
  }

  if (bestCol != null) {
    let emptyRun = 0;
    for (let rowIndex = 0; rowIndex < grid.length; rowIndex++) {
      const row = grid[rowIndex] ?? [];
      const name = normalizeRegistryText(toCellText(bestCol < row.length ? row[bestCol] : ''));
      if (!name || looksLikeHeader(name)) {
        emptyRun++;
        if (emptyRun >= 10 && rowIndex > 10) break;
        continue;
      }
      emptyRun = 0;
      names.push({ companyName: null, name });
    }
  }

  if (names.length > 0) return names;

  for (const row of grid) {
    for (const cell of row ?? []) {
      const name = normalizeRegistryText(toCellText(cell));
      if (!name || looksLikeHeader(name)) continue;
      if (name.length < 2 || name.length > 80) continue;
      names.push({ companyName: null, name });
    }
  }

  return names;
}

function consolidateRows(rows: ImportedSiteRow[]) {
  const grouped = new Map<string, ImportedSiteRow[]>();
  for (const row of rows) {
    const name = normalizeRegistryText(row.name);
    const companyName = normalizeOptionalRegistryText(row.companyName);
    if (!name) continue;
    const key = normalizeHeader(name);
    const items = grouped.get(key) ?? [];
    items.push({ companyName, name });
    grouped.set(key, items);
  }

  const consolidated: ImportedSiteRow[] = [];
  for (const items of grouped.values()) {
    const withCompany = items.filter((item) => !!normalizeHeader(item.companyName));
    if (withCompany.length > 0) {
      const seenCompany = new Set<string>();
      for (const item of withCompany) {
        const companyKey = normalizeHeader(item.companyName);
        if (seenCompany.has(companyKey)) continue;
        seenCompany.add(companyKey);
        consolidated.push(item);
      }
      continue;
    }

    const first = items[0];
    if (first) consolidated.push(first);
  }

  return consolidated;
}

function extractSiteRowsFromGrid(grid: unknown[][]) {
  const headerRows = Math.min(40, grid.length);
  let headerIndex = -1;
  let companyCol = -1;
  let siteCol = -1;

  for (let rowIndex = 0; rowIndex < headerRows; rowIndex++) {
    const row = grid[rowIndex] ?? [];
    const candidateSiteCol = findColumnIndex(row, SITE_HEADERS);
    if (candidateSiteCol < 0) continue;
    headerIndex = rowIndex;
    siteCol = candidateSiteCol;
    companyCol = findColumnIndex(row, COMPANY_HEADERS);
    break;
  }

  if (siteCol < 0) {
    return extractFallbackRows(grid);
  }

  const rows: ImportedSiteRow[] = [];
  let emptyRun = 0;
  for (let rowIndex = headerIndex + 1; rowIndex < grid.length; rowIndex++) {
    const row = grid[rowIndex] ?? [];
    const name = normalizeRegistryText(toCellText(siteCol < row.length ? row[siteCol] : ''));
    const companyName = normalizeOptionalRegistryText(
      companyCol >= 0 && companyCol < row.length ? toCellText(row[companyCol]) : '',
    );

    if (!name || looksLikeHeader(name)) {
      if (!companyName) {
        emptyRun++;
        if (emptyRun >= 12 && rowIndex > headerIndex + 3) break;
      }
      continue;
    }

    emptyRun = 0;
    rows.push({ companyName, name });
  }

  return rows.length > 0 ? rows : extractFallbackRows(grid);
}

export async function POST(request: Request) {
  const authError = await requireScheduleEditor(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const parsedQuery = QuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  const kind = parsedQuery.success && parsedQuery.data.kind === 'daily' ? 'DAILY' : 'NORMAL';

  const form = await request.formData().catch(() => null);
  if (!form) {
    return Response.json({ ok: false, error: 'Invalid form' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: 'file is required' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const extractedRows: ImportedSiteRow[] = [];
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    for (const sheetName of workbook.SheetNames ?? []) {
      const sheet = workbook.Sheets?.[sheetName];
      if (!sheet) continue;
      const grid = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        blankrows: false,
        defval: '',
      }) as unknown[][];
      extractedRows.push(...extractSiteRowsFromGrid(grid));
      if (extractedRows.length >= 4000) break;
    }
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to parse Excel' },
      { status: 400 },
    );
  }

  const rows = consolidateRows(extractedRows);
  if (rows.length === 0) {
    return Response.json({ ok: true, kind, created: 0, matched: 0, skipped: 0, total: 0, rows: [] });
  }

  let created = 0;
  let matched = 0;
  let partnersCreated = 0;
  let partnersMatched = 0;
  let companyBackfilled = 0;

  for (const row of rows) {
    if (row.companyName) {
      const partner = await ensurePartnerByName(row.companyName);
      if (partner.partner) {
        if (partner.created) partnersCreated++;
        else partnersMatched++;
      }
    }

    const duplicate = await findMatchingSite({ companyName: row.companyName, name: row.name, kind });
    if (duplicate.site) {
      matched++;
      if (row.companyName && !duplicate.site.companyName) {
        await backfillSiteCompanyName(duplicate.site.id, row.companyName);
        companyBackfilled++;
      }
      continue;
    }

    await prisma.site.create({
      data: {
        companyName: row.companyName,
        name: row.name,
        kind,
      },
      select: { id: true },
    });
    created++;
  }

  return Response.json({
    ok: true,
    kind,
    created,
    matched,
    skipped: matched,
    total: rows.length,
    partnersCreated,
    partnersMatched,
    companyBackfilled,
    rows: rows.slice(0, 200),
  });
}
