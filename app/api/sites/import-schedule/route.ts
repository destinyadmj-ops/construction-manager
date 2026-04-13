import { prisma } from '@/server/db/prisma';
import { requireScheduleEditor } from '@/server/auth/schedule-edit';
import {
  ensurePartnerByName,
  findMatchingSite,
  normalizeOptionalRegistryText,
  normalizeRegistryText,
} from '@/server/site-registry';
import { formatPaceText } from '@/shared/pace';
import { z } from 'zod';
import * as XLSX from 'xlsx';

export const runtime = 'nodejs';

const QuerySchema = z
  .object({
    kind: z.enum(['normal', 'daily']).optional(),
  })
  .passthrough();

type ImportedScheduleRow = {
  companyName: string | null;
  name: string;
  workContent: string | null;
  peopleCount: number | null;
  workMonth: string | null;
  condition1: string | null;
  condition2: string | null;
  condition3: string | null;
  condition4: string | null;
  siteType: string | null;
};

type AggregatedSiteImport = {
  companyName: string | null;
  name: string;
  peopleCount: number | null;
  pace: string | null;
  detailSection: string | null;
  rowCount: number;
};

const COMPANY_HEADERS = ['請求先', '請求先名', '会社名', '会社', '取引先', '得意先'];
const SITE_HEADERS = ['件名', '現場名', '現場', '現場名称', '工事件名'];
const WORK_HEADERS = ['作業内容', '作業', '内容'];
const PEOPLE_HEADERS = ['人数', '作業人数', '人員'];
const WORK_MONTH_HEADERS = ['作業月', '実施月', '月スパン', 'ペース'];
const CONDITION1_HEADERS = ['条件1', '条件１'];
const CONDITION2_HEADERS = ['条件2', '条件２'];
const CONDITION3_HEADERS = ['条件3', '条件３'];
const CONDITION4_HEADERS = ['条件4', '条件４'];
const SITE_TYPE_HEADERS = ['種別'];
const DETAIL_SECTION_START = '【定期スケジュール取込】';
const DETAIL_SECTION_END = '【/定期スケジュール取込】';

function normalizeHeader(input: string | null | undefined) {
  return normalizeRegistryText(input).replace(/\s+/g, '').toLocaleLowerCase('ja-JP');
}

function toCellText(value: unknown) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function normalizeFieldText(value: unknown): string | null {
  return normalizeOptionalRegistryText(toCellText(value));
}

function normalizeMultilineText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  return normalized || null;
}

function limitText(value: string | null | undefined, maxLength: number): string | null {
  const normalized = normalizeMultilineText(value);
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength).trimEnd();
}

function limitDetailText(value: string | null | undefined, maxLength: number): string | null {
  const normalized = normalizeMultilineText(value);
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  const suffix = `\n${DETAIL_SECTION_END}`;
  const available = Math.max(0, maxLength - suffix.length);
  return `${normalized.slice(0, available).trimEnd()}${suffix}`;
}

function parsePeopleCount(value: unknown): number | null {
  const text = normalizeRegistryText(toCellText(value));
  if (!text) return null;
  const digits = text.replace(/[^\d]/g, '');
  if (!digits) return null;
  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(999999, Math.max(0, Math.round(parsed)));
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
    '人数',
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

function uniqueInOrder(values: Array<string | null | undefined>) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeOptionalRegistryText(value);
    if (!normalized) continue;
    const key = normalizeHeader(normalized);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function buildImportedScheduleRow(input: Partial<ImportedScheduleRow> & { name: string }): ImportedScheduleRow {
  return {
    companyName: normalizeOptionalRegistryText(input.companyName),
    name: normalizeRegistryText(input.name),
    workContent: normalizeOptionalRegistryText(input.workContent),
    peopleCount: typeof input.peopleCount === 'number' ? input.peopleCount : null,
    workMonth: normalizeOptionalRegistryText(input.workMonth),
    condition1: normalizeOptionalRegistryText(input.condition1),
    condition2: normalizeOptionalRegistryText(input.condition2),
    condition3: normalizeOptionalRegistryText(input.condition3),
    condition4: normalizeOptionalRegistryText(input.condition4),
    siteType: normalizeOptionalRegistryText(input.siteType),
  };
}

function extractFallbackRows(grid: unknown[][]) {
  const rows: ImportedScheduleRow[] = [];
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
      rows.push(buildImportedScheduleRow({ name }));
    }
  }

  if (rows.length > 0) return rows;

  for (const row of grid) {
    for (const cell of row ?? []) {
      const name = normalizeRegistryText(toCellText(cell));
      if (!name || looksLikeHeader(name)) continue;
      if (name.length < 2 || name.length > 80) continue;
      rows.push(buildImportedScheduleRow({ name }));
    }
  }

  return rows;
}

function extractSiteRowsFromGrid(grid: unknown[][]) {
  const headerRows = Math.min(40, grid.length);
  let headerIndex = -1;
  let companyCol = -1;
  let siteCol = -1;
  let workCol = -1;
  let peopleCol = -1;
  let workMonthCol = -1;
  let condition1Col = -1;
  let condition2Col = -1;
  let condition3Col = -1;
  let condition4Col = -1;
  let siteTypeCol = -1;

  for (let rowIndex = 0; rowIndex < headerRows; rowIndex++) {
    const row = grid[rowIndex] ?? [];
    const candidateSiteCol = findColumnIndex(row, SITE_HEADERS);
    if (candidateSiteCol < 0) continue;
    headerIndex = rowIndex;
    siteCol = candidateSiteCol;
    companyCol = findColumnIndex(row, COMPANY_HEADERS);
    workCol = findColumnIndex(row, WORK_HEADERS);
    peopleCol = findColumnIndex(row, PEOPLE_HEADERS);
    workMonthCol = findColumnIndex(row, WORK_MONTH_HEADERS);
    condition1Col = findColumnIndex(row, CONDITION1_HEADERS);
    condition2Col = findColumnIndex(row, CONDITION2_HEADERS);
    condition3Col = findColumnIndex(row, CONDITION3_HEADERS);
    condition4Col = findColumnIndex(row, CONDITION4_HEADERS);
    siteTypeCol = findColumnIndex(row, SITE_TYPE_HEADERS);
    break;
  }

  if (siteCol < 0) {
    return extractFallbackRows(grid);
  }

  const rows: ImportedScheduleRow[] = [];
  let emptyRun = 0;
  for (let rowIndex = headerIndex + 1; rowIndex < grid.length; rowIndex++) {
    const row = grid[rowIndex] ?? [];
    const name = normalizeRegistryText(toCellText(siteCol < row.length ? row[siteCol] : ''));
    const companyName = companyCol >= 0 && companyCol < row.length ? normalizeFieldText(row[companyCol]) : null;

    if (!name || looksLikeHeader(name)) {
      if (!companyName) {
        emptyRun++;
        if (emptyRun >= 12 && rowIndex > headerIndex + 3) break;
      }
      continue;
    }

    emptyRun = 0;
    rows.push(
      buildImportedScheduleRow({
        companyName,
        name,
        workContent: workCol >= 0 && workCol < row.length ? toCellText(row[workCol]) : null,
        peopleCount: peopleCol >= 0 && peopleCol < row.length ? parsePeopleCount(row[peopleCol]) : null,
        workMonth: workMonthCol >= 0 && workMonthCol < row.length ? toCellText(row[workMonthCol]) : null,
        condition1: condition1Col >= 0 && condition1Col < row.length ? toCellText(row[condition1Col]) : null,
        condition2: condition2Col >= 0 && condition2Col < row.length ? toCellText(row[condition2Col]) : null,
        condition3: condition3Col >= 0 && condition3Col < row.length ? toCellText(row[condition3Col]) : null,
        condition4: condition4Col >= 0 && condition4Col < row.length ? toCellText(row[condition4Col]) : null,
        siteType: siteTypeCol >= 0 && siteTypeCol < row.length ? toCellText(row[siteTypeCol]) : null,
      }),
    );
  }

  return rows.length > 0 ? rows : extractFallbackRows(grid);
}

function buildDetailEntry(row: ImportedScheduleRow) {
  const conditions = uniqueInOrder([row.condition1, row.condition2, row.condition3, row.condition4]);
  const lines: string[] = [];

  if (row.workContent) {
    lines.push(`・${row.workContent}`);
    if (row.siteType) lines.push(`  種別: ${row.siteType}`);
  } else if (row.siteType) {
    lines.push(`・種別: ${row.siteType}`);
  }

  if (lines.length === 0 && conditions.length > 0) {
    lines.push('・作業条件');
  }
  if (conditions.length > 0) {
    lines.push(`  条件: ${conditions.join(' / ')}`);
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

function buildDetailSection(rows: ImportedScheduleRow[]) {
  const entries: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const entry = buildDetailEntry(row);
    if (!entry) continue;
    const key = normalizeHeader(entry);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }

  if (entries.length === 0) return null;

  return limitDetailText(`${DETAIL_SECTION_START}\n${entries.join('\n\n')}\n${DETAIL_SECTION_END}`, 4500);
}

function summarizePace(rows: ImportedScheduleRow[]) {
  const workMonths = uniqueInOrder(rows.map((row) => row.workMonth));
  if (workMonths.length === 0) return null;
  return limitText(formatPaceText(workMonths.join(' / ')), 200);
}

function aggregateRows(rows: ImportedScheduleRow[]): AggregatedSiteImport | null {
  const names = uniqueInOrder(rows.map((row) => row.name));
  const name = names[0] ?? null;
  if (!name) return null;

  const companyNames = uniqueInOrder(rows.map((row) => row.companyName));
  const peopleCounts = rows
    .map((row) => row.peopleCount)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  return {
    companyName: companyNames[0] ?? null,
    name,
    peopleCount: peopleCounts.length > 0 ? Math.max(...peopleCounts) : null,
    pace: summarizePace(rows),
    detailSection: buildDetailSection(rows),
    rowCount: rows.length,
  };
}

function consolidateRows(rows: ImportedScheduleRow[]) {
  const byName = new Map<string, ImportedScheduleRow[]>();
  for (const input of rows) {
    const row = buildImportedScheduleRow(input);
    if (!row.name) continue;
    const key = normalizeHeader(row.name);
    const items = byName.get(key) ?? [];
    items.push(row);
    byName.set(key, items);
  }

  const consolidated: AggregatedSiteImport[] = [];
  for (const sameNameRows of byName.values()) {
    const byCompany = new Map<string, ImportedScheduleRow[]>();
    for (const row of sameNameRows) {
      const companyKey = normalizeHeader(row.companyName);
      const items = byCompany.get(companyKey) ?? [];
      items.push(row);
      byCompany.set(companyKey, items);
    }

    const blankRows = byCompany.get('') ?? [];
    const nonBlankKeys = Array.from(byCompany.keys()).filter((key) => key);
    if (blankRows.length > 0 && nonBlankKeys.length === 1) {
      const key = nonBlankKeys[0] ?? '';
      const merged = [...(byCompany.get(key) ?? []), ...blankRows];
      byCompany.set(key, merged);
      byCompany.delete('');
    }

    for (const companyRows of byCompany.values()) {
      const aggregated = aggregateRows(companyRows);
      if (aggregated) consolidated.push(aggregated);
    }
  }

  return consolidated;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mergeImportedDetail(existingDetail: string | null | undefined, detailSection: string | null | undefined) {
  const existing = normalizeMultilineText(existingDetail);
  const imported = normalizeMultilineText(detailSection);
  if (!imported) return existing;
  if (!existing) return imported;

  const sectionPattern = new RegExp(
    `${escapeRegExp(DETAIL_SECTION_START)}[\\s\\S]*?${escapeRegExp(DETAIL_SECTION_END)}`,
    'm',
  );
  if (sectionPattern.test(existing)) {
    return normalizeMultilineText(existing.replace(sectionPattern, imported));
  }

  return normalizeMultilineText(`${existing}\n\n${imported}`);
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
  const extractedRows: ImportedScheduleRow[] = [];

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
    return Response.json({
      ok: true,
      kind,
      created: 0,
      updated: 0,
      matched: 0,
      skipped: 0,
      total: 0,
      partnersCreated: 0,
      partnersMatched: 0,
      companyBackfilled: 0,
      rows: [],
    });
  }

  let created = 0;
  let updated = 0;
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
    const conflictingNameOnlyMatch =
      duplicate.site &&
      duplicate.matchType === 'name-only' &&
      row.companyName &&
      duplicate.site.companyName &&
      normalizeHeader(row.companyName) !== normalizeHeader(duplicate.site.companyName);

    if (duplicate.site && !conflictingNameOnlyMatch) {
      matched++;
      const current = await prisma.site.findUnique({
        where: { id: duplicate.site.id },
        select: {
          id: true,
          companyName: true,
          peopleCount: true,
          pace: true,
          detail: true,
        },
      });
      if (!current) continue;

      const nextData: {
        companyName?: string | null;
        peopleCount?: number | null;
        pace?: string | null;
        detail?: string | null;
      } = {};

      if (row.companyName && !normalizeHeader(current.companyName)) {
        nextData.companyName = row.companyName;
        companyBackfilled++;
      }
      if (row.peopleCount != null && current.peopleCount !== row.peopleCount) {
        nextData.peopleCount = row.peopleCount;
      }
      if (row.pace && current.pace !== row.pace) {
        nextData.pace = row.pace;
      }

      const mergedDetail = limitDetailText(mergeImportedDetail(current.detail, row.detailSection), 5000);
      if (mergedDetail && normalizeMultilineText(current.detail) !== mergedDetail) {
        nextData.detail = mergedDetail;
      }

      if (Object.keys(nextData).length > 0) {
        await prisma.site.update({
          where: { id: current.id },
          data: nextData,
          select: { id: true },
        });
        updated++;
      }
      continue;
    }

    await prisma.site.create({
      data: {
        companyName: row.companyName,
        name: row.name,
        kind,
        peopleCount: row.peopleCount,
        pace: row.pace,
        detail: row.detailSection,
      },
      select: { id: true },
    });
    created++;
  }

  return Response.json({
    ok: true,
    kind,
    created,
    updated,
    matched,
    skipped: matched,
    total: rows.length,
    partnersCreated,
    partnersMatched,
    companyBackfilled,
    rows: rows.slice(0, 200),
  });
}
