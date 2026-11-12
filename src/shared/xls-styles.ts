import * as XLSX from 'xlsx';

// .xls(BIFF8) のセル書式(フォント・罫線・塗り・配置)を読み取り、Univer のスタイル形式へ変換する。
// SheetJS(CE) は .xls の書式を返さないため、OLE から Workbook ストリームを直接読む。

export type UniverStyle = Record<string, unknown>;
export type XlsSheetInfo = {
  cellXf: Map<number, number>; // key = row * CELL_KEY_COLS + col
  frozen?: { x: number; y: number };
  showGridlines: boolean;
  zoom?: number;
  defaultRowHeightPx?: number;
};
export type XlsStyles = { xfStyles: UniverStyle[]; sheets: Map<string, XlsSheetInfo> };
export const CELL_KEY_COLS = 1024;

// Excel 97-2003 既定パレット(インデックス 8～63)
const DEFAULT_PALETTE = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
];

// BIFF の罫線種別 -> Univer BorderStyleTypes
const BORDER_STYLE: Record<number, number> = { 1: 1, 2: 8, 3: 4, 4: 3, 5: 13, 6: 7, 7: 2, 8: 9, 9: 5, 10: 10, 11: 6, 12: 11, 13: 12 };
const HALIGN: Record<number, number> = { 1: 1, 2: 2, 3: 3, 5: 4, 6: 2, 7: 6 };

type Font = { height: number; italic: boolean; strike: boolean; color: number; weight: number; underline: number; name: string };
type Xf = {
  font: number; hor: number; ver: number; wrap: boolean; rot: number; indent: number;
  left: number; right: number; top: number; bottom: number;
  leftColor: number; rightColor: number; topColor: number; bottomColor: number;
  pattern: number; fg: number; bg: number;
};

function walk(data: Buffer, start: number, onRecord: (type: number, off: number, len: number) => void) {
  let pos = start;
  let depth = 0;
  while (pos + 4 <= data.length) {
    const type = data.readUInt16LE(pos);
    const len = data.readUInt16LE(pos + 2);
    const off = pos + 4;
    if (off + len > data.length) break;
    if (type === 0x0809) depth += 1;
    onRecord(type, off, len);
    if (type === 0x000a) {
      depth -= 1;
      if (depth <= 0) break;
    }
    pos = off + len;
  }
}

function parseFont(d: Buffer, off: number, len: number): Font {
  const flags = d.readUInt16LE(off + 2);
  const cch = d[off + 14];
  const wide = (d[off + 15] & 1) === 1;
  const nameEnd = off + 16 + (wide ? cch * 2 : cch);
  const name = nameEnd <= off + len ? d.subarray(off + 16, nameEnd).toString(wide ? 'utf16le' : 'latin1') : '';
  return { height: d.readUInt16LE(off), italic: (flags & 0x2) !== 0, strike: (flags & 0x8) !== 0, color: d.readUInt16LE(off + 4), weight: d.readUInt16LE(off + 6), underline: d[off + 10], name };
}

function parseXf(d: Buffer, off: number): Xf {
  const align = d[off + 6];
  const b1 = d.readUInt32LE(off + 10);
  const b2 = d.readUInt32LE(off + 14);
  const c = d.readUInt16LE(off + 18);
  return {
    font: d.readUInt16LE(off), hor: align & 7, wrap: ((align >> 3) & 1) === 1, ver: (align >> 4) & 7, rot: d[off + 7], indent: d[off + 8] & 0xf,
    left: b1 & 0xf, right: (b1 >> 4) & 0xf, top: (b1 >> 8) & 0xf, bottom: (b1 >> 12) & 0xf,
    leftColor: (b1 >> 16) & 0x7f, rightColor: (b1 >> 23) & 0x7f, topColor: b2 & 0x7f, bottomColor: (b2 >> 7) & 0x7f,
    pattern: (b2 >>> 26) & 0x3f, fg: c & 0x7f, bg: (c >> 7) & 0x7f,
  };
}

export function readXlsStyles(buffer: Buffer): XlsStyles | null {
  let data: Buffer;
  try {
    const cfb = XLSX.CFB.read(buffer, { type: 'buffer' });
    const entry = XLSX.CFB.find(cfb, '/Workbook') ?? XLSX.CFB.find(cfb, '/Book');
    if (!entry?.content) return null;
    data = Buffer.from(entry.content as Uint8Array);
  } catch {
    return null;
  }
  if (data.length < 8 || data.readUInt16LE(0) !== 0x0809) return null;

  const fonts: Font[] = [];
  const xfs: Xf[] = [];
  const palette = DEFAULT_PALETTE.slice();
  const boundSheets: Array<{ name: string; offset: number; kind: number }> = [];
  walk(data, 0, (type, off, len) => {
    if (type === 0x0031) fonts.push(parseFont(data, off, len));
    else if (type === 0x00e0 && len >= 20) xfs.push(parseXf(data, off));
    else if (type === 0x0092) {
      const n = data.readUInt16LE(off);
      for (let i = 0; i < n && i < 56; i += 1) {
        const o = off + 2 + i * 4;
        palette[i] = [data[o], data[o + 1], data[o + 2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
      }
    } else if (type === 0x0085) {
      const cch = data[off + 6];
      const wide = (data[off + 7] & 1) === 1;
      const name = data.subarray(off + 8, off + 8 + (wide ? cch * 2 : cch)).toString(wide ? 'utf16le' : 'latin1');
      boundSheets.push({ name, offset: data.readUInt32LE(off), kind: data[off + 5] });
    }
  });
  // フォントIDは 4 を欠番として数える
  const fontAt = (index: number) => fonts[index < 4 ? index : index - 1];
  const rgb = (index: number, fallback: string | null): string | null => {
    if (index === 0x7fff || index === 64 || index === 65) return index === 65 ? '#FFFFFF' : fallback;
    if (index < 8) return `#${DEFAULT_PALETTE[index]}`;
    const hex = palette[index - 8];
    return hex ? `#${hex}` : fallback;
  };
  const mix = (a: string | null, b: string | null) => {
    if (!a || !b) return a ?? b;
    const ch = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
    return `#${[0, 1, 2].map((i) => Math.round((ch(a, i) + ch(b, i)) / 2).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  };

  const xfStyles = xfs.map((xf): UniverStyle => {
    const style: UniverStyle = {};
    const font = fontAt(xf.font);
    if (font) {
      if (font.name) style.ff = font.name;
      style.fs = font.height / 20;
      if (font.weight >= 700) style.bl = 1;
      if (font.italic) style.it = 1;
      if (font.underline) style.ul = { s: 1 };
      if (font.strike) style.st = { s: 1 };
      const color = rgb(font.color, null);
      if (color) style.cl = { rgb: color };
    }
    if (xf.pattern === 1) {
      const fill = rgb(xf.fg, '#000000');
      if (fill) style.bg = { rgb: fill };
    } else if (xf.pattern > 1) {
      const fill = mix(rgb(xf.fg, '#000000'), rgb(xf.bg, '#FFFFFF'));
      if (fill) style.bg = { rgb: fill };
    }
    const bd: Record<string, unknown> = {};
    const sides: Array<[string, number, number]> = [['t', xf.top, xf.topColor], ['b', xf.bottom, xf.bottomColor], ['l', xf.left, xf.leftColor], ['r', xf.right, xf.rightColor]];
    for (const [key, kind, color] of sides) {
      if (BORDER_STYLE[kind]) bd[key] = { s: BORDER_STYLE[kind], cl: { rgb: rgb(color, '#000000') ?? '#000000' } };
    }
    if (Object.keys(bd).length) style.bd = bd;
    if (HALIGN[xf.hor]) style.ht = HALIGN[xf.hor];
    style.vt = xf.ver === 0 ? 1 : xf.ver === 1 ? 2 : 3;
    if (xf.wrap) style.tb = 3;
    if (xf.rot === 255) style.tr = { a: 0, v: 1 };
    else if (xf.rot >= 1 && xf.rot <= 90) style.tr = { a: xf.rot, v: 0 };
    else if (xf.rot > 90 && xf.rot <= 180) style.tr = { a: 90 - xf.rot, v: 0 };
    if (xf.indent && (xf.hor === 1 || xf.hor === 3)) style.pd = { l: xf.indent * 8 };
    return style;
  });

  const sheets = new Map<string, XlsSheetInfo>();
  for (const bs of boundSheets) {
    if (bs.kind !== 0) continue;
    const info: XlsSheetInfo = { cellXf: new Map(), showGridlines: true };
    let frozenFlag = false;
    const paneBox: { pane?: { x: number; y: number } } = {};
    const put = (row: number, col: number, xf: number) => {
      if (row < 65536 && col < CELL_KEY_COLS) info.cellXf.set(row * CELL_KEY_COLS + col, xf);
    };
    walk(data, bs.offset, (type, off, len) => {
      switch (type) {
        case 0x0201: case 0x0203: case 0x0204: case 0x0205: case 0x00fd: case 0x027e: case 0x0006: case 0x00d6:
          if (len >= 6) put(data.readUInt16LE(off), data.readUInt16LE(off + 2), data.readUInt16LE(off + 4));
          break;
        case 0x00bd: { // MULRK
          const row = data.readUInt16LE(off);
          const first = data.readUInt16LE(off + 2);
          for (let i = 0; i < (len - 6) / 6; i += 1) put(row, first + i, data.readUInt16LE(off + 4 + i * 6));
          break;
        }
        case 0x00be: { // MULBLANK
          const row = data.readUInt16LE(off);
          const first = data.readUInt16LE(off + 2);
          for (let i = 0; i < (len - 6) / 2; i += 1) put(row, first + i, data.readUInt16LE(off + 4 + i * 2));
          break;
        }
        case 0x023e: { // WINDOW2
          const flags = data.readUInt16LE(off);
          info.showGridlines = (flags & 0x2) !== 0;
          frozenFlag = (flags & 0x8) !== 0;
          break;
        }
        case 0x0041: paneBox.pane = { x: data.readUInt16LE(off), y: data.readUInt16LE(off + 2) }; break;
        case 0x00a0: { // SCL
          const num = data.readUInt16LE(off);
          const den = data.readUInt16LE(off + 2);
          if (den > 0 && num > 0) info.zoom = num / den;
          break;
        }
        case 0x0225: info.defaultRowHeightPx = Math.round(((data.readUInt16LE(off + 2) / 20) * 96) / 72); break;
        default:
      }
    });
    const pane = paneBox.pane;
    if (frozenFlag && pane && (pane.x > 0 || pane.y > 0)) info.frozen = pane;
    sheets.set(bs.name, info);
  }
  return { xfStyles, sheets };
}
