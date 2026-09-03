import { prisma } from '@/server/db/prisma';
import { Prisma } from '@/generated/prisma';
import { ensurePartnerByName, findMatchingSite, normalizeRegistryText } from '@/server/site-registry';
import { saveGlobalScheduleUserOrder } from '@/server/schedule-user-order';
import { ensureSiteDayFolders } from '@/server/site-storage';
import { writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import * as XLSX from 'xlsx';

type SiteKind = 'NORMAL' | 'DAILY';

type SharedFileInfo = {
  filePath: string;
  fileName: string;
  baseName: string;
  extension: string;
  mtimeMs: number;
};

type WorkSlipFileMeta = {
  term: number | null;
  startYear: number | null;
  startMonth: number | null;
  endYear: number | null;
  endMonth: number | null;
};

type DiscoveredSharedFiles = {
  sharedDir: string;
  workTable: SharedFileInfo | null;
  workSlip: SharedFileInfo | null;
  workSlipMeta: WorkSlipFileMeta | null;
  workSlipCandidates: number;
};

type WorkTableRow = {
  dayYmd: string;
  companyName: string | null;
  entries: Array<{ siteName: string; color: 'default' | 'red'; itemIndex: number }>;
  assignees: string[];
};

type WorkSlipLedgerRow = {
  companyName: string | null;
  siteName: string;
  amount: number | null;
};

type SharedSyncCounts = {
  sitesCreated: number;
  sitesUpdated: number;
  sitesMatched: number;
  sitesSkipped: number;
  scheduleCreated: number;
  scheduleSkipped: number;
  workSlipsCreated: number;
  workSlipsSkipped: number;
  unknownUsers: number;
};

export type SharedSyncPreview = {
  ok: true;
  sharedDir: string;
  kind: SiteKind;
  selected: {
    workTable: { fileName: string; mtimeIso: string } | null;
    workSlip: { fileName: string; mtimeIso: string; term: number | null; period: string | null } | null;
  };
  warnings: string[];
};

export type SharedSyncRunResult = SharedSyncPreview & {
  mode: 'sync';
  counts: SharedSyncCounts;
};

export class SharedSyncError extends Error {
  code: 'MISSING_SOURCE' | 'PASSWORD_PROTECTED' | 'SYNC_FAILED';

  constructor(code: SharedSyncError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

const SHARED_SOURCE_DIR = String(process.env.MASTER_HUB_SHARED_SOURCE_DIR || '\\\\192.168.0.210\\guest\\共有フォルダ');
const EXCEL_EXTENSIONS = new Set(['.xls', '.xlsx']);

const WORK_TABLE_NAME_KEY = '作業表☆';
const WORK_SLIP_NAME_KEY = '作業伝票';

const COMPANY_HEADERS = ['請求先', '請求先名', '会社名', '会社', '取引先', '得意先'];
const SITE_HEADERS = ['件名', '現場名', '現場', '現場名称', '工事件名'];
const AMOUNT_HEADERS = ['金額', '請求金額', '売上金額'];

const DATE_HEADERS = ['作業日', '日付', '実施日'];
const LEAD_HEADERS = ['担当者', '担当'];
const MEMBERS_HEADERS = ['作業メンバー', 'メンバー', '作業員'];
const DRIVER_HEADERS = ['運転者'];

function normalizeHeader(text: string): string {
  return normalizeRegistryText(text)
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]/g, '')
    .replace(/\s+/g, '')
    .toLocaleLowerCase('ja-JP');
}

function normalizeKey(text: string | null | undefined): string {
  return normalizeRegistryText(text).replace(/\s+/g, '').toLocaleLowerCase('ja-JP');
}

function toCellText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function isRedColorToken(value: string): boolean {
  const normalized = value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (!normalized) return false;
  return normalized.endsWith('FF0000') || normalized.endsWith('C00000') || normalized.endsWith('9C0006');
}

function detectCellEntryColor(cell: unknown): 'default' | 'red' {
  const c = cell as { s?: unknown; r?: unknown } | null;
  const rich = typeof c?.r === 'string' ? c.r : '';
  if (/<color\b[^>]*rgb="[^"]*"/i.test(rich)) {
    const matches = rich.match(/<color\b[^>]*rgb="([^"]+)"/gi) ?? [];
    if (matches.some((token) => isRedColorToken(token))) return 'red';
  }

  const style = c?.s as Record<string, unknown> | undefined;
  const font = style?.font as Record<string, unknown> | undefined;
  const styleColor = font?.color as Record<string, unknown> | undefined;
  const rgb = typeof styleColor?.rgb === 'string' ? styleColor.rgb : '';
  return isRedColorToken(rgb) ? 'red' : 'default';
}

function parseRichRunParts(rawRich: string | null | undefined): Array<{ text: string; color: 'default' | 'red' }> {
  if (!rawRich) return [];
  const runRegex = /<r>([\s\S]*?)<\/r>/g;
  const result: Array<{ text: string; color: 'default' | 'red' }> = [];

  let runMatch: RegExpExecArray | null = null;
  while ((runMatch = runRegex.exec(rawRich)) !== null) {
    const runBlock = runMatch[1] ?? '';
    const textMatches = Array.from(runBlock.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g));
    const text = decodeXmlText(textMatches.map((x) => x[1] ?? '').join(''));
    if (!text) continue;
    const colorMatch = /<color\b[^>]*rgb="([^"]+)"/i.exec(runBlock);
    const color = colorMatch && isRedColorToken(colorMatch[1] ?? '') ? 'red' : 'default';
    result.push({ text, color });
  }

  if (result.length > 0) return result;

  const plainTextMatches = Array.from(rawRich.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g));
  const plain = decodeXmlText(plainTextMatches.map((x) => x[1] ?? '').join(''));
  if (!plain) return [];
  return [{ text: plain, color: 'default' }];
}

function splitSiteEntriesFromCell(cell: unknown, fallbackText: string): Array<{ siteName: string; color: 'default' | 'red'; itemIndex: number }> {
  const c = cell as { r?: unknown } | null;
  const parts = parseRichRunParts(typeof c?.r === 'string' ? c.r : null);
  const partList = parts.length > 0 ? parts : [{ text: fallbackText, color: detectCellEntryColor(cell) }];
  const delimiter = /([、,，\/／\r\n]+|[ \t]{2,}|　{2,})/;

  const collected: Array<{ siteName: string; color: 'default' | 'red' }> = [];
  let buf = '';
  let hasRed = false;
  const flush = () => {
    const normalized = normalizeRegistryText(buf);
    buf = '';
    if (!normalized) {
      hasRed = false;
      return;
    }
    collected.push({ siteName: normalized, color: hasRed ? 'red' : 'default' });
    hasRed = false;
  };

  for (const part of partList) {
    const tokens = part.text.split(delimiter);
    for (const token of tokens) {
      if (!token) continue;
      if (delimiter.test(token)) {
        flush();
        continue;
      }
      buf += token;
      if (part.color === 'red') hasRed = true;
    }
  }
  flush();

  const deduped: Array<{ siteName: string; color: 'default' | 'red'; itemIndex: number }> = [];
  const seen = new Set<string>();
  for (const item of collected) {
    const key = `${normalizeKey(item.siteName)}|${item.color}`;
    if (!normalizeKey(item.siteName) || seen.has(key)) continue;
    seen.add(key);
    deduped.push({ siteName: item.siteName, color: item.color, itemIndex: deduped.length });
  }

  return deduped;
}

function findHeaderRowAndColumns(
  grid: unknown[][],
  columns: Record<string, string[]>,
  maxHeaderRows = 60,
): { headerRowIndex: number; indexMap: Record<string, number> } | null {
  const keys = Object.keys(columns);
  for (let rowIndex = 0; rowIndex < Math.min(maxHeaderRows, grid.length); rowIndex += 1) {
    const row = grid[rowIndex] ?? [];
    const indexMap: Record<string, number> = {};

    for (const key of keys) {
      const candidates = columns[key]?.map((x) => normalizeHeader(x)) ?? [];
      let hit = -1;
      for (let col = 0; col < row.length; col += 1) {
        const cell = normalizeHeader(toCellText(row[col]));
        if (!cell) continue;
        if (candidates.some((candidate) => cell === candidate || cell.includes(candidate) || candidate.includes(cell))) {
          hit = col;
          break;
        }
      }
      indexMap[key] = hit;
    }

    const required = keys.every((key) => {
      if (key === 'company' || key === 'amount' || key === 'members' || key === 'driver') return true;
      return indexMap[key] >= 0;
    });

    if (required) return { headerRowIndex: rowIndex, indexMap };
  }
  return null;
}

function parseAmount(value: unknown): number | null {
  const raw = normalizeRegistryText(toCellText(value));
  if (!raw) return null;
  const numeric = raw.replace(/[￥¥,，円\s]/g, '');
  if (!numeric) return null;
  const n = Number(numeric);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function parseWorkSlipMeta(baseName: string): WorkSlipFileMeta | null {
  const normalized = normalizeRegistryText(baseName);
  const match = /^第\s*(\d+)\s*期作業伝票\((\d{4})年(\d{1,2})月[～~]\s*(\d{4})年(\d{1,2})月\)$/.exec(normalized);
  if (!match) {
    return {
      term: null,
      startYear: null,
      startMonth: null,
      endYear: null,
      endMonth: null,
    };
  }

  return {
    term: Number(match[1]),
    startYear: Number(match[2]),
    startMonth: Number(match[3]),
    endYear: Number(match[4]),
    endMonth: Number(match[5]),
  };
}

function isCurrentDateInRange(meta: WorkSlipFileMeta | null): boolean {
  if (!meta?.startYear || !meta.startMonth || !meta.endYear || !meta.endMonth) return false;
  const now = new Date();
  const key = now.getFullYear() * 100 + (now.getMonth() + 1);
  const startKey = meta.startYear * 100 + meta.startMonth;
  const endKey = meta.endYear * 100 + meta.endMonth;
  return key >= startKey && key <= endKey;
}

async function discoverSharedFiles(targetTerm?: number | null): Promise<DiscoveredSharedFiles> {
  const fs = await import('node:fs/promises');
  const dirents = await fs.readdir(SHARED_SOURCE_DIR, { withFileTypes: true });

  const files: SharedFileInfo[] = [];
  for (const dirent of dirents) {
    if (!dirent.isFile()) continue;
    const extension = extname(dirent.name).toLowerCase();
    if (!EXCEL_EXTENSIONS.has(extension)) continue;

    const baseName = dirent.name.slice(0, -extension.length);
    const filePath = join(SHARED_SOURCE_DIR, dirent.name);
    const stat = await fs.stat(filePath);
    files.push({
      filePath,
      fileName: dirent.name,
      baseName,
      extension,
      mtimeMs: stat.mtimeMs,
    });
  }

  const workTableCandidates = files.filter((file) => normalizeRegistryText(file.baseName).startsWith(WORK_TABLE_NAME_KEY));
  const workTable = [...workTableCandidates].sort((a, b) => b.mtimeMs - a.mtimeMs)[0] ?? null;

  const workSlipCandidates = files
    .filter((file) => normalizeRegistryText(file.baseName).includes(WORK_SLIP_NAME_KEY))
    .map((file) => ({ file, meta: parseWorkSlipMeta(file.baseName) }));

  const scored = workSlipCandidates
    .map((item) => {
      let score = 0;
      if (item.meta?.term != null && targetTerm != null && item.meta.term === targetTerm) score += 100;
      if (item.meta?.term != null) score += 20;
      if (isCurrentDateInRange(item.meta)) score += 30;
      if (normalizeRegistryText(item.file.baseName).startsWith('第')) score += 5;
      return { ...item, score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.file.mtimeMs - a.file.mtimeMs;
    });

  const selectedSlip = scored[0]?.file ?? null;
  const selectedSlipMeta = scored[0]?.meta ?? null;

  return {
    sharedDir: SHARED_SOURCE_DIR,
    workTable,
    workSlip: selectedSlip,
    workSlipMeta: selectedSlipMeta,
    workSlipCandidates: workSlipCandidates.length,
  };
}

function readWorkbook(filePath: string): XLSX.WorkBook {
  try {
    return XLSX.readFile(filePath, {
      cellDates: true,
      cellStyles: true,
      cellHTML: true,
      dense: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Excel 読み取りに失敗しました';
    const lowered = message.toLowerCase();
    if (lowered.includes('password') || lowered.includes('encrypted') || lowered.includes('decrypt')) {
      throw new SharedSyncError(
        'PASSWORD_PROTECTED',
        '読み取り元 Excel がパスワード保護されています。原本は変更せず、同内容の読み取り専用コピー（非パスワード）を共有フォルダに置く運用にしてください。',
      );
    }
    throw new SharedSyncError('SYNC_FAILED', `Excel 読み取りに失敗: ${message}`);
  }
}

function gridFromSheet(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
    defval: '',
  }) as unknown[][];
}

function parseDateToYmd(value: unknown, fallbackYear: number): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      const y = String(parsed.y).padStart(4, '0');
      const m = String(parsed.m).padStart(2, '0');
      const d = String(parsed.d).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }

  const text = normalizeRegistryText(toCellText(value));
  if (!text) return null;

  let match = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/.exec(text);
  if (match) {
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    if (y >= 2000 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  match = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(text);
  if (match) {
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    if (y >= 2000 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  match = /^(\d{1,2})月(\d{1,2})日$/.exec(text);
  if (match) {
    const m = Number(match[1]);
    const d = Number(match[2]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${fallbackYear}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return null;
}

function splitAssignees(...inputs: Array<string | null | undefined>): string[] {
  const tokens: string[] = [];
  for (const input of inputs) {
    const normalized = normalizeRegistryText(input);
    if (!normalized) continue;
    normalized
      .split(/[、,，\/／・]+/)
      .map((x) => normalizeRegistryText(x))
      .filter(Boolean)
      .forEach((x) => tokens.push(x));
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokens) {
    const key = normalizeKey(token);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(token);
  }
  return result;
}

function looksLikeAssigneeName(value: unknown): boolean {
  const text = normalizeRegistryText(toCellText(value));
  if (!text) return false;
  if (text.length > 24) return false;
  if (/\d/.test(text)) return false;
  if (/[()（）]/.test(text)) return false;
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(text);
}

function extractWorkTableRowsFromMatrix(sheet: XLSX.WorkSheet, grid: unknown[][], fallbackYear: number): WorkTableRow[] {
  // Week-matrix format: first column is assignee, date headers are on one row.
  const rows: WorkTableRow[] = [];

  let headerRowIndex = -1;
  let dateCols: number[] = [];
  for (let rowIndex = 0; rowIndex < Math.min(30, grid.length); rowIndex += 1) {
    const row = grid[rowIndex] ?? [];
    const cols: number[] = [];
    for (let col = 0; col < row.length; col += 1) {
      if (parseDateToYmd(row[col], fallbackYear)) cols.push(col);
    }
    if (cols.length >= 4) {
      headerRowIndex = rowIndex;
      dateCols = cols;
      break;
    }
  }
  if (headerRowIndex < 0 || dateCols.length === 0) return rows;

  let emptyRun = 0;
  for (let rowIndex = headerRowIndex + 2; rowIndex < grid.length; rowIndex += 1) {
    const row = grid[rowIndex] ?? [];
    const assignee = normalizeRegistryText(toCellText(row[0]));
    const hasAnyCell = dateCols.some((col) => normalizeRegistryText(toCellText(row[col])));

    if (!assignee && !hasAnyCell) {
      emptyRun += 1;
      if (emptyRun >= 12) break;
      continue;
    }
    emptyRun = 0;

    if (!looksLikeAssigneeName(assignee)) continue;

    for (const col of dateCols) {
      const dayYmd = parseDateToYmd((grid[headerRowIndex] ?? [])[col], fallbackYear);
      const siteName = normalizeRegistryText(toCellText(row[col]));
      if (!dayYmd || !siteName) continue;

      const addr = XLSX.utils.encode_cell({ r: rowIndex, c: col });
      const cell = (sheet as Record<string, unknown>)[addr];
      const entries = splitSiteEntriesFromCell(cell, siteName);
      if (entries.length === 0) continue;

      rows.push({
        dayYmd,
        companyName: null,
        entries,
        assignees: [assignee],
      });
    }
  }

  return rows;
}

function extractWorkTableRows(workbook: XLSX.WorkBook): WorkTableRow[] {
  const rows: WorkTableRow[] = [];
  const fallbackYear = new Date().getFullYear();

  for (const sheetName of workbook.SheetNames ?? []) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const grid = gridFromSheet(sheet);
    const sheetRows: WorkTableRow[] = [];

    const found = findHeaderRowAndColumns(grid, {
      date: DATE_HEADERS,
      site: SITE_HEADERS,
      lead: LEAD_HEADERS,
      members: MEMBERS_HEADERS,
      company: COMPANY_HEADERS,
      driver: DRIVER_HEADERS,
    });
    if (found) {
      let emptyRun = 0;
      for (let rowIndex = found.headerRowIndex + 1; rowIndex < grid.length; rowIndex += 1) {
        const row = grid[rowIndex] ?? [];
        const siteName = normalizeRegistryText(toCellText(row[found.indexMap.site]));
        const dateYmd = parseDateToYmd(row[found.indexMap.date], fallbackYear);
        const companyName = normalizeRegistryText(toCellText(row[found.indexMap.company]));
        const lead = normalizeRegistryText(toCellText(row[found.indexMap.lead]));
        const members = normalizeRegistryText(toCellText(row[found.indexMap.members]));
        const driver = normalizeRegistryText(toCellText(row[found.indexMap.driver]));
        const assignees = splitAssignees(lead, members, driver);
        const addr = XLSX.utils.encode_cell({ r: rowIndex, c: found.indexMap.site });
        const cell = (sheet as Record<string, unknown>)[addr];
        const entries = splitSiteEntriesFromCell(cell, siteName);

        if (!siteName && !dateYmd && assignees.length === 0) {
          emptyRun += 1;
          if (emptyRun >= 12) break;
          continue;
        }
        emptyRun = 0;

        if (entries.length === 0 || !dateYmd || assignees.length === 0) continue;
        sheetRows.push({
          dayYmd: dateYmd,
          companyName: companyName || null,
          entries,
          assignees,
        });
      }
    }

    if (sheetRows.length === 0) {
      sheetRows.push(...extractWorkTableRowsFromMatrix(sheet, grid, fallbackYear));
    }
    rows.push(...sheetRows);
  }

  const seen = new Set<string>();
  const deduped: WorkTableRow[] = [];
  for (const row of rows) {
    const filteredEntries: Array<{ siteName: string; color: 'default' | 'red'; itemIndex: number }> = [];
    const localSeen = new Set<string>();
    for (const entry of row.entries) {
      const entryKey = `${normalizeKey(entry.siteName)}|${entry.color}`;
      if (!entryKey || localSeen.has(entryKey)) continue;
      localSeen.add(entryKey);
      filteredEntries.push({ ...entry, itemIndex: filteredEntries.length });
    }
    if (filteredEntries.length === 0) continue;

    let hasNewKey = false;
    for (const assignee of row.assignees) {
      const key = `${row.dayYmd}|${normalizeKey(assignee)}|${normalizeKey(row.companyName)}|${filteredEntries.map((x) => `${normalizeKey(x.siteName)}:${x.color}`).join('|')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hasNewKey = true;
    }
    if (!hasNewKey) continue;
    deduped.push({ ...row, entries: filteredEntries });
  }
  return deduped;
}

function extractWorkSlipLedgerRows(workbook: XLSX.WorkBook): WorkSlipLedgerRow[] {
  const rows: WorkSlipLedgerRow[] = [];

  for (const sheetName of workbook.SheetNames ?? []) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const grid = gridFromSheet(sheet);

    const found = findHeaderRowAndColumns(grid, {
      company: COMPANY_HEADERS,
      site: SITE_HEADERS,
      amount: AMOUNT_HEADERS,
    });
    if (!found) continue;

    let emptyRun = 0;
    for (let rowIndex = found.headerRowIndex + 1; rowIndex < grid.length; rowIndex += 1) {
      const row = grid[rowIndex] ?? [];
      const companyName = normalizeRegistryText(toCellText(row[found.indexMap.company]));
      const siteName = normalizeRegistryText(toCellText(row[found.indexMap.site]));
      const amount = parseAmount(row[found.indexMap.amount]);

      if (!companyName && !siteName && amount == null) {
        emptyRun += 1;
        if (emptyRun >= 12) break;
        continue;
      }
      emptyRun = 0;

      if (!siteName) continue;
      rows.push({
        companyName: companyName || null,
        siteName,
        amount,
      });
    }
  }

  const dedupedByName = new Map<string, WorkSlipLedgerRow>();
  for (const row of rows) {
    const key = `${normalizeKey(row.companyName)}|${normalizeKey(row.siteName)}`;
    const hit = dedupedByName.get(key);
    if (!hit) {
      dedupedByName.set(key, row);
      continue;
    }
    if (hit.amount == null && row.amount != null) {
      dedupedByName.set(key, row);
    }
  }

  return Array.from(dedupedByName.values());
}

function startOfDayLocal(ymd: string): Date {
  const d = new Date(`${ymd}T00:00:00`);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addMinutes(d: Date, minutes: number): Date {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() + minutes);
  return x;
}

function toYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function hasSharedExcelSyncMeta(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return !!obj.sharedExcelSync && typeof obj.sharedExcelSync === 'object' && !Array.isArray(obj.sharedExcelSync);
}

function todayYmdTokyo(): string {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function toPeriodText(meta: WorkSlipFileMeta | null): string | null {
  if (!meta?.startYear || !meta.startMonth || !meta.endYear || !meta.endMonth) return null;
  return `${meta.startYear}年${String(meta.startMonth).padStart(2, '0')}月～${meta.endYear}年${String(meta.endMonth).padStart(2, '0')}月`;
}

function safeStoredFileName(fileName: string): string {
  return (fileName || 'work-slip')
    .replace(/[\\/\r\n\t\0<>:"|?*]+/g, '_')
    .slice(0, 180);
}

function workSlipMimeByExtension(ext: string): string {
  return ext.toLowerCase() === '.xls'
    ? 'application/vnd.ms-excel'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

function buildPreview(input: { files: DiscoveredSharedFiles; kind: SiteKind; warnings?: string[] }): SharedSyncPreview {
  return {
    ok: true,
    sharedDir: input.files.sharedDir,
    kind: input.kind,
    selected: {
      workTable: input.files.workTable
        ? {
            fileName: input.files.workTable.fileName,
            mtimeIso: new Date(input.files.workTable.mtimeMs).toISOString(),
          }
        : null,
      workSlip: input.files.workSlip
        ? {
            fileName: input.files.workSlip.fileName,
            mtimeIso: new Date(input.files.workSlip.mtimeMs).toISOString(),
            term: input.files.workSlipMeta?.term ?? null,
            period: toPeriodText(input.files.workSlipMeta),
          }
        : null,
    },
    warnings: input.warnings ?? [],
  };
}

export async function getSharedSyncPreview(input: { kind: SiteKind; targetTerm?: number | null }): Promise<SharedSyncPreview> {
  const files = await discoverSharedFiles(input.targetTerm ?? null);
  const warnings: string[] = [];

  if (!files.workTable) warnings.push('共有フォルダ直下に 作業表☆(.xls/.xlsx) が見つかりません。');
  if (!files.workSlip) warnings.push('共有フォルダ直下に 作業伝票 系(.xls/.xlsx) が見つかりません。');
  if (files.workSlipCandidates > 1) warnings.push(`作業伝票候補が ${files.workSlipCandidates} 件あります。対象期一致 > 更新日時の優先順で選択します。`);

  return buildPreview({ files, kind: input.kind, warnings });
}

export async function runSharedSync(input: { kind: SiteKind; targetTerm?: number | null }): Promise<SharedSyncRunResult> {
  const files = await discoverSharedFiles(input.targetTerm ?? null);

  if (!files.workTable || !files.workSlip) {
    const missing = [
      !files.workTable ? '作業表☆(.xls/.xlsx)' : null,
      !files.workSlip ? '作業伝票系(.xls/.xlsx)' : null,
    ].filter(Boolean);
    throw new SharedSyncError('MISSING_SOURCE', `共有フォルダに必要ファイルがありません: ${missing.join(' / ')}`);
  }

  const kind = input.kind;
  const workTableFileName = files.workTable.fileName;

  const workTableBook = readWorkbook(files.workTable.filePath);
  const workSlipBook = readWorkbook(files.workSlip.filePath);

  const scheduleRows = extractWorkTableRows(workTableBook);
  const ledgerRows = extractWorkSlipLedgerRows(workSlipBook);

  const counts: SharedSyncCounts = {
    sitesCreated: 0,
    sitesUpdated: 0,
    sitesMatched: 0,
    sitesSkipped: 0,
    scheduleCreated: 0,
    scheduleSkipped: 0,
    workSlipsCreated: 0,
    workSlipsSkipped: 0,
    unknownUsers: 0,
  };

  const touchedSiteIds = new Set<string>();

  for (const row of ledgerRows) {
    if (row.companyName) {
      await ensurePartnerByName(row.companyName);
    }

    const duplicate = await findMatchingSite({
      companyName: row.companyName,
      name: row.siteName,
      kind,
    });

    const conflictByNameOnly =
      duplicate.site &&
      duplicate.matchType === 'name-only' &&
      row.companyName &&
      duplicate.site.companyName &&
      normalizeKey(row.companyName) !== normalizeKey(duplicate.site.companyName);

    if (duplicate.site && !conflictByNameOnly) {
      counts.sitesMatched += 1;

      const current = await prisma.site.findUnique({
        where: { id: duplicate.site.id },
        select: { id: true, companyName: true, amount: true },
      });
      if (!current) {
        counts.sitesSkipped += 1;
        continue;
      }

      const patch: { companyName?: string | null; amount?: number | null } = {};
      const currentCompanyBlank = !normalizeKey(current.companyName);
      if (row.companyName && currentCompanyBlank) patch.companyName = row.companyName;
      if (row.amount != null && current.amount == null) patch.amount = row.amount;

      if (Object.keys(patch).length > 0) {
        await prisma.site.update({ where: { id: current.id }, data: patch, select: { id: true } });
        counts.sitesUpdated += 1;
      }

      touchedSiteIds.add(current.id);
      continue;
    }

    if (duplicate.site && conflictByNameOnly) {
      counts.sitesSkipped += 1;
      continue;
    }

    const created = await prisma.site.create({
      data: {
        kind,
        companyName: row.companyName,
        name: row.siteName,
        amount: row.amount,
      },
      select: { id: true },
    });
    counts.sitesCreated += 1;
    touchedSiteIds.add(created.id);
  }

  const users = await prisma.user.findMany({
    where: { kind },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, showInSchedule: true },
    take: 500,
  });

  const assigneeNameByKey = new Map<string, string>();
  const assigneeKeyOrder: string[] = [];
  for (const row of scheduleRows) {
    for (const assignee of row.assignees) {
      const key = normalizeKey(assignee);
      if (!key || assigneeNameByKey.has(key)) continue;
      assigneeNameByKey.set(key, assignee);
      assigneeKeyOrder.push(key);
    }
  }

  const userByName = new Map<string, { id: string; name: string; showInSchedule: boolean }>();
  for (const user of users) {
    const key = normalizeKey(user.name);
    if (key && !userByName.has(key)) {
      userByName.set(key, { id: user.id, name: user.name ?? '', showInSchedule: user.showInSchedule });
    }
  }

  for (const key of assigneeKeyOrder) {
    const assigneeName = assigneeNameByKey.get(key);
    if (!assigneeName) continue;

    const existing = userByName.get(key);
    if (existing) {
      const patch: { name?: string | null; showInSchedule?: boolean } = {};
      if ((existing.name ?? '').trim() !== assigneeName) patch.name = assigneeName;
      if (!existing.showInSchedule) patch.showInSchedule = true;

      if (Object.keys(patch).length > 0) {
        await prisma.user.update({
          where: { id: existing.id },
          data: patch,
          select: { id: true },
        });
        existing.name = patch.name ?? existing.name;
        existing.showInSchedule = patch.showInSchedule ?? existing.showInSchedule;
      }
      continue;
    }

    const created = await prisma.user.create({
      data: {
        kind,
        name: assigneeName,
        showInSchedule: true,
      },
      select: { id: true, name: true, showInSchedule: true },
    });
    userByName.set(key, { id: created.id, name: created.name ?? assigneeName, showInSchedule: created.showInSchedule });
  }

  const scheduledUserOrderIds = assigneeKeyOrder
    .map((key) => userByName.get(key)?.id ?? null)
    .filter((id): id is string => !!id);
  const activeUserIds = users.filter((user) => user.showInSchedule).map((user) => user.id);
  const globalUserOrderIds = Array.from(new Set([...scheduledUserOrderIds, ...activeUserIds]));
  await saveGlobalScheduleUserOrder(kind, globalUserOrderIds);

  const preparedRows: Array<{
    userId: string;
    dayYmd: string;
    summary: string;
    siteId: string;
    labelColor: 'default' | 'red';
    groupIndex: number;
    itemIndex: number;
    sourceKey: string;
  }> = [];

  for (const row of scheduleRows) {
    if (row.companyName) {
      await ensurePartnerByName(row.companyName);
    }

    const siteIdByEntryKey = new Map<string, string>();
    for (const entry of row.entries) {
      const entryKey = `${normalizeKey(entry.siteName)}|${entry.color}`;
      if (siteIdByEntryKey.has(entryKey)) continue;

      const siteHit = await findMatchingSite({ companyName: row.companyName, name: entry.siteName, kind });
      const conflictByNameOnly =
        siteHit.site &&
        siteHit.matchType === 'name-only' &&
        row.companyName &&
        siteHit.site.companyName &&
        normalizeKey(row.companyName) !== normalizeKey(siteHit.site.companyName);

      let siteId = siteHit.site && !conflictByNameOnly ? siteHit.site.id : null;
      if (!siteId) {
        const created = await prisma.site.create({
          data: {
            kind,
            companyName: row.companyName,
            name: entry.siteName,
          },
          select: { id: true },
        });
        siteId = created.id;
      }
      siteIdByEntryKey.set(entryKey, siteId);
    }

    for (const assignee of row.assignees) {
      const user = userByName.get(normalizeKey(assignee));
      if (!user) {
        counts.unknownUsers += 1;
        continue;
      }

      for (const entry of row.entries) {
        const summary = entry.siteName;
        const siteId = siteIdByEntryKey.get(`${normalizeKey(entry.siteName)}|${entry.color}`);
        if (!siteId) continue;

        preparedRows.push({
          userId: user.id,
          dayYmd: row.dayYmd,
          summary,
          siteId,
          labelColor: entry.color,
          groupIndex: 0,
          itemIndex: entry.itemIndex,
          sourceKey: `${row.dayYmd}|${normalizeKey(assignee)}|${normalizeKey(row.companyName)}|${normalizeKey(summary)}|${entry.color}|${entry.itemIndex}`,
        });
      }
    }
  }

  const uniqueRows = new Map<string, (typeof preparedRows)[number]>();
  for (const row of preparedRows) {
    if (!uniqueRows.has(row.sourceKey)) uniqueRows.set(row.sourceKey, row);
  }

  const finalRows = Array.from(uniqueRows.values());
  if (finalRows.length > 0) {
    const dayList = finalRows.map((x) => x.dayYmd).sort();
    const minDay = dayList[0] ?? null;
    const maxDay = dayList[dayList.length - 1] ?? null;
    const userIds = Array.from(new Set(finalRows.map((x) => x.userId)));

    let existingRows: Array<{
      id: string;
      userId: string;
      startAt: Date;
      summary: string | null;
      siteId: string | null;
      accountingMeta: Prisma.JsonValue | null;
    }> = [];
    if (minDay && maxDay && userIds.length > 0) {
      const maxDayEnd = new Date(`${maxDay}T00:00:00`);
      maxDayEnd.setDate(maxDayEnd.getDate() + 1);

      await prisma.$transaction(async (tx) => {
        existingRows = await tx.workEntry.findMany({
          where: {
            kind,
            userId: { in: userIds },
            startAt: { gte: startOfDayLocal(minDay), lt: maxDayEnd },
          },
          select: {
            id: true,
            userId: true,
            startAt: true,
            summary: true,
            siteId: true,
            accountingMeta: true,
          },
        });

        const sharedIds = existingRows.filter((row) => hasSharedExcelSyncMeta(row.accountingMeta)).map((row) => row.id);
        if (sharedIds.length > 0) {
          await tx.workEntry.deleteMany({ where: { id: { in: sharedIds } } });
        }

        const baseRows = existingRows.filter((row) => !hasSharedExcelSyncMeta(row.accountingMeta));
        const existingSiteKeySet = new Set<string>();
        const existingCountByCell = new Map<string, number>();

        for (const row of baseRows) {
          const ymd = toYmdLocal(row.startAt);
          const cellKey = `${row.userId}|${ymd}`;
          existingCountByCell.set(cellKey, (existingCountByCell.get(cellKey) ?? 0) + 1);
          if (row.siteId) {
            existingSiteKeySet.add(`${cellKey}|${row.siteId}`);
          }
        }

        const createData: Array<{
          userId: string;
          kind: SiteKind;
          startAt: Date;
          summary: string;
          note: string | null;
          siteId: string;
          accountingMeta: Prisma.InputJsonValue;
        }> = [];

        const appendedPerCell = new Map<string, number>();

        for (const row of finalRows) {
          const cellKey = `${row.userId}|${row.dayYmd}`;
          const siteDedupeKey = `${cellKey}|${row.siteId}`;
          if (existingSiteKeySet.has(siteDedupeKey)) {
            counts.scheduleSkipped += 1;
            continue;
          }

          const existingCount = existingCountByCell.get(cellKey) ?? 0;
          const appendedCount = appendedPerCell.get(cellKey) ?? 0;
          const minuteOffset = existingCount + appendedCount;
          appendedPerCell.set(cellKey, appendedCount + 1);
          existingSiteKeySet.add(siteDedupeKey);

          createData.push({
            userId: row.userId,
            kind,
            startAt: addMinutes(startOfDayLocal(row.dayYmd), minuteOffset),
            summary: row.summary,
            note: null,
            siteId: row.siteId,
            accountingMeta: {
              scheduleEntryKind: 'site',
              sharedExcelSync: {
                source: '作業表☆',
                fileName: workTableFileName,
                rowKey: row.sourceKey,
              },
              labelColor: row.labelColor,
              scheduleGroupIndex: row.groupIndex,
              scheduleItemIndex: row.itemIndex,
            } as Prisma.InputJsonValue,
          });
        }

        if (createData.length > 0) {
          await tx.workEntry.createMany({ data: createData });
          counts.scheduleCreated += createData.length;
        }
      });
    }
  }

  const slipBuffer = await (await import('node:fs/promises')).readFile(files.workSlip.filePath);
  const todayYmd = todayYmdTokyo();
  const fileSafeName = safeStoredFileName(files.workSlip.fileName);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const subject = `共有同期: ${files.workSlip.baseName}`;
  const siteIds = Array.from(touchedSiteIds);

  if (siteIds.length > 0) {
    const sites = await prisma.site.findMany({
      where: { id: { in: siteIds } },
      select: { id: true, name: true },
    });

    for (const site of sites) {
      const existing = await prisma.storedDocument.findFirst({
        where: {
          siteId: site.id,
          kind: 'WORK_SLIP',
          fileName: files.workSlip.fileName,
          subject,
        },
        select: { id: true },
      });

      if (existing) {
        counts.workSlipsSkipped += 1;
        continue;
      }

      const { workSlipsDir } = await ensureSiteDayFolders({
        siteId: site.id,
        siteName: site.name,
        dayYmd: todayYmd,
      });

      const storedName = `${stamp}__shared-sync__${fileSafeName}`;
      const storedPath = join(workSlipsDir, storedName);
      await writeFile(storedPath, slipBuffer);

      await prisma.storedDocument.create({
        data: {
          siteId: site.id,
          kind: 'WORK_SLIP',
          subject,
          bizDateYmd: todayYmd,
          fileName: files.workSlip.fileName,
          mimeType: workSlipMimeByExtension(files.workSlip.extension),
          sizeBytes: slipBuffer.length,
          storedPath,
          tags: {
            sharedSync: true,
            source: '作業伝票',
            sourceFileName: files.workSlip.fileName,
            sourceMtimeIso: new Date(files.workSlip.mtimeMs).toISOString(),
          },
        },
        select: { id: true },
      });

      counts.workSlipsCreated += 1;
    }
  }

  const warnings: string[] = [];
  if (counts.unknownUsers > 0) {
    warnings.push(`担当者名が一致しない行が ${counts.unknownUsers} 件あり、週予定へは未反映です。`);
  }

  return {
    ...buildPreview({ files, kind, warnings }),
    mode: 'sync',
    counts,
  };
}
