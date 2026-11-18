import { prisma } from '@/server/db/prisma';
import { Prisma } from '@/generated/prisma';
import { ensurePartnerByName, findMatchingSite, normalizeRegistryText } from '@/server/site-registry';
import { readGlobalScheduleUserOrder, saveScheduleUserOrderForAllUsers } from '@/server/schedule-user-order';
import { ensureSiteDayFolders } from '@/server/site-storage';
import {
  DEFAULT_COLOR_PALETTE,
  attachCellFontColors,
  getCellFont,
  isRedRgb,
  resolveColorAttrs,
} from '@/server/excel-font-color';
import { normalizeTextStrippingReadingParens } from '@/shared/site-lookup';
import { tryAcquireSharedSyncLock, type SharedSyncScope } from '@/server/shared-sync-lock';
import { recordSharedSyncStatus } from '@/server/shared-sync-status';
import { resolveWorkSlipLedgerSheets, type WorkSlipLedgerSheets } from '@/shared/work-slip-tabs';
import { snapshotToSheetJs } from '@/shared/work-slip-book-convert';
import { getCurrentMeta, readVersion as readBookVersion } from '@/server/work-slip-book';
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
  sizeBytes: number;
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
  assignees: Array<{ name: string; color: 'default' | 'red' }>;
};

export type WorkSlipLedgerRow = {
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
  scheduleUpdated: number;
  scheduleDeleted: number;
  /** 変更なし(既に原本と一致) */
  scheduleSkipped: number;
  /** 原本の内容で上書きした、同期由来でない既存予定(手入力など) */
  scheduleOverwritten: number;
  workSlipsCreated: number;
  workSlipsSkipped: number;
  unknownUsers: number;
  furiganaSitesBackfilled: number;
  furiganaSummariesBackfilled: number;
};

type SharedSyncUserRecord = {
  id: string;
  name: string | null;
  nameLabelColor: 'default' | 'red';
  showInSchedule: boolean;
  createdAt: Date | null;
};

export type SharedSyncPreview = {
  ok: true;
  sharedDir: string;
  kind: SiteKind;
  selected: {
    workTable: { fileName: string; mtimeIso: string } | null;
    workSlip: { fileName: string; mtimeIso: string; term: number | null; period: string | null } | null;
  };
  /** 台帳・関係会社の引用に使う作業伝票のタブ */
  ledgerTabs: { targetYm: string; monthSheet: string | null; originalSheet: string | null } | null;
  warnings: string[];
};

export type SharedSyncRunResult = SharedSyncPreview & {
  mode: 'sync';
  counts: SharedSyncCounts;
};

export type SharedSyncSourceVersion = {
  kind: SiteKind;
  sharedDir: string;
  hasSources: boolean;
  key: string | null;
  workTableFileName: string | null;
  workTableMtimeMs: number | null;
  workSlipFileName: string | null;
  workSlipMtimeMs: number | null;
};

export class SharedSyncError extends Error {
  code: 'MISSING_SOURCE' | 'PASSWORD_PROTECTED' | 'SYNC_FAILED' | 'BUSY';

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

const USER_NAME_VARIANT_GROUPS: string[][] = [
  ['斎', '斉', '齋', '齊'],
  ['辺', '邊', '邉'],
  ['高', '髙'],
  ['崎', '﨑'],
  ['桜', '櫻'],
  ['沢', '澤'],
  ['広', '廣'],
  ['国', '國'],
  ['浜', '濱'],
];

const USER_NAME_VARIANT_CHAR_MAP: ReadonlyMap<string, string> = new Map(
  USER_NAME_VARIANT_GROUPS.flatMap((group) => group.map((ch) => [ch, group[0]] as const)),
);

// User-name matching only; must not affect site/company registry keys.
function normalizeUserKey(text: string | null | undefined): string {
  const base = normalizeKey(text);
  let result = '';
  for (const ch of base) {
    result += USER_NAME_VARIANT_CHAR_MAP.get(ch) ?? ch;
  }
  return result;
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

// SheetJS CE の cell.s はフォント色を持たない(塗りつぶしのみ)ため、セル全体の文字色は attachCellFontColors が styles.xml から付与した値を使う。
function detectCellEntryColor(cell: unknown): 'default' | 'red' {
  const c = cell as { r?: unknown } | null;
  const parts = parseRichRunParts(typeof c?.r === 'string' ? c.r : null, cell);
  if (parts.length > 0) return parts.some((part) => part.color === 'red') ? 'red' : 'default';
  return isRedRgb(getCellFont(cell)?.rgb) ? 'red' : 'default';
}

function normalizeNameLabelColor(value: unknown): 'default' | 'red' {
  return value === 'red' ? 'red' : 'default';
}

function parseRichRunParts(
  rawRich: string | null | undefined,
  cell?: unknown,
): Array<{ text: string; color: 'default' | 'red' }> {
  if (!rawRich) return [];
  const runRegex = /<r>([\s\S]*?)<\/r>/g;
  const result: Array<{ text: string; color: 'default' | 'red' }> = [];
  // リッチ文字列の run は自前の書式で描画され、<color> が無い run はセルのフォント色を継承せず自動色(黒)で表示される(9/7週 E13 で実測)。
  const cellFont = getCellFont(cell);
  const palette = cellFont?.palette ?? DEFAULT_COLOR_PALETTE;

  let runMatch: RegExpExecArray | null = null;
  while ((runMatch = runRegex.exec(rawRich)) !== null) {
    const runBlock = runMatch[1] ?? '';
    const textMatches = Array.from(runBlock.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g));
    const text = decodeXmlText(textMatches.map((x) => x[1] ?? '').join(''));
    if (!text) continue;
    const colorAttrs = /<color\b([^>]*)>/i.exec(runBlock)?.[1];
    const rgb = colorAttrs != null ? resolveColorAttrs(colorAttrs, palette) : null;
    result.push({ text, color: isRedRgb(rgb) ? 'red' : 'default' });
  }

  // <r> run が無いセルはフォールバックで raw <t> を素朴に全走査しない。
  // <rPh>(ふりがな注記)も内部に <t> を持つため、フォールバックだと本文+読み仮名が連結され文字化けする
  // (実データ確認例: セル値「月」+ <rPh>「ゲツ」→ 誤って「月ゲツ」になる)。
  // run が無い場合は呼び出し側 (splitSiteEntriesFromCell) の fallbackText(=cell.v由来の正常値)と
  // detectCellEntryColor(セル単位のstyle色)に判定を委ねる。
  return result;
}


export function splitSiteEntriesFromCell(cell: unknown, fallbackText: string): Array<{ siteName: string; color: 'default' | 'red'; itemIndex: number }> {
  const c = cell as { r?: unknown } | null;
  const parts = parseRichRunParts(typeof c?.r === 'string' ? c.r : null, cell);
  const partList = parts.length > 0 ? parts : [{ text: fallbackText, color: detectCellEntryColor(cell) }];
  const delimiter = /([、,，\/／\r\n]+|[ \t]{2,}|　{2,})/;

  const collected: Array<{ siteName: string; color: 'default' | 'red' }> = [];
  let buf = '';
  let bufColor: 'default' | 'red' = 'default';
  const flush = () => {
    const normalized = normalizeTextStrippingReadingParens(buf);
    buf = '';
    if (!normalized) {
      return;
    }
    collected.push({ siteName: normalized, color: bufColor });
  };

  for (const part of partList) {
    const tokens = part.text.split(delimiter);
    for (const token of tokens) {
      if (!token) continue;
      if (delimiter.test(token)) {
        flush();
        continue;
      }
      // 空白のみの断片は色境界にしない(別色の空白で同色の文字列が分断されるのを防ぐ)
      if (!token.trim()) {
        if (buf) buf += token;
        continue;
      }

      if (buf && part.color !== bufColor) {
        flush();
      }
      if (!buf) {
        bufColor = part.color;
      }
      buf += token;
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
    // Excel が開いている間にできるロックファイル(~$...)や隠しファイルは対象外
    if (dirent.name.startsWith('~$') || dirent.name.startsWith('.')) continue;
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
      sizeBytes: stat.size,
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

export function readWorkbook(filePath: string, options?: { fontColors?: boolean }): XLSX.WorkBook {
  try {
    const workbook = XLSX.readFile(filePath, {
      cellDates: true,
      cellStyles: true,
      cellHTML: true,
      dense: false,
      // セル全体の文字色は zip 内の styles.xml から読む(.xlsx のみ)
      bookFiles: options?.fontColors === true,
    });
    if (options?.fontColors === true) attachCellFontColors(workbook);
    return workbook;
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

// gridFromSheet は空行を除外するため、grid の行添字と実セルの行番号がずれる(空行を含むシートで色/リッチ文字の取得元がずれる)。
// grid 行添字 → 実シート行番号の対応を作り、色判定用のセル参照を実番地で行う。
type GridCellResolver = (gridRow: number, gridCol: number) => unknown;

function createGridCellResolver(sheet: XLSX.WorkSheet): GridCellResolver {
  const ref = sheet['!ref'];
  if (!ref) return () => undefined;
  const range = XLSX.utils.decode_range(ref);
  const rowNumbers: number[] = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cell = (sheet as Record<string, unknown>)[XLSX.utils.encode_cell({ r, c })] as { v?: unknown } | undefined;
      if (cell && cell.v != null) {
        rowNumbers.push(r);
        break;
      }
    }
  }
  return (gridRow, gridCol) => {
    const sheetRow = rowNumbers[gridRow];
    if (sheetRow == null) return undefined;
    return (sheet as Record<string, unknown>)[XLSX.utils.encode_cell({ r: sheetRow, c: range.s.c + gridCol })];
  };
}

// 年なし(「M月D日」)の日付は、基準日(原本の更新日)に最も近い年を採用する。年末年始の編集でも年がずれない。
function resolveYearNearBase(month: number, day: number, baseDate: Date): number {
  const baseYear = baseDate.getFullYear();
  let bestYear = baseYear;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const year of [baseYear - 1, baseYear, baseYear + 1]) {
    const diff = Math.abs(new Date(year, month - 1, day).getTime() - baseDate.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      bestYear = year;
    }
  }
  return bestYear;
}

function parseDateToYmd(value: unknown, baseDate: Date): string | null {
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
      return `${resolveYearNearBase(m, d, baseDate)}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return null;
}

function splitAssigneeTokens(input: string | null | undefined): string[] {
  const normalized = normalizeRegistryText(input);
  if (!normalized) return [];
  return normalized
    .split(/[、,，\/／・]+/)
    .map((x) => normalizeRegistryText(x))
    .filter(Boolean);
}

// 担当者名ごとの色。名前の途中で色が変わる場合は1文字でも赤があれば赤とし、run の連結文字列が cell 値と一致しない時はセル単位の色にする。
function colorAssigneeTokens(
  text: string | null | undefined,
  cell: unknown,
): Array<{ token: string; color: 'default' | 'red' }> {
  const tokens = splitAssigneeTokens(text);
  const cellColor = detectCellEntryColor(cell);
  const whole = tokens.map((token) => ({ token, color: cellColor }));
  const c = cell as { r?: unknown } | null;
  const parts = parseRichRunParts(typeof c?.r === 'string' ? c.r : null, cell);
  if (parts.length === 0) return whole;

  const full = parts.map((p) => p.text).join('');
  const charRed = parts.flatMap((p) => Array.from({ length: p.text.length }, () => p.color === 'red'));
  const segments: Array<{ token: string; color: 'default' | 'red' }> = [];
  const delimiter = /[、,，\/／・]+/g;
  let start = 0;
  const push = (end: number) => {
    const token = normalizeRegistryText(full.slice(start, end));
    if (!token) return;
    const red = charRed.slice(start, end).some((isRed, i) => isRed && full[start + i]!.trim() !== '');
    segments.push({ token, color: red ? 'red' : 'default' });
  };
  let match: RegExpExecArray | null = null;
  while ((match = delimiter.exec(full)) !== null) {
    push(match.index);
    start = match.index + match[0].length;
  }
  push(full.length);

  const same = segments.length === tokens.length && segments.every((s, i) => s.token === tokens[i]);
  return same ? segments : whole;
}

export function splitAssigneesFromCells(
  ...inputs: Array<{ text: string | null | undefined; cell?: unknown }>
): Array<{ name: string; color: 'default' | 'red' }> {
  const result: Array<{ name: string; color: 'default' | 'red' }> = [];
  const indexByKey = new Map<string, number>();

  for (const input of inputs) {
    for (const { token, color } of colorAssigneeTokens(input.text, input.cell)) {
      const key = normalizeUserKey(token);
      if (!key) continue;
      const existingIndex = indexByKey.get(key);
      if (existingIndex != null) {
        if (color === 'red') {
          result[existingIndex] = { ...result[existingIndex]!, color: 'red' };
        }
        continue;
      }
      indexByKey.set(key, result.length);
      result.push({ name: token, color });
    }
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

function extractWorkTableRowsFromMatrix(
  sheet: XLSX.WorkSheet,
  grid: unknown[][],
  baseDate: Date,
  coveredDays: Set<string>,
): WorkTableRow[] {
  // Week-matrix format: first column is assignee, date headers are on one row.
  const rows: WorkTableRow[] = [];
  const cellAt = createGridCellResolver(sheet);

  let headerRowIndex = -1;
  let dateCols: number[] = [];
  for (let rowIndex = 0; rowIndex < Math.min(30, grid.length); rowIndex += 1) {
    const row = grid[rowIndex] ?? [];
    const cols: number[] = [];
    for (let col = 0; col < row.length; col += 1) {
      if (parseDateToYmd(row[col], baseDate)) cols.push(col);
    }
    if (cols.length >= 4) {
      headerRowIndex = rowIndex;
      dateCols = cols;
      break;
    }
  }
  if (headerRowIndex < 0 || dateCols.length === 0) return rows;

  // 日付見出しの日は、予定が空でも「原本が扱っている日」として扱う(消した予定を反映するため)
  for (const col of dateCols) {
    const headerDay = parseDateToYmd((grid[headerRowIndex] ?? [])[col], baseDate);
    if (headerDay) coveredDays.add(headerDay);
  }

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
      const dayYmd = parseDateToYmd((grid[headerRowIndex] ?? [])[col], baseDate);
      const siteName = normalizeTextStrippingReadingParens(toCellText(row[col]));
      if (!dayYmd || !siteName) continue;

      const cell = cellAt(rowIndex, col);
      const entries = splitSiteEntriesFromCell(cell, siteName);
      if (entries.length === 0) continue;
      const assigneeCell = cellAt(rowIndex, 0);

      rows.push({
        dayYmd,
        companyName: null,
        entries,
        assignees: splitAssigneesFromCells({ text: assignee, cell: assigneeCell }),
      });
    }
  }

  return rows;
}

export type WorkTableExtraction = {
  rows: WorkTableRow[];
  /** 原本が扱っている日の範囲(最小日〜最大日。予定のある日だけではない)。日付が読めない場合は null */
  coveredRange: { minDay: string; maxDay: string } | null;
};

export function extractWorkTableRows(workbook: XLSX.WorkBook, baseDate: Date = new Date()): WorkTableRow[] {
  return extractWorkTable(workbook, baseDate).rows;
}

export function extractWorkTable(workbook: XLSX.WorkBook, baseDate: Date = new Date()): WorkTableExtraction {
  const rows: WorkTableRow[] = [];
  const coveredDays = new Set<string>();

  for (const sheetName of workbook.SheetNames ?? []) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const grid = gridFromSheet(sheet);
    const cellAt = createGridCellResolver(sheet);
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
        const siteName = normalizeTextStrippingReadingParens(toCellText(row[found.indexMap.site]));
        const dateYmd = parseDateToYmd(row[found.indexMap.date], baseDate);
        if (dateYmd) coveredDays.add(dateYmd);
        const companyName = normalizeRegistryText(toCellText(row[found.indexMap.company]));
        const lead = normalizeRegistryText(toCellText(row[found.indexMap.lead]));
        const members = normalizeRegistryText(toCellText(row[found.indexMap.members]));
        const driver = normalizeRegistryText(toCellText(row[found.indexMap.driver]));
        const assignees = splitAssigneesFromCells(
          {
            text: lead,
            cell: cellAt(rowIndex, found.indexMap.lead),
          },
          {
            text: members,
            cell: cellAt(rowIndex, found.indexMap.members),
          },
          {
            text: driver,
            cell: cellAt(rowIndex, found.indexMap.driver),
          },
        );
        const cell = cellAt(rowIndex, found.indexMap.site);
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
      sheetRows.push(...extractWorkTableRowsFromMatrix(sheet, grid, baseDate, coveredDays));
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
      const key = `${row.dayYmd}|${normalizeKey(assignee.name)}|${normalizeKey(row.companyName)}|${filteredEntries.map((x) => `${normalizeKey(x.siteName)}:${x.color}`).join('|')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hasNewKey = true;
    }
    if (!hasNewKey) continue;
    deduped.push({ ...row, entries: filteredEntries });
  }
  const sortedDays = Array.from(coveredDays).sort();
  return {
    rows: deduped,
    coveredRange: sortedDays.length > 0 ? { minDay: sortedDays[0], maxDay: sortedDays[sortedDays.length - 1] } : null,
  };
}

// 台帳・関係会社の引用元は「当該月」と「作業伝票オリジナル」のタブのみ(見つからない時は全シートへフォールバックしない)。
// 重複(会社+現場)は当該月のタブを優先し、金額だけ空の場合にオリジナルで補う。
export function extractWorkSlipLedgerRows(
  workbook: XLSX.WorkBook,
  asOfYmd: string = todayYmdTokyo(),
): { rows: WorkSlipLedgerRow[]; sheets: WorkSlipLedgerSheets } {
  const rows: WorkSlipLedgerRow[] = [];
  const sheets = resolveWorkSlipLedgerSheets(workbook.SheetNames ?? [], asOfYmd);
  const targetSheetNames = [sheets.monthSheet, sheets.originalSheet].filter((name): name is string => !!name);

  for (const sheetName of targetSheetNames) {
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
      const siteName = normalizeTextStrippingReadingParens(toCellText(row[found.indexMap.site]));
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

  return { rows: Array.from(dedupedByName.values()), sheets };
}

function startOfDayUtc(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function startOfSharedSyncDay(ymd: string): Date {
  const base = startOfDayUtc(ymd);
  // Keep shared-sync entries away from timezone day-boundary to avoid cross-env day drift.
  return addMinutes(base, 12 * 60);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = startOfDayUtc(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

function getSharedSyncRowKey(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const shared = (value as Record<string, unknown>).sharedExcelSync;
  if (!shared || typeof shared !== 'object' || Array.isArray(shared)) return null;
  const rowKey = (shared as Record<string, unknown>).rowKey;
  return typeof rowKey === 'string' ? rowKey : null;
}

// キー順に依存しない比較用の文字列化(JSON の保存順が変わっても同一と判定する)
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(',')}}`;
}

function hasReadingParens(text: string): boolean {
  return /[（(]\s*[ぁ-ゖァ-ヺー・･\s]+\s*[）)]/u.test(text);
}

async function listSitesForFuriganaBackfill(kind: SiteKind): Promise<Array<{ id: string; name: string; companyName: string | null }>> {
  const items: Array<{ id: string; name: string; companyName: string | null }> = [];
  let cursor: string | null = null;

  for (;;) {
    const args: Parameters<typeof prisma.site.findMany>[0] = {
      where: { kind },
      select: { id: true, name: true, companyName: true },
      orderBy: { id: 'asc' },
      take: 1000,
    };
    if (cursor) {
      args.cursor = { id: cursor };
      args.skip = 1;
    }

    const batch = await prisma.site.findMany(args);
    items.push(...batch);
    if (batch.length < 1000) break;
    cursor = batch[batch.length - 1]?.id ?? null;
    if (!cursor) break;
  }

  return items;
}

// Only strips reading-parens still absent from the current 作業表☆ site names, so unrelated parens survive.
async function backfillFuriganaFromWorkTable(
  kind: SiteKind,
  scheduleRows: WorkTableRow[],
): Promise<{ sitesUpdated: number; summariesUpdated: number }> {
  const currentSiteNameKeys = new Set<string>();
  const currentCompanyNameKeys = new Set<string>();
  for (const row of scheduleRows) {
    if (row.companyName) currentCompanyNameKeys.add(normalizeKey(row.companyName));
    for (const entry of row.entries) currentSiteNameKeys.add(normalizeKey(entry.siteName));
  }

  let sitesUpdated = 0;
  const sites = await listSitesForFuriganaBackfill(kind);
  for (const site of sites) {
    const patch: { name?: string; companyName?: string | null } = {};

    if (hasReadingParens(site.name)) {
      const stripped = normalizeTextStrippingReadingParens(site.name);
      if (stripped && stripped !== site.name && currentSiteNameKeys.has(normalizeKey(stripped))) {
        patch.name = stripped;
      }
    }

    if (site.companyName && hasReadingParens(site.companyName)) {
      const strippedCompany = normalizeTextStrippingReadingParens(site.companyName);
      if (strippedCompany && strippedCompany !== site.companyName && currentCompanyNameKeys.has(normalizeKey(strippedCompany))) {
        patch.companyName = strippedCompany;
      }
    }

    if (Object.keys(patch).length === 0) continue;
    await prisma.site.update({ where: { id: site.id }, data: patch, select: { id: true } });
    sitesUpdated += 1;
  }

  let summariesUpdated = 0;
  let cursor: string | null = null;
  for (;;) {
    const args: Parameters<typeof prisma.workEntry.findMany>[0] = {
      where: { kind, summary: { not: null } },
      select: { id: true, summary: true },
      orderBy: { id: 'asc' },
      take: 1000,
    };
    if (cursor) {
      args.cursor = { id: cursor };
      args.skip = 1;
    }

    const batch = await prisma.workEntry.findMany(args);
    if (batch.length === 0) break;

    for (const entry of batch) {
      const summary = entry.summary ?? '';
      if (!summary || !hasReadingParens(summary)) continue;
      const stripped = normalizeTextStrippingReadingParens(summary);
      if (!stripped || stripped === summary || !currentSiteNameKeys.has(normalizeKey(stripped))) continue;

      await prisma.workEntry.update({ where: { id: entry.id }, data: { summary: stripped }, select: { id: true } });
      summariesUpdated += 1;
    }

    if (batch.length < 1000) break;
    cursor = batch[batch.length - 1]?.id ?? null;
    if (!cursor) break;
  }

  return { sitesUpdated, summariesUpdated };
}

async function listSharedSyncUsers(
  db: Pick<Prisma.TransactionClient, 'user'> | typeof prisma,
  kind: SiteKind,
): Promise<SharedSyncUserRecord[]> {
  try {
    const users = await db.user.findMany({
      where: { kind },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, nameLabelColor: true, showInSchedule: true, createdAt: true },
      take: 500,
    });
    return users.map((user) => ({ ...user, nameLabelColor: normalizeNameLabelColor(user.nameLabelColor) }));
  } catch {
    try {
      const fallbackUsers = await db.user.findMany({
        where: { kind },
        orderBy: { id: 'asc' },
        select: { id: true, name: true, showInSchedule: true },
        take: 500,
      });
      return fallbackUsers.map((user) => ({ ...user, nameLabelColor: 'default' as const, createdAt: null }));
    } catch {
      const minimalUsers = await db.user.findMany({
        where: { kind },
        orderBy: { id: 'asc' },
        select: { id: true, name: true },
        take: 500,
      });
      return minimalUsers.map((user) => ({ ...user, nameLabelColor: 'default' as const, showInSchedule: true, createdAt: null }));
    }
  }
}

async function updateSharedSyncUsers(
  db: Pick<Prisma.TransactionClient, 'user' | '$executeRaw'> | typeof prisma,
  userIds: string[],
  patch: { name?: string | null; nameLabelColor?: 'default' | 'red'; showInSchedule?: boolean },
): Promise<void> {
  if (userIds.length === 0) return;

  const assignments: Prisma.Sql[] = [];
  if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
    assignments.push(Prisma.sql`"name" = ${patch.name ?? null}`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'nameLabelColor')) {
    assignments.push(Prisma.sql`"nameLabelColor" = ${patch.nameLabelColor ?? 'default'}`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'showInSchedule')) {
    assignments.push(Prisma.sql`"showInSchedule" = ${patch.showInSchedule === true}`);
  }
  if (assignments.length === 0) return;

  if (userIds.length === 1) {
    try {
      await db.user.update({
        where: { id: userIds[0] },
        data: patch,
        select: { id: true },
      });
      return;
    } catch {
      // Fall through to raw SQL below.
    }
  } else {
    try {
      await db.user.updateMany({
        where: { id: { in: userIds } },
        data: patch,
      });
      return;
    } catch {
      // Fall through to raw SQL below.
    }
  }

  try {
    await db.$executeRaw(
      Prisma.sql`UPDATE "User" SET ${Prisma.join(assignments, ', ')} WHERE "id" IN (${Prisma.join(userIds)})`,
    );
  } catch (error) {
    if (Object.prototype.hasOwnProperty.call(patch, 'nameLabelColor')) {
      const fallbackPatch = { ...patch };
      delete fallbackPatch.nameLabelColor;
      if (Object.keys(fallbackPatch).length > 0) {
        await updateSharedSyncUsers(db, userIds, fallbackPatch);
      }
      return;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'showInSchedule')) {
      if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
        await updateSharedSyncUsers(db, userIds, { name: patch.name ?? null });
      }
      return;
    }
    throw error;
  }
}

async function createSharedSyncUser(
  kind: SiteKind,
  assigneeName: string,
  assigneeColor: 'default' | 'red',
): Promise<{ id: string; name: string | null; nameLabelColor: 'default' | 'red'; showInSchedule: boolean } | null> {
  try {
    const created = await prisma.user.create({
      data: {
        kind,
        name: assigneeName,
        nameLabelColor: assigneeColor,
        showInSchedule: true,
      },
      select: { id: true, name: true, nameLabelColor: true, showInSchedule: true },
    });
    return { ...created, nameLabelColor: normalizeNameLabelColor(created.nameLabelColor) };
  } catch {
    try {
      const created = await prisma.user.create({
        data: {
          kind,
          name: assigneeName,
        },
        select: { id: true, name: true },
      });
      return { ...created, nameLabelColor: 'default', showInSchedule: true };
    } catch {
      return null;
    }
  }
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

function buildPreview(input: {
  files: DiscoveredSharedFiles;
  kind: SiteKind;
  warnings?: string[];
  ledgerSheets?: WorkSlipLedgerSheets | null;
}): SharedSyncPreview {
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
    ledgerTabs: input.ledgerSheets
      ? {
          targetYm: input.ledgerSheets.targetYm,
          monthSheet: input.ledgerSheets.monthSheet,
          originalSheet: input.ledgerSheets.originalSheet,
        }
      : null,
    warnings: input.warnings ?? [],
  };
}

export async function getSharedSyncPreview(input: { kind: SiteKind; targetTerm?: number | null }): Promise<SharedSyncPreview> {
  const files = await discoverSharedFiles(input.targetTerm ?? null);
  const warnings: string[] = [];

  if (!files.workTable) warnings.push('共有フォルダ直下に 作業表☆(.xls/.xlsx) が見つかりません。');
  if (!files.workSlip) warnings.push('共有フォルダ直下に 作業伝票 系(.xls/.xlsx) が見つかりません。');
  if (files.workSlipCandidates > 1) warnings.push(`作業伝票候補が ${files.workSlipCandidates} 件あります。対象期一致 > 更新日時の優先順で選択します。`);

  let ledgerSheets: WorkSlipLedgerSheets | null = null;
  if (files.workSlip) {
    try {
      // シート名だけを読む(本文は読まない)
      const names = XLSX.readFile(files.workSlip.filePath, { bookSheets: true }).SheetNames ?? [];
      ledgerSheets = resolveWorkSlipLedgerSheets(names, todayYmdTokyo());
      warnings.push(...ledgerSheets.warnings);
    } catch (error) {
      warnings.push(`作業伝票のタブ確認に失敗: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return buildPreview({ files, kind: input.kind, warnings, ledgerSheets });
}

// 作業伝票ブックの初期取込用(共有フォルダの対象期ファイル)
export async function getSharedWorkSlipFile(): Promise<{ filePath: string; fileName: string; mtimeMs: number } | null> {
  const files = await discoverSharedFiles(null);
  return files.workSlip ? { filePath: files.workSlip.filePath, fileName: files.workSlip.fileName, mtimeMs: files.workSlip.mtimeMs } : null;
}

export async function getSharedSyncSourceVersion(input: {
  kind: SiteKind;
  targetTerm?: number | null;
  scope?: SharedSyncScope;
}): Promise<SharedSyncSourceVersion> {
  const files = await discoverSharedFiles(input.targetTerm ?? null);
  const workTableMtimeMs = files.workTable?.mtimeMs ?? null;
  const workSlipMtimeMs = files.workSlip?.mtimeMs ?? null;
  // 週予定の同期は作業表☆だけで動く(作業伝票ファイルが無くても止めない)。
  const scheduleOnly = input.scope === 'schedule';
  const hasSources = !!files.workTable && (scheduleOnly || !!files.workSlip);
  const key = !hasSources
    ? null
    : scheduleOnly
      ? `${input.kind}|${files.workTable?.fileName ?? ''}|${workTableMtimeMs ?? 0}|${files.workTable?.sizeBytes ?? 0}`
      : `${input.kind}|${files.workTable?.fileName ?? ''}|${workTableMtimeMs ?? 0}|${files.workSlip?.fileName ?? ''}|${workSlipMtimeMs ?? 0}`;

  return {
    kind: input.kind,
    sharedDir: files.sharedDir,
    hasSources,
    key,
    workTableFileName: files.workTable?.fileName ?? null,
    workTableMtimeMs,
    workSlipFileName: files.workSlip?.fileName ?? null,
    workSlipMtimeMs,
  };
}

type SharedSyncInput = { kind: SiteKind; targetTerm?: number | null; scope?: SharedSyncScope };

// scope: schedule=週予定のみ(5分おき・軽量) / ledger=台帳・関係会社・作業伝票コピー・ふりがな補完(30分おき) / all=手動同期(既定)
export async function runSharedSync(input: SharedSyncInput): Promise<SharedSyncRunResult> {
  const scope = input.scope ?? 'all';
  const release = await tryAcquireSharedSyncLock(scope);
  if (!release) throw new SharedSyncError('BUSY', `別の共有フォルダ同期(${scope})が実行中です。完了後にやり直してください。`);
  const startedAt = Date.now();
  try {
    const result = await runSharedSyncUnlocked({ ...input, scope });
    await recordSharedSyncStatus(scope, {
      kind: input.kind,
      at: new Date().toISOString(),
      result: 'success',
      durationMs: Date.now() - startedAt,
      counts: result.counts,
      warnings: result.warnings.slice(0, 5),
    });
    return result;
  } catch (error) {
    await recordSharedSyncStatus(scope, {
      kind: input.kind,
      at: new Date().toISOString(),
      result: 'failed',
      durationMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await release();
  }
}

async function readWorkbookWithRetry(filePath: string, options?: { fontColors?: boolean }): Promise<XLSX.WorkBook> {
  // 原本の保存中に読んでしまった場合に備えて、数秒空けて再試行する(パスワード保護は再試行しない)。
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return readWorkbook(filePath, options);
    } catch (error) {
      if (attempt >= maxAttempts || (error instanceof SharedSyncError && error.code === 'PASSWORD_PROTECTED')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

async function runSharedSyncUnlocked(input: SharedSyncInput): Promise<SharedSyncRunResult> {
  const scope = input.scope ?? 'all';
  const needSchedule = scope !== 'ledger';
  const needLedger = scope !== 'schedule';
  const files = await discoverSharedFiles(input.targetTerm ?? null);

  const requiresWorkSlip = needLedger;
  if (!files.workTable || (requiresWorkSlip && !files.workSlip)) {
    const missing = [
      !files.workTable ? '作業表☆(.xls/.xlsx)' : null,
      requiresWorkSlip && !files.workSlip ? '作業伝票系(.xls/.xlsx)' : null,
    ].filter(Boolean);
    throw new SharedSyncError('MISSING_SOURCE', `共有フォルダに必要ファイルがありません: ${missing.join(' / ')}`);
  }

  const kind = input.kind;
  const workTableFileName = files.workTable.fileName;

  const workTableBook = await readWorkbookWithRetry(files.workTable.filePath, { fontColors: needSchedule });
  // 年なしの日付は原本の更新日に最も近い年で補う
  const workTable = extractWorkTable(workTableBook, new Date(files.workTable.mtimeMs));
  const scheduleRows = workTable.rows;
  const warnings: string[] = [];
  let ledgerRows: WorkSlipLedgerRow[] = [];
  let ledgerSheets: WorkSlipLedgerSheets | null = null;
  if (needLedger && files.workSlip) {
    // アプリ内の作業伝票ブックが正本。無い間だけ共有フォルダの作業伝票から読む。
    const bookMeta = await getCurrentMeta();
    const bookSnapshot = bookMeta ? await readBookVersion(bookMeta.version) : null;
    const workSlipBook = bookSnapshot ? snapshotToSheetJs(bookSnapshot) : readWorkbook(files.workSlip.filePath);
    const extracted = extractWorkSlipLedgerRows(workSlipBook);
    ledgerRows = extracted.rows;
    ledgerSheets = extracted.sheets;
    warnings.push(...extracted.sheets.warnings);
  }
  if (needSchedule && files.workTable.extension === '.xls') {
    warnings.push('作業表☆が .xls のため、セル全体の赤文字は読み取れません(一部の文字だけ赤い場合のみ反映)。.xlsx で保存してください。');
  }

  const counts: SharedSyncCounts = {
    sitesCreated: 0,
    sitesUpdated: 0,
    sitesMatched: 0,
    sitesSkipped: 0,
    scheduleCreated: 0,
    scheduleUpdated: 0,
    scheduleDeleted: 0,
    scheduleSkipped: 0,
    scheduleOverwritten: 0,
    workSlipsCreated: 0,
    workSlipsSkipped: 0,
    unknownUsers: 0,
    furiganaSitesBackfilled: 0,
    furiganaSummariesBackfilled: 0,
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

  if (needSchedule) {
    await syncScheduleEntries({
      kind,
      scheduleRows,
      coveredRange: workTable.coveredRange,
      workTableFileName,
      counts,
      warnings,
    });
  }

  // 作業伝票の保存コピーは台帳側(ledger)の処理。週予定だけの同期では作業伝票ファイルに触れない。
  const slipFile = needLedger ? files.workSlip : null;
  const todayYmd = todayYmdTokyo();
  const fileSafeName = safeStoredFileName(slipFile?.fileName ?? '');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const subject = `共有同期: ${slipFile?.baseName ?? ''}`;
  const siteIds = slipFile ? Array.from(touchedSiteIds) : [];

  if (slipFile && siteIds.length > 0) {
    try {
      const slipBuffer = await (await import('node:fs/promises')).readFile(slipFile.filePath);
      const sites = await prisma.site.findMany({
        where: { id: { in: siteIds } },
        select: { id: true, name: true },
      });

      for (const site of sites) {
        const existing = await prisma.storedDocument.findFirst({
          where: {
            siteId: site.id,
            kind: 'WORK_SLIP',
            fileName: slipFile.fileName,
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
            fileName: slipFile.fileName,
            mimeType: workSlipMimeByExtension(slipFile.extension),
            sizeBytes: slipBuffer.length,
            storedPath,
            tags: {
              sharedSync: true,
              source: '作業伝票',
              sourceFileName: slipFile.fileName,
              sourceMtimeIso: new Date(slipFile.mtimeMs).toISOString(),
            },
          },
          select: { id: true },
        });

        counts.workSlipsCreated += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`作業伝票コピーはスキップしました: ${message}`);
    }
  }

  if (needLedger) {
    const furiganaBackfill = await backfillFuriganaFromWorkTable(kind, scheduleRows);
    counts.furiganaSitesBackfilled = furiganaBackfill.sitesUpdated;
    counts.furiganaSummariesBackfilled = furiganaBackfill.summariesUpdated;
  }

  return {
    ...buildPreview({ files, kind, warnings, ledgerSheets }),
    mode: 'sync',
    counts,
  };
}

// 作業表☆(原本)の内容を週予定へ反映する。原本が扱っている日付範囲を「完全同期」し、差分(追加・更新・削除)だけを1トランザクションで書く。
async function syncScheduleEntries(args: {
  kind: SiteKind;
  scheduleRows: WorkTableRow[];
  coveredRange: WorkTableExtraction['coveredRange'];
  workTableFileName: string;
  counts: SharedSyncCounts;
  warnings: string[];
}): Promise<void> {
  const { kind, scheduleRows, coveredRange, workTableFileName, counts, warnings } = args;
  const unknownAssigneeNames = new Set<string>();

  const users = await listSharedSyncUsers(prisma, kind);
  const globalOrder = await readGlobalScheduleUserOrder(kind);
  const globalOrderIndex = new Map<string, number>(globalOrder.map((id, index) => [id, index] as const));

  const assigneeByKey = new Map<string, { name: string; color: 'default' | 'red' }>();
  const assigneeKeyOrder: string[] = [];
  for (const row of scheduleRows) {
    for (const assignee of row.assignees) {
      const key = normalizeUserKey(assignee.name);
      if (!key) continue;
      const existing = assigneeByKey.get(key);
      if (!existing) {
        assigneeByKey.set(key, { ...assignee });
        assigneeKeyOrder.push(key);
        continue;
      }
      if (existing.color !== 'red' && assignee.color === 'red') {
        assigneeByKey.set(key, { ...existing, color: 'red' });
      }
    }
  }

  const selectCanonicalUser = (candidates: SharedSyncUserRecord[]) => {
    const sorted = [...candidates].sort((left, right) => {
      const leftOrder = globalOrderIndex.get(left.id);
      const rightOrder = globalOrderIndex.get(right.id);
      if (leftOrder != null && rightOrder != null && leftOrder !== rightOrder) return leftOrder - rightOrder;
      if (leftOrder != null && rightOrder == null) return -1;
      if (leftOrder == null && rightOrder != null) return 1;
      if (left.createdAt && right.createdAt) {
        const createdDiff = left.createdAt.getTime() - right.createdAt.getTime();
        if (createdDiff !== 0) return createdDiff;
      } else if (left.createdAt && !right.createdAt) {
        return -1;
      } else if (!left.createdAt && right.createdAt) {
        return 1;
      }
      return left.id.localeCompare(right.id);
    });
    return sorted[0] ?? null;
  };

  const duplicateUserIds = new Set<string>();

  const consolidateDuplicateUsers = async (sourceUsers: SharedSyncUserRecord[]) => {
    const byNameKey = new Map<string, SharedSyncUserRecord[]>();
    for (const user of sourceUsers) {
      const key = normalizeUserKey(user.name);
      if (!key) continue;
      const hit = byNameKey.get(key) ?? [];
      hit.push(user);
      byNameKey.set(key, hit);
    }

    const mergePlan: Array<{ canonicalId: string; duplicateIds: string[] }> = [];
    for (const candidates of byNameKey.values()) {
      if (candidates.length <= 1) continue;
      const canonical = selectCanonicalUser(candidates);
      if (!canonical) continue;
      const duplicateIds = candidates.filter((candidate) => candidate.id !== canonical.id).map((candidate) => candidate.id);
      if (duplicateIds.length === 0) continue;
      duplicateIds.forEach((id) => duplicateUserIds.add(id));
      mergePlan.push({ canonicalId: canonical.id, duplicateIds });
    }

    if (mergePlan.length === 0) return;

    for (const plan of mergePlan) {
      await prisma.workEntry.updateMany({
        where: { kind, userId: { in: plan.duplicateIds } },
        data: { userId: plan.canonicalId },
      });
      await updateSharedSyncUsers(prisma, plan.duplicateIds, { showInSchedule: false });
    }
  };

  await consolidateDuplicateUsers(users);
  const usersAfterConsolidation = await listSharedSyncUsers(prisma, kind);

  const userByName = new Map<string, { id: string; name: string; nameLabelColor: 'default' | 'red'; showInSchedule: boolean }>();
  const usersAfterByKey = new Map<string, SharedSyncUserRecord[]>();
  for (const user of usersAfterConsolidation) {
    const key = normalizeUserKey(user.name);
    if (!key) continue;
    const hit = usersAfterByKey.get(key) ?? [];
    hit.push(user);
    usersAfterByKey.set(key, hit);
  }
  for (const [key, candidates] of usersAfterByKey.entries()) {
    const canonical = selectCanonicalUser(candidates);
    if (!canonical) continue;
    userByName.set(key, {
      id: canonical.id,
      name: canonical.name ?? '',
      nameLabelColor: canonical.nameLabelColor ?? 'default',
      showInSchedule: canonical.showInSchedule,
    });
  }

  for (const key of assigneeKeyOrder) {
    const assignee = assigneeByKey.get(key);
    if (!assignee) continue;

    const existing = userByName.get(key);
    if (existing) {
      const patch: { name?: string | null; nameLabelColor?: 'default' | 'red'; showInSchedule?: boolean } = {};
      // Keep the canonical spelling instead of flipping between kanji variants each sync.
      if (!(existing.name ?? '').trim()) patch.name = assignee.name;
      if (existing.nameLabelColor !== assignee.color) patch.nameLabelColor = assignee.color;
      if (!existing.showInSchedule) patch.showInSchedule = true;

      if (Object.keys(patch).length > 0) {
        await updateSharedSyncUsers(prisma, [existing.id], patch);
        existing.name = patch.name ?? existing.name;
        existing.nameLabelColor = patch.nameLabelColor ?? existing.nameLabelColor;
        existing.showInSchedule = patch.showInSchedule ?? existing.showInSchedule;
      }
      continue;
    }

    const refreshedUsers = await listSharedSyncUsers(prisma, kind);
    const refreshedCandidates = refreshedUsers.filter((user) => normalizeUserKey(user.name) === key);
    const refreshedCanonical = selectCanonicalUser(refreshedCandidates);
    if (refreshedCanonical) {
      userByName.set(key, {
        id: refreshedCanonical.id,
        name: refreshedCanonical.name ?? assignee.name,
        nameLabelColor: refreshedCanonical.nameLabelColor ?? assignee.color,
        showInSchedule: refreshedCanonical.showInSchedule,
      });
      continue;
    }

    const created = await createSharedSyncUser(kind, assignee.name, assignee.color);
    if (!created) continue;
    userByName.set(key, {
      id: created.id,
      name: created.name ?? assignee.name,
      nameLabelColor: created.nameLabelColor ?? assignee.color,
      showInSchedule: created.showInSchedule,
    });
  }

  const scheduledUserOrderIds = assigneeKeyOrder
    .map((key) => userByName.get(key)?.id ?? null)
    .filter((id): id is string => !!id);
  const scheduledUserIdSet = new Set(scheduledUserOrderIds);
  const activeUserIds = usersAfterConsolidation
    .filter((user) => user.showInSchedule && !duplicateUserIds.has(user.id))
    .map((user) => user.id);
  const globalUserOrderIds = Array.from(
    new Set([
      ...scheduledUserOrderIds,
      ...activeUserIds.filter((id) => !scheduledUserIdSet.has(id)),
    ]),
  );
  await saveScheduleUserOrderForAllUsers(kind, globalUserOrderIds);

  const preparedRows: Array<{
    userId: string;
    dayYmd: string;
    summary: string;
    siteId: string | null;
    labelColor: 'default' | 'red';
    groupIndex: number;
    itemIndex: number;
    sourceKey: string;
  }> = [];

  for (const row of scheduleRows) {
    // 現場台帳・関係会社は作業伝票の2タブからのみ作る。作業表☆で台帳に無い現場は siteId なしの予定とする。
    const siteIdByEntryKey = new Map<string, string | null>();
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

      siteIdByEntryKey.set(entryKey, siteHit.site && !conflictByNameOnly ? siteHit.site.id : null);
    }

    for (const assignee of row.assignees) {
      const user = userByName.get(normalizeUserKey(assignee.name));
      if (!user) {
        counts.unknownUsers += 1;
        unknownAssigneeNames.add(assignee.name);
        continue;
      }

      for (const entry of row.entries) {
        const summary = entry.siteName;
        const entryKey = `${normalizeKey(entry.siteName)}|${entry.color}`;
        if (!siteIdByEntryKey.has(entryKey)) continue;
        const siteId = siteIdByEntryKey.get(entryKey) ?? null;

        const groupIndex = entry.color === 'red' ? 1 : 0;
        const itemIndexInGroup = row.entries
          .filter((candidate) => (candidate.color === 'red' ? 1 : 0) === groupIndex)
          .findIndex((candidate) => candidate.siteName === entry.siteName && candidate.color === entry.color);

        preparedRows.push({
          userId: user.id,
          dayYmd: row.dayYmd,
          summary,
          siteId,
          labelColor: entry.color,
          groupIndex,
          itemIndex: itemIndexInGroup < 0 ? entry.itemIndex : itemIndexInGroup,
          sourceKey: `${row.dayYmd}|${normalizeKey(assignee.name)}|${normalizeKey(row.companyName)}|${normalizeKey(summary)}|${entry.color}|${groupIndex}|${itemIndexInGroup < 0 ? entry.itemIndex : itemIndexInGroup}`,
        });
      }
    }
  }

  const uniqueRows = new Map<string, (typeof preparedRows)[number]>();
  for (const row of preparedRows) {
    if (!uniqueRows.has(row.sourceKey)) uniqueRows.set(row.sourceKey, row);
  }

  const finalRows = Array.from(uniqueRows.values());

  // 同期対象の日付範囲 = 原本が扱っている日(日付見出し・日付列)の最小〜最大。予定のある日だけでなく空の日も含める。
  let minDay: string | null = coveredRange?.minDay ?? null;
  let maxDay: string | null = coveredRange?.maxDay ?? null;
  const dataDays = new Set<string>();
  for (const row of finalRows) {
    dataDays.add(row.dayYmd);
    if (!minDay || row.dayYmd < minDay) minDay = row.dayYmd;
    if (!maxDay || row.dayYmd > maxDay) maxDay = row.dayYmd;
  }
  if (!minDay || !maxDay) {
    // 日付が1つも読めない = 原本を読み取れていない。誤って全削除しないよう何も変更しない。
    warnings.push('作業表☆から日付を読み取れなかったため、週予定は変更していません。');
    return;
  }

  // 誤った日付(年違いなど)が1つ混ざって範囲が極端に広がっても、広範囲を削除しない。
  const MAX_COVERED_SPAN_DAYS = 400;
  const spanDays = Math.round((startOfDayUtc(maxDay).getTime() - startOfDayUtc(minDay).getTime()) / 86_400_000);
  const rangeIsWide = spanDays > MAX_COVERED_SPAN_DAYS;
  if (rangeIsWide) {
    warnings.push(`作業表☆の日付範囲が ${spanDays} 日と広いため、予定のある日だけを同期対象にしました。`);
    const sortedDataDays = Array.from(dataDays).sort();
    if (sortedDataDays.length === 0) return;
    minDay = sortedDataDays[0];
    maxDay = sortedDataDays[sortedDataDays.length - 1];
  }
  const rangeMin = minDay;
  const rangeMax = maxDay;
  const isCoveredDay = (ymd: string) => (rangeIsWide ? dataDays.has(ymd) : ymd >= rangeMin && ymd <= rangeMax);

  // 同じ人・日で同じ現場は1件にまとめる(従来どおり)
  const desiredByCell = new Map<string, Array<(typeof finalRows)[number]>>();
  const desiredDedupe = new Set<string>();
  for (const row of finalRows) {
    const cellKey = `${row.userId}|${row.dayYmd}`;
    const dedupeKey = `${cellKey}|${row.siteId ? `site:${row.siteId}` : `name:${normalizeKey(row.summary)}`}`;
    if (desiredDedupe.has(dedupeKey)) continue;
    desiredDedupe.add(dedupeKey);
    const list = desiredByCell.get(cellKey) ?? [];
    list.push(row);
    desiredByCell.set(cellKey, list);
  }

  type ExistingScheduleRow = {
    id: string;
    userId: string;
    startAt: Date;
    summary: string | null;
    siteId: string | null;
    accountingMeta: Prisma.JsonValue | null;
  };

  await prisma.$transaction(
    async (tx) => {
      const existingRows: ExistingScheduleRow[] = await tx.workEntry.findMany({
        where: {
          kind,
          startAt: {
            gte: startOfDayUtc(addDaysYmd(rangeMin, -1)),
            lt: startOfDayUtc(addDaysYmd(rangeMax, 2)),
          },
        },
        select: { id: true, userId: true, startAt: true, summary: true, siteId: true, accountingMeta: true },
        orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      });

      const existingByCell = new Map<string, ExistingScheduleRow[]>();
      for (const row of existingRows) {
        const ymd = toYmdLocal(row.startAt);
        if (!isCoveredDay(ymd)) continue;
        const cellKey = `${row.userId}|${ymd}`;
        const list = existingByCell.get(cellKey) ?? [];
        list.push(row);
        existingByCell.set(cellKey, list);
      }

      const deleteIds: string[] = [];
      const updates: Array<{
        id: string;
        data: { startAt: Date; summary: string; siteId: string | null; accountingMeta: Prisma.InputJsonValue };
      }> = [];
      const createData: Array<{
        userId: string;
        kind: SiteKind;
        startAt: Date;
        summary: string;
        note: string | null;
        siteId: string | null;
        accountingMeta: Prisma.InputJsonValue;
      }> = [];

      const cellKeys = new Set<string>([...desiredByCell.keys(), ...existingByCell.keys()]);
      for (const cellKey of cellKeys) {
        const desired = desiredByCell.get(cellKey) ?? [];
        const existing = existingByCell.get(cellKey) ?? [];
        const usedIds = new Set<string>();
        const matchByKey = new Map<string, ExistingScheduleRow>();

        // 1) 同じ rowKey の同期済み予定をそのまま対応づける(ID を保つ)
        for (const want of desired) {
          const hit = existing.find((row) => !usedIds.has(row.id) && getSharedSyncRowKey(row.accountingMeta) === want.sourceKey);
          if (!hit) continue;
          usedIds.add(hit.id);
          matchByKey.set(want.sourceKey, hit);
        }
        // 2) 同じ人・日・現場の既存予定(手入力など)は原本の内容で上書きする(ID を保つ)
        for (const want of desired) {
          if (matchByKey.has(want.sourceKey)) continue;
          const wantSummaryKey = normalizeKey(want.summary);
          const hit = existing.find(
            (row) =>
              !usedIds.has(row.id) &&
              ((want.siteId != null && row.siteId === want.siteId) ||
                (wantSummaryKey !== '' && normalizeKey(row.summary) === wantSummaryKey)),
          );
          if (!hit) continue;
          usedIds.add(hit.id);
          matchByKey.set(want.sourceKey, hit);
        }

        // 3) 対応づかなかった同期由来の予定は原本から消えたので削除。手入力の予定は残す。
        let keptManualCount = 0;
        for (const row of existing) {
          if (usedIds.has(row.id)) continue;
          if (hasSharedExcelSyncMeta(row.accountingMeta)) {
            deleteIds.push(row.id);
            counts.scheduleDeleted += 1;
          } else {
            keptManualCount += 1;
          }
        }

        const dayYmd = cellKey.slice(cellKey.indexOf('|') + 1);
        desired.forEach((want, index) => {
          const startAt = addMinutes(startOfSharedSyncDay(dayYmd), keptManualCount + index);
          const accountingMeta = {
            scheduleEntryKind: 'site',
            sharedExcelSync: {
              source: '作業表☆',
              fileName: workTableFileName,
              rowKey: want.sourceKey,
            },
            labelColor: want.labelColor,
            scheduleGroupIndex: want.groupIndex,
            scheduleItemIndex: want.itemIndex,
          } as Prisma.InputJsonValue;

          const current = matchByKey.get(want.sourceKey);
          if (!current) {
            createData.push({
              userId: want.userId,
              kind,
              startAt,
              summary: want.summary,
              note: null,
              siteId: want.siteId,
              accountingMeta,
            });
            counts.scheduleCreated += 1;
            return;
          }

          const wasSyncOrigin = hasSharedExcelSyncMeta(current.accountingMeta);
          const same =
            wasSyncOrigin &&
            current.startAt.getTime() === startAt.getTime() &&
            current.summary === want.summary &&
            current.siteId === want.siteId &&
            stableStringify(current.accountingMeta) === stableStringify(accountingMeta);
          if (same) {
            counts.scheduleSkipped += 1;
            return;
          }
          if (!wasSyncOrigin) counts.scheduleOverwritten += 1;
          updates.push({ id: current.id, data: { startAt, summary: want.summary, siteId: want.siteId, accountingMeta } });
          counts.scheduleUpdated += 1;
        });
      }

      if (deleteIds.length > 0) await tx.workEntry.deleteMany({ where: { id: { in: deleteIds } } });
      for (const update of updates) {
        await tx.workEntry.update({ where: { id: update.id }, data: update.data, select: { id: true } });
      }
      if (createData.length > 0) await tx.workEntry.createMany({ data: createData });
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  if (unknownAssigneeNames.size > 0) {
    const names = Array.from(unknownAssigneeNames);
    const shown = names.slice(0, 10).join('、');
    const message = `担当者名が一致せず週予定へ未反映の行が ${counts.unknownUsers} 件あります(担当者 ${names.length} 名: ${shown}${names.length > 10 ? ' ほか' : ''})。`;
    warnings.push(message);
    console.warn(`[shared-sync] ${message}`);
  }
}
