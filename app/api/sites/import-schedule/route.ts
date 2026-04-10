import { prisma } from '@/server/db/prisma';
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

function isAuthorized(request: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return process.env.NODE_ENV !== 'production';
  return request.headers.get('x-admin-token') === token;
}

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
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

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

  let extractedRows: ImportedSiteRow[] = [];
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
}import { prisma } from '@/server/db/prisma';
import { z } from 'zod';
import * as XLSX from 'xlsx';

export const runtime = 'nodejs';
import { prisma } from '@/server/db/prisma';
import {
  backfillSiteCompanyName,
  ensurePartnerByName,
  findMatchingSite,
  normalizeOptionalRegistryText,
  normalizeRegistryText,
} from '@/server/site-registry';
import { z } from 'zod';
import * as XLSX from 'xlsx';

function isAuthorized(request: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return process.env.NODE_ENV !== 'production';
  return request.headers.get('x-admin-token') === token;
}

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

function looksLikeHeader(v: string) {
  const s = normalizeRegistryText(v);
  if (!s) return true;
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
  if (banned.has(s.toLocaleLowerCase('ja-JP'))) return true;
  if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$/.test(s)) return true;
  if (/^\d{1,2}[:：]\d{2}/.test(s)) return true;
  if (/^\d+$/.test(s)) return true;
  return false;
}

function toCellText(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function findColumnIndex(row: unknown[], headerCandidates: string[]) {
  const normalizedCandidates = headerCandidates.map((header) => normalizeHeader(header));
  for (let c = 0; c < row.length; c++) {
    const header = normalizeHeader(toCellText(row[c]));
    if (!header) continue;
    if (normalizedCandidates.some((candidate) => header === candidate || header.includes(candidate) || candidate.includes(header))) {
      return c;
    }
  }
  return -1;
}

function extractFallbackRows(grid: unknown[][]) {
  const names: ImportedSiteRow[] = [];
  const headerRows = Math.min(20, grid.length);
  let bestCol: number | null = null;
  let bestScore = 0;

  for (let r = 0; r < headerRows; r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const s = normalizeRegistryText(toCellText(row[c]));
      if (!s) continue;
      if (SITE_HEADERS.some((header) => s === header || s.includes(header))) {
        const score = (s === '件名' || s === '現場名' ? 5 : 3) + (20 - r);
        if (score > bestScore) {
          bestScore = score;
          bestCol = c;
        }
      }
    }
  }

  if (bestCol != null) {
    let emptyRun = 0;
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r] ?? [];
      const name = normalizeRegistryText(toCellText(bestCol < row.length ? row[bestCol] : ''));
      if (!name || looksLikeHeader(name)) {
        emptyRun++;
        if (emptyRun >= 10 && r > 10) break;
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
    const current = grouped.get(key) ?? [];
    current.push({ companyName, name });
    grouped.set(key, current);
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

  for (let r = 0; r < headerRows; r++) {
    const row = grid[r] ?? [];
    const candidateSiteCol = findColumnIndex(row, SITE_HEADERS);
    if (candidateSiteCol < 0) continue;
    headerIndex = r;
    siteCol = candidateSiteCol;
    companyCol = findColumnIndex(row, COMPANY_HEADERS);
    break;
  }

  if (siteCol < 0) {
    return extractFallbackRows(grid);
  }

  const rows: ImportedSiteRow[] = [];
  let emptyRun = 0;
  for (let r = headerIndex + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const name = normalizeRegistryText(toCellText(siteCol < row.length ? row[siteCol] : ''));
    const companyName = normalizeOptionalRegistryText(
      companyCol >= 0 && companyCol < row.length ? toCellText(row[companyCol]) : '',
    );

    if (!name || looksLikeHeader(name)) {
      if (!companyName) {
        emptyRun++;
        if (emptyRun >= 12 && r > headerIndex + 3) break;
      }
      continue;
    }

    emptyRun = 0;
    rows.push({ companyName, name });
  }

  return rows.length > 0 ? rows : extractFallbackRows(grid);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

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

  const buf = Buffer.from(await file.arrayBuffer());

  let extractedRows: ImportedSiteRow[] = [];
  try {
    const wb = XLSX.read(buf, { type: 'buffer' });
    for (const sheetName of wb.SheetNames ?? []) {
      const sheet = wb.Sheets?.[sheetName];
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
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed to parse Excel' },
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

    const duplicate = await findMatchingSite({
      companyName: row.companyName,
      name: row.name,
      kind,
    });
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

function isAuthorized(request: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return process.env.NODE_ENV !== 'production';
  return request.headers.get('x-admin-token') === token;
}

const QuerySchema = z
  .object({
    kind: z.enum(['normal', 'daily']).optional(),
  })
  .passthrough();

function normalizeSiteName(input: string) {
  const s = (input ?? '')
    .normalize('NFKC')
    .replace(/\u3000/g, ' ')
    .replace(/[\u0000-\u001f]+/g, ' ')
    // normalize dash/minus variants (keep Japanese long vowel mark 'ー' as-is)
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

function looksLikeHeader(v: string) {
  const s = v.trim();
  if (!s) return true;
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
    'AM',
    'PM',
    '午前',
    '午後',
    '休',
    '休み',
    '休日',
    '備考',
    'メモ',
  ]);
  if (banned.has(s)) return true;
  if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$/.test(s)) return true;
  if (/^\d{1,2}[:：]\d{2}/.test(s)) return true;
  if (/^\d+$/.test(s)) return true;
  return false;
}

function extractNamesFromGrid(grid: unknown[][]) {
  const names: string[] = [];

  // Try to locate a column whose header contains "現場".
  const headerRows = Math.min(20, grid.length);
  let bestCol: number | null = null;
  let bestScore = 0;

  for (let r = 0; r < headerRows; r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const raw = row[c];
      const v = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
      const s = normalizeSiteName(v);
      if (!s) continue;
      if (s === '現場' || s === '現場名' || s === '現場名称' || s.includes('現場')) {
        // Score: earlier row + exact match
        const score = (s === '現場' || s === '現場名' ? 5 : 3) + (20 - r);
        if (score > bestScore) {
          bestScore = score;
          bestCol = c;
        }
      }
    }
  }

  if (bestCol != null) {
    let emptyRun = 0;
    for (let r = 0; r < grid.length; r++) {
      const raw = bestCol < (grid[r]?.length ?? 0) ? grid[r]![bestCol] : '';
      const s = normalizeSiteName(typeof raw === 'string' ? raw : raw == null ? '' : String(raw));
      if (!s || looksLikeHeader(s)) {
        emptyRun++;
        if (emptyRun >= 10 && r > 10) break;
        continue;
      }
      emptyRun = 0;
      names.push(s);
    }
  }

  // Fallback: scan all cells.
  if (names.length === 0) {
    for (const row of grid) {
      for (const cell of row ?? []) {
        const s = normalizeSiteName(typeof cell === 'string' ? cell : cell == null ? '' : String(cell));
        if (!s || looksLikeHeader(s)) continue;
        if (s.length < 2 || s.length > 80) continue;
        names.push(s);
      }
    }
  }

  // Normalize + unique preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const x = normalizeSiteName(n);
    if (!x) continue;
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

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

  const buf = Buffer.from(await file.arrayBuffer());

  let names: string[] = [];
  try {
    const wb = XLSX.read(buf, { type: 'buffer' });
    for (const sheetName of wb.SheetNames ?? []) {
      const sheet = wb.Sheets?.[sheetName];
      if (!sheet) continue;
      const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false }) as unknown[][];
      const extracted = extractNamesFromGrid(grid);
      for (const n of extracted) names.push(n);
      if (names.length >= 2000) break;
    }
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed to parse Excel' },
      { status: 400 },
    );
  }

  // Unique again across sheets
  const seen = new Set<string>();
  const normalizedNames: string[] = [];
  for (const n of names) {
    const x = normalizeSiteName(n);
    if (!x) continue;
    if (seen.has(x)) continue;
    seen.add(x);
    normalizedNames.push(x);
  }
  names = normalizedNames;

  if (names.length === 0) {
    return Response.json({ ok: true, created: 0, skipped: 0, total: 0, names: [] });
  }

  // Avoid duplicates within kind by normalized name comparison.
  // (DB does not enforce uniqueness, so we do best-effort skip here.)
  const existingNormalizedSet = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const args: Parameters<typeof prisma.site.findMany>[0] = {
      where: { kind },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
      take: 2000,
    };
    if (cursor) {
      args.cursor = { id: cursor };
      args.skip = 1;
    }

    const batch = await prisma.site.findMany(args);
    for (const s of batch) existingNormalizedSet.add(normalizeSiteName(s.name));
    if (batch.length < 2000) break;
    cursor = batch[batch.length - 1]!.id;
  }

  const toCreate: string[] = [];
  for (const n of names) {
    const x = normalizeSiteName(n);
    if (!x) continue;
    if (existingNormalizedSet.has(x)) continue;
    existingNormalizedSet.add(x);
    toCreate.push(x);
  }

  let created = 0;
  if (toCreate.length > 0) {
    // Create individually to avoid partial failure hiding.
    for (const name of toCreate) {
      await prisma.site.create({ data: { name, kind }, select: { id: true } });
      created++;
    }
  }

  const skipped = names.length - created;

  return Response.json({
    ok: true,
    kind,
    created,
    skipped,
    total: names.length,
    names: names.slice(0, 200),
  });
}
