import * as XLSX from 'xlsx';

// Univer の IWorkbookData 互換の素のJSON(型依存を避けるためゆるく定義)
export type WorkSlipBookSnapshot = {
  id: string;
  name: string;
  appVersion: string;
  locale: string;
  styles: Record<string, unknown>;
  sheetOrder: string[];
  sheets: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

type Cell = { v?: string | number; t?: number; f?: string; s?: string; p?: { body?: { dataStream?: string } } };
type SheetData = {
  name?: string;
  hidden?: number;
  cellData?: Record<string, Record<string, Cell>>;
  mergeData?: Array<{ startRow: number; endRow: number; startColumn: number; endColumn: number }>;
  columnData?: Record<string, { w?: number; hd?: number }>;
  rowData?: Record<string, { h?: number; hd?: number }>;
};

const CELL_STRING = 1;
const CELL_NUMBER = 2;
const CELL_BOOLEAN = 3;
export const WORK_SLIP_BOOK_ID = 'work-slip-book';
const MAX_IMPORT_ROW_PX = 30;

// SheetJS は .xls の組み込み書式ID56を中国語環境の時刻書式で解釈する。日本語Excelでは m"月"d"日" なので置き換える。
const LEGACY_PATTERNS: Record<string, string> = {
  '"上午/下午 "hh"時"mm"分"ss"秒 "': 'm"月"d"日"',
};
const fixPattern = (pattern: string) => LEGACY_PATTERNS[pattern] ?? pattern;

// 保存済みブックの書式も同じ補正をかける(読み込み時用)。
export function normalizeSnapshotFormats(snapshot: WorkSlipBookSnapshot): WorkSlipBookSnapshot {
  for (const style of Object.values(snapshot.styles ?? {})) {
    const n = (style as { n?: { pattern?: unknown } } | undefined)?.n;
    if (n && typeof n.pattern === 'string') n.pattern = fixPattern(n.pattern);
  }
  return snapshot;
}

export function sheetJsToSnapshot(wb: XLSX.WorkBook, name: string): WorkSlipBookSnapshot {
  const styles: Record<string, unknown> = {};
  const styleByPattern = new Map<string, string>();
  const styleFor = (rawPattern: string) => {
    const pattern = fixPattern(rawPattern);
    let key = styleByPattern.get(pattern);
    if (!key) {
      key = `nf${styleByPattern.size + 1}`;
      styleByPattern.set(pattern, key);
      styles[key] = { n: { pattern } };
    }
    return key;
  };

  const sheetOrder: string[] = [];
  const sheets: Record<string, Record<string, unknown>> = {};

  wb.SheetNames.forEach((sheetName, index) => {
    const ws = wb.Sheets[sheetName];
    const id = `sheet-${index + 1}`;
    sheetOrder.push(id);
    const range = ws?.['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
    const cellData: Record<string, Record<string, Cell>> = {};

    if (ws) {
      for (const addr of Object.keys(ws)) {
        if (addr.startsWith('!')) continue;
        const src = ws[addr] as XLSX.CellObject;
        const { r, c } = XLSX.utils.decode_cell(addr);
        const cell: Cell = {};
        if (src.t === 'n' && typeof src.v === 'number') {
          cell.v = src.v;
          cell.t = CELL_NUMBER;
        } else if (src.t === 'b') {
          cell.v = src.v ? 1 : 0;
          cell.t = CELL_BOOLEAN;
        } else if (src.v != null) {
          cell.v = String(src.w ?? src.v);
          cell.t = CELL_STRING;
        }
        if (src.f) cell.f = `=${src.f}`;
        if (src.t === 'n' && typeof src.z === 'string' && src.z !== 'General') cell.s = styleFor(src.z);
        if (cell.v === undefined && !cell.f) continue;
        (cellData[r] ??= {})[c] = cell;
      }
    }

    const columnData: Record<string, { w?: number; hd?: number }> = {};
    (ws?.['!cols'] ?? []).forEach((col, c) => {
      if (!col) return;
      const w = col.wpx ?? (col.wch ? Math.round(col.wch * 7 + 5) : undefined);
      if (w || col.hidden) columnData[c] = { ...(w ? { w } : {}), ...(col.hidden ? { hd: 1 } : {}) };
    });
    const rowData: Record<string, { h?: number; hd?: number }> = {};
    (ws?.['!rows'] ?? []).forEach((row, r) => {
      if (!row) return;
      const h = row.hpx ?? (row.hpt ? Math.round((row.hpt * 96) / 72) : undefined);
      const clamped = h ? Math.min(h, MAX_IMPORT_ROW_PX) : undefined;
      if (clamped || row.hidden) rowData[r] = { ...(clamped ? { h: clamped } : {}), ...(row.hidden ? { hd: 1 } : {}) };
    });

    sheets[id] = {
      id,
      name: sheetName,
      hidden: wb.Workbook?.Sheets?.[index]?.Hidden ? 1 : 0,
      rowCount: Math.max(range.e.r + 1 + 50, 100),
      columnCount: Math.max(range.e.c + 1 + 5, 26),
      cellData,
      mergeData: (ws?.['!merges'] ?? []).map((m) => ({ startRow: m.s.r, endRow: m.e.r, startColumn: m.s.c, endColumn: m.e.c })),
      columnData,
      rowData,
    };
  });

  return { id: WORK_SLIP_BOOK_ID, name, appVersion: '3.0.0-alpha', locale: 'jaJP', styles, sheetOrder, sheets };
}

function cellText(cell: Cell): string | null {
  const stream = cell.p?.body?.dataStream;
  return typeof stream === 'string' ? stream.replace(/\r\n$/, '').replace(/\r/g, '\n') : null;
}

export function snapshotToSheetJs(snapshot: WorkSlipBookSnapshot): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const patternOf = (s: unknown): string | null => {
    const style = typeof s === 'string' ? snapshot.styles?.[s] : s;
    const pattern = (style as { n?: { pattern?: unknown } } | undefined)?.n?.pattern;
    return typeof pattern === 'string' && pattern ? fixPattern(pattern) : null;
  };

  for (const id of snapshot.sheetOrder ?? Object.keys(snapshot.sheets)) {
    const data = snapshot.sheets[id] as SheetData | undefined;
    if (!data) continue;
    let sheetName = (data.name ?? id).replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || id;
    for (let n = 2; used.has(sheetName.toLowerCase()); n += 1) sheetName = `${sheetName.slice(0, 28)}_${n}`;
    used.add(sheetName.toLowerCase());

    const ws: XLSX.WorkSheet = {};
    let maxR = 0;
    let maxC = 0;
    for (const [rKey, row] of Object.entries(data.cellData ?? {})) {
      for (const [cKey, cell] of Object.entries(row)) {
        const r = Number(rKey);
        const c = Number(cKey);
        const text = cell.v == null ? cellText(cell) : null;
        let out: XLSX.CellObject;
        if (typeof cell.v === 'number') out = cell.t === CELL_BOOLEAN ? { t: 'b', v: cell.v !== 0 } : { t: 'n', v: cell.v };
        else if (cell.v != null) out = { t: 's', v: String(cell.v) };
        else if (text != null) out = { t: 's', v: text };
        else if (cell.f) out = { t: 'n', v: 0 };
        else continue;
        if (cell.f) out.f = cell.f.replace(/^=/, '');
        const z = out.t === 'n' ? patternOf(cell.s) : null;
        if (z) out.z = z;
        ws[XLSX.utils.encode_cell({ r, c })] = out;
        maxR = Math.max(maxR, r);
        maxC = Math.max(maxC, c);
      }
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
    if (data.mergeData?.length) {
      ws['!merges'] = data.mergeData.map((m) => ({ s: { r: m.startRow, c: m.startColumn }, e: { r: m.endRow, c: m.endColumn } }));
    }
    const cols: XLSX.ColInfo[] = [];
    for (const [c, col] of Object.entries(data.columnData ?? {})) cols[Number(c)] = { wpx: col.w, hidden: !!col.hd };
    if (cols.length) ws['!cols'] = Array.from(cols, (x) => x ?? {});
    const rows: XLSX.RowInfo[] = [];
    for (const [r, row] of Object.entries(data.rowData ?? {})) rows[Number(r)] = { hpx: row.h, hidden: !!row.hd };
    if (rows.length) ws['!rows'] = Array.from(rows, (x) => x ?? {});

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    wb.Workbook ??= {};
    (wb.Workbook.Sheets ??= []).push({ Hidden: data.hidden ? 1 : 0 });
  }
  return wb;
}
