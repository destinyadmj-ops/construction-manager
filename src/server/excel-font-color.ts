// 作業表☆(.xlsx)のセル文字色を styles.xml / theme から解決する。
// SheetJS CE は cell.s にフォント色を入れない(塗りつぶしのみ)ため、bookFiles で保持した zip を直接読む。
import type { WorkBook } from 'xlsx';

export type ColorPalette = {
  /** Excel の theme 番号(0=lt1,1=dk1,2=lt2,3=dk2,4-9=accent1-6,10=hlink,11=folHlink) → RRGGBB */
  theme: string[];
  /** indexed 番号 → RRGGBB */
  indexed: string[];
};

export type CellFont = { rgb: string | null; palette: ColorPalette };

const MH_FONT_KEY = 'mhFont';

const DEFAULT_INDEXED_COLORS = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
];

// Office 2007-2010 テーマ(theme1.xml が読めない場合の既定)
const DEFAULT_THEME_COLORS = [
  'FFFFFF', '000000', 'EEECE1', '1F497D', '4F81BD', 'C0504D', '9BBB59', '8064A2', '4BACC6', 'F79646', '0000FF', '800080',
];

export const DEFAULT_COLOR_PALETTE: ColorPalette = { theme: DEFAULT_THEME_COLORS, indexed: DEFAULT_INDEXED_COLORS };

function attrOf(text: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(text);
  return match ? (match[1] ?? '') : null;
}

function rgbToHsl(rgb: string): { h: number; s: number; l: number } {
  const r = parseInt(rgb.slice(0, 2), 16) / 255;
  const g = parseInt(rgb.slice(2, 4), 16) / 255;
  const b = parseInt(rgb.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): string {
  const hue = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  const toHex = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  const [r, g, b] = s === 0 ? [l, l, l] : [channel(hue + 1 / 3), channel(hue), channel(hue - 1 / 3)];
  return `${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function applyTint(rgb: string, tint: number): string {
  if (!Number.isFinite(tint) || tint === 0) return rgb;
  const { h, s, l } = rgbToHsl(rgb);
  const nextL = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  return hslToRgb(h, s, nextL);
}

function normalizeRgbToken(value: string | null): string | null {
  const hex = (value ?? '').replace(/[^0-9A-Fa-f]/g, '');
  if (hex.length === 8) return hex.slice(2).toUpperCase();
  if (hex.length === 6) return hex.toUpperCase();
  return null;
}

/** `<color rgb=".." theme=".." indexed=".." tint=".." auto="1"/>` の属性文字列を RRGGBB へ解決する。解決不能/自動色は null(=既定の黒)。 */
export function resolveColorAttrs(attrs: string, palette: ColorPalette = DEFAULT_COLOR_PALETTE): string | null {
  const auto = attrOf(attrs, 'auto');
  const rgb = attrOf(attrs, 'rgb');
  if (rgb != null) return normalizeRgbToken(rgb);
  const theme = attrOf(attrs, 'theme');
  if (theme != null) {
    const base = palette.theme[Number(theme)];
    if (!base) return null;
    return applyTint(base, Number(attrOf(attrs, 'tint') ?? 0));
  }
  const indexed = attrOf(attrs, 'indexed');
  if (indexed != null) return palette.indexed[Number(indexed)] ?? null;
  if (auto != null) return null;
  return null;
}

/**
 * 赤(濃い赤・暗い赤を含む)か。色相が赤の±10度・彩度70%以上・明度20〜65%のみ赤とする。
 * 橙(FFC000等)・ピンク(FF99CC)・茶(A52A2A)・灰・黒は赤にしない。
 */
export function isRedRgb(rgb: string | null | undefined): boolean {
  const normalized = normalizeRgbToken(rgb ?? null);
  if (!normalized) return false;
  const { h, s, l } = rgbToHsl(normalized);
  return (h <= 10 || h >= 350) && s >= 0.7 && l >= 0.2 && l <= 0.65;
}

function readZipText(workbook: WorkBook, path: string): string | null {
  const files = (workbook as unknown as { files?: Record<string, { content?: Uint8Array } | undefined> }).files;
  const content = files?.[path]?.content;
  return content ? Buffer.from(content).toString('utf8') : null;
}

function decodeXmlAttr(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function buildPalette(workbook: WorkBook, stylesXml: string): ColorPalette {
  const themeXml = readZipText(workbook, 'xl/theme/theme1.xml');
  let theme = DEFAULT_THEME_COLORS;
  if (themeXml) {
    const scheme = /<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/.exec(themeXml)?.[0] ?? '';
    const byName = new Map<string, string>();
    for (const match of scheme.matchAll(/<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)>\s*<a:(?:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"|sysClr\b[^>]*\blastClr="([0-9A-Fa-f]{6})")/g)) {
      byName.set(match[1] ?? '', (match[2] ?? match[3] ?? '').toUpperCase());
    }
    const order = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
    theme = order.map((name, index) => byName.get(name) ?? DEFAULT_THEME_COLORS[index] ?? '000000');
  }

  let indexed = DEFAULT_INDEXED_COLORS;
  const custom = /<indexedColors\b[^>]*>([\s\S]*?)<\/indexedColors>/.exec(stylesXml)?.[1];
  if (custom) {
    const colors = Array.from(custom.matchAll(/<rgbColor\b[^>]*\brgb="([^"]+)"/g)).map((m) => normalizeRgbToken(m[1] ?? null));
    if (colors.length > 0) indexed = colors.map((c, i) => c ?? DEFAULT_INDEXED_COLORS[i] ?? '000000');
  }
  return { theme, indexed };
}

function sheetPathsByName(workbook: WorkBook): Map<string, string> {
  const workbookXml = readZipText(workbook, 'xl/workbook.xml') ?? '';
  const relsXml = readZipText(workbook, 'xl/_rels/workbook.xml.rels') ?? '';
  const targets = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attrOf(match[0], 'Id');
    const target = attrOf(match[0], 'Target');
    if (id && target) targets.set(id, target);
  }
  const result = new Map<string, string>();
  for (const match of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attrOf(match[0], 'name');
    const rid = attrOf(match[0], 'r:id');
    const target = rid ? targets.get(rid) : null;
    if (!name || !target) continue;
    const trimmed = target.replace(/^\//, '');
    result.set(decodeXmlAttr(name), trimmed.startsWith('xl/') ? trimmed : `xl/${trimmed}`);
  }
  return result;
}

/**
 * 全シートの値ありセルへ、セル書式のフォント色を `mhFont` として付与する(.xlsx のみ。zip を保持していない .xls は何もしない)。
 * 付与できたセル数を返す(0 の場合はフォント色を取得できていない)。
 */
export function attachCellFontColors(workbook: WorkBook): number {
  const stylesXml = readZipText(workbook, 'xl/styles.xml');
  if (!stylesXml) return 0;

  const palette = buildPalette(workbook, stylesXml);
  const fontsXml = /<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(stylesXml)?.[1] ?? '';
  const fontRgbs: Array<string | null> = Array.from(fontsXml.matchAll(/<font\b[^>]*?(?:\/>|>([\s\S]*?)<\/font>)/g)).map((match) => {
    const colorAttrs = /<color\b([^>]*)\/?>/.exec(match[1] ?? '')?.[1];
    return colorAttrs != null ? resolveColorAttrs(colorAttrs, palette) : null;
  });
  const xfsXml = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '';
  const xfFontIds = Array.from(xfsXml.matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)).map((match) =>
    Number(attrOf(match[1] ?? '', 'fontId') ?? 0),
  );

  let attached = 0;
  const sheetPaths = sheetPathsByName(workbook);
  for (const [sheetName, path] of sheetPaths) {
    const sheet = workbook.Sheets[sheetName] as Record<string, unknown> | undefined;
    const sheetXml = readZipText(workbook, path);
    if (!sheet || !sheetXml) continue;
    for (const match of sheetXml.matchAll(/<c\b([^>]*?)\/?>/g)) {
      const attrs = match[1] ?? '';
      const address = attrOf(attrs, 'r');
      const cell = address ? (sheet[address] as Record<string, unknown> | undefined) : undefined;
      if (!cell || typeof cell !== 'object') continue;
      const rgb = fontRgbs[xfFontIds[Number(attrOf(attrs, 's') ?? 0)] ?? 0] ?? null;
      cell[MH_FONT_KEY] = { rgb, palette } satisfies CellFont;
      attached += 1;
    }
  }
  return attached;
}

export function getCellFont(cell: unknown): CellFont | null {
  const font = (cell as Record<string, unknown> | null | undefined)?.[MH_FONT_KEY];
  return font && typeof font === 'object' ? (font as CellFont) : null;
}
