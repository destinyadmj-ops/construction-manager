import * as XLSX from 'xlsx';
import { CELL_KEY_COLS, type XlsStyles } from './xls-styles';

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

export function sheetJsToSnapshot(wb: XLSX.WorkBook, name: string, xls: XlsStyles | null = null): WorkSlipBookSnapshot {
  const styles: Record<string, unknown> = {};
  const styleByKey = new Map<string, string>();
  // xf(.xlsの書式番号)と数値書式の組み合わせごとに1つのスタイルを共有する。
  const styleFor = (xf: number | undefined, rawPattern: string | null): string | null => {
    const base = xf != null ? xls?.xfStyles[xf] : undefined;
    if (!base && !rawPattern) return null;
    const style = { ...(base ?? {}), ...(rawPattern ? { n: { pattern: fixPattern(rawPattern) } } : {}) };
    const json = JSON.stringify(style);
    let key = styleByKey.get(json);
    if (!key) {
      key = `st${styleByKey.size + 1}`;
      styleByKey.set(json, key);
      styles[key] = style;
    }
    return key;
  };
  const isVisibleBlank = (xf: number) => {
    const s = xls?.xfStyles[xf];
    return !!s && (s.bd != null || s.bg != null);
  };

  const sheetOrder: string[] = [];
  const sheets: Record<string, Record<string, unknown>> = {};

  wb.SheetNames.forEach((sheetName, index) => {
    const ws = wb.Sheets[sheetName];
    const id = `sheet-${index + 1}`;
    sheetOrder.push(id);
    const range = ws?.['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
    const cellData: Record<string, Record<string, Cell>> = {};
    const info = xls?.sheets.get(sheetName);
    let maxRow = range.e.r;
    let maxCol = range.e.c;

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
        const pattern = src.t === 'n' && typeof src.z === 'string' && src.z !== 'General' ? src.z : null;
        const s = styleFor(info?.cellXf.get(r * CELL_KEY_COLS + c), pattern);
        if (s) cell.s = s;
        if (cell.v === undefined && !cell.f) continue;
        (cellData[r] ??= {})[c] = cell;
      }
    }
    // 値が空でも罫線・塗りのあるセルは書式だけ引き継ぐ
    for (const [key, xf] of info?.cellXf ?? []) {
      const r = Math.floor(key / CELL_KEY_COLS);
      const c = key % CELL_KEY_COLS;
      if (cellData[r]?.[c] || !isVisibleBlank(xf)) continue;
      const s = styleFor(xf, null);
      if (!s) continue;
      (cellData[r] ??= {})[c] = { s };
      maxRow = Math.max(maxRow, r);
      maxCol = Math.max(maxCol, c);
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
      if (h || row.hidden) rowData[r] = { ...(h ? { h } : {}), ...(row.hidden ? { hd: 1 } : {}) };
    });

    sheets[id] = {
      id,
      name: sheetName,
      hidden: wb.Workbook?.Sheets?.[index]?.Hidden ? 1 : 0,
      rowCount: Math.max(maxRow + 1 + 50, 100),
      columnCount: Math.max(maxCol + 1 + 5, 26),
      ...(info?.frozen ? { freeze: { xSplit: info.frozen.x, ySplit: info.frozen.y, startRow: info.frozen.y, startColumn: info.frozen.x } } : {}),
      ...(info ? { showGridlines: info.showGridlines ? 1 : 0 } : {}),
      ...(info?.zoom ? { zoomRatio: info.zoom } : {}),
      ...(info?.defaultRowHeightPx ? { defaultRowHeight: info.defaultRowHeightPx } : {}),
      cellData,
      mergeData: (ws?.['!merges'] ?? []).map((m) => ({ startRow: m.s.r, endRow: m.e.r, startColumn: m.s.c, endColumn: m.e.c })),
      columnData,
      rowData,
    };
  });

  return { id: WORK_SLIP_BOOK_ID, name, appVersion: '3.0.0-alpha', locale: 'jaJP', styles, sheetOrder, sheets };
}

type RawCell = Record<string, unknown>;
type RawSheet = {
  id?: string;
  name?: string;
  rowCount?: number;
  columnCount?: number;
  cellData?: Record<string, Record<string, RawCell>>;
  [key: string]: unknown;
};

// セルの「内容」にあたるフィールド。これ以外(s など)は書式・設定として扱う。
const CONTENT_KEYS = ['v', 't', 'f', 'si', 'p'] as const;
const hasContent = (cell: RawCell) => CONTENT_KEYS.some((k) => cell[k] !== undefined);

// 取込結果のセル内容だけを既存ブックへ反映する(シート名・セル位置で対応付け)。列幅・行高・結合・固定・書式は base のまま。入力は書き換えない。
export function mergeImportedValues(base: WorkSlipBookSnapshot, imported: WorkSlipBookSnapshot): WorkSlipBookSnapshot {
  const out = structuredClone(base);
  const src = structuredClone(imported);
  out.styles ??= {};
  const styles = out.styles;

  const keyByJson = new Map<string, string>();
  for (const [key, style] of Object.entries(styles)) {
    const json = JSON.stringify(style);
    if (!keyByJson.has(json)) keyByJson.set(json, key);
  }
  let nextStyle = 1;
  const adoptStyle = (key: unknown): string | undefined => {
    const style = typeof key === 'string' ? src.styles?.[key] : undefined;
    if (style == null) return undefined;
    const json = JSON.stringify(style);
    let found = keyByJson.get(json);
    if (!found) {
      while (`st${nextStyle}` in styles) nextStyle += 1;
      found = `st${nextStyle}`;
      styles[found] = style;
      keyByJson.set(json, found);
    }
    return found;
  };

  const idByName = new Map<string, string>();
  for (const id of out.sheetOrder) {
    const name = (out.sheets[id] as RawSheet | undefined)?.name;
    if (typeof name === 'string' && !idByName.has(name)) idByName.set(name, id);
  }

  for (const srcId of src.sheetOrder) {
    const srcSheet = src.sheets[srcId] as RawSheet | undefined;
    if (!srcSheet) continue;
    const baseId = typeof srcSheet.name === 'string' ? idByName.get(srcSheet.name) : undefined;

    if (!baseId) {
      let n = Object.keys(out.sheets).length + 1;
      while (`sheet-${n}` in out.sheets) n += 1;
      const id = `sheet-${n}`;
      for (const row of Object.values(srcSheet.cellData ?? {})) {
        for (const cell of Object.values(row)) {
          const s = adoptStyle(cell.s);
          if (s) cell.s = s;
          else delete cell.s;
        }
      }
      srcSheet.id = id;
      out.sheets[id] = srcSheet;
      out.sheetOrder.push(id);
      continue;
    }

    const sheet = out.sheets[baseId] as RawSheet;
    const cells = (sheet.cellData ??= {});
    for (const row of Object.values(cells)) for (const cell of Object.values(row)) for (const k of CONTENT_KEYS) delete cell[k];

    for (const [r, srcRow] of Object.entries(srcSheet.cellData ?? {})) {
      for (const [c, srcCell] of Object.entries(srcRow)) {
        if (!hasContent(srcCell)) continue;
        const row = (cells[r] ??= {});
        let cell = row[c];
        if (!cell) {
          cell = row[c] = {};
          const s = adoptStyle(srcCell.s);
          if (s) cell.s = s;
        }
        for (const k of CONTENT_KEYS) if (srcCell[k] !== undefined) cell[k] = srcCell[k];
      }
    }

    for (const [r, row] of Object.entries(cells)) {
      for (const [c, cell] of Object.entries(row)) if (Object.keys(cell).length === 0) delete row[c];
      if (Object.keys(row).length === 0) delete cells[r];
    }
    sheet.rowCount = Math.max(sheet.rowCount ?? 0, srcSheet.rowCount ?? 0);
    sheet.columnCount = Math.max(sheet.columnCount ?? 0, srcSheet.columnCount ?? 0);
  }
  return out;
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
