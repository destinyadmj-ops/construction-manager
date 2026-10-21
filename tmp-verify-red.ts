import 'dotenv/config';
import * as XLSX from 'xlsx';
import { readWorkbook, extractWorkTableRows } from '@/server/shared-excel-sync';
import { isRedRgb, resolveColorAttrs } from '@/server/excel-font-color';

const file = process.env.TEMP + '/mh-red/work.xlsx';

// ---- unit checks
const red = ['FF0000', 'C00000', '9C0006', 'EE0000', 'E60000', 'FF3333', '800000'];
const non = ['FFC000', 'FF9900', 'FF6600', 'FF99CC', 'FF00FF', 'A52A2A', '000000', '7F7F7F', 'FFFFFF', '993300', '0000FF', 'FFFF00', 'F79646', 'C0504D'];
for (const c of red) if (!isRedRgb(c)) console.log('UNIT NG (should be red):', c);
for (const c of non) if (isRedRgb(c)) console.log('UNIT NG (should NOT be red):', c);
console.log('theme1 ->', resolveColorAttrs('theme="1"'), 'indexed10 ->', resolveColorAttrs('indexed="10"'), 'auto ->', resolveColorAttrs('auto="1"'), 'rgb ->', resolveColorAttrs('rgb="FFFF0000"'));

// ---- independent truth (styles.xml)
const raw = XLSX.readFile(file, { cellDates: true, cellStyles: true, cellHTML: true, dense: false, bookFiles: true });
const str = (p: string) => {
  const f = (raw as unknown as { files: Record<string, { content: Uint8Array }> }).files[p];
  return f ? Buffer.from(f.content).toString('utf8') : null;
};
const styles = str('xl/styles.xml')!;
const fontsXml = /<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(styles)![1];
const fonts = [...fontsXml.matchAll(/<font\b[^>]*?(?:\/>|>([\s\S]*?)<\/font>)/g)].map((m) => m[1] || '');
const fontColors = fonts.map((f) => /<color\b([^>]*)\/?>/.exec(f)?.[1] ?? null);
const cellXfsXml = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)![1];
const xfFont = [...cellXfsXml.matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)].map((m) => Number(/fontId="(\d+)"/.exec(m[1])?.[1] ?? 0));
const wbx = str('xl/workbook.xml')!;
const rels = str('xl/_rels/workbook.xml.rels')!;
const sheetsMeta = [...wbx.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => ({ name: m[1], rid: m[2] }));
const relMap = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])![1], /Target="([^"]+)"/.exec(m[0])![1]]));
const isFFRed = (s: string | null) => !!s && /FFFF0000/i.test(s);
const norm = (s: string) => s.normalize('NFKC').replace(/&amp;/g, '&').replace(/[^\p{L}\p{N}]/gu, '');
const segs = (s: string) => s.normalize('NFKC').split(/[、,，/\n\r・()（）]/).map(norm).filter((x) => x.length > 0);

const after = readWorkbook(file, { fontColors: true });
const before = readWorkbook(file);

let totMissed = 0;
let totOver = 0;
let totTruth = 0;
let totBeforeRed = 0;
let totAfterRed = 0;

for (const meta of sheetsMeta) {
  const p = 'xl/' + relMap.get(meta.rid)!.replace(/^\/?(xl\/)?/, '');
  const xml = str(p)!;
  const styleRed = new Set<string>();
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>)/g)) {
    const a = m[1];
    const addr = /\br="([A-Z]+\d+)"/.exec(a)![1];
    const sIdx = Number(/\bs="(\d+)"/.exec(a)?.[1] ?? 0);
    if (isFFRed(fontColors[xfFont[sIdx]])) styleRed.add(addr);
  }
  const ws = raw.Sheets[meta.name];
  const truthTexts: string[] = [];
  for (const addr of Object.keys(ws)) {
    if (addr[0] === '!') continue;
    const c = ws[addr] as XLSX.CellObject & { r?: string };
    if (c.v == null || c.v === '') continue;
    const r = typeof c.r === 'string' ? c.r : '';
    const runs = [...r.matchAll(/<r>([\s\S]*?)<\/r>/g)];
    if (runs.length > 0) {
      for (const run of runs) {
        const col = /<color\b([^>]*)>/.exec(run[1])?.[1];
        const isRed = col != null ? isFFRed(col) : false;
        if (!isRed) continue;
        const t = [...run[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('');
        if (t.trim()) truthTexts.push(t);
      }
    } else if (styleRed.has(addr)) {
      truthTexts.push(String(c.w ?? c.v));
    }
  }

  const one = (wb: XLSX.WorkBook) => extractWorkTableRows({ ...wb, SheetNames: [meta.name], Sheets: { [meta.name]: wb.Sheets[meta.name] } } as XLSX.WorkBook);
  const aRows = one(after);
  const bRows = one(before);
  const aRedEntries = new Set<string>();
  const aRedNames = new Set<string>();
  let aRed = 0;
  for (const row of aRows) {
    for (const e of row.entries) if (e.color === 'red') { aRed++; aRedEntries.add(norm(e.siteName)); }
  }
  const bRed = bRows.reduce((n, row) => n + row.entries.filter((e) => e.color === 'red').length, 0);
  void aRedNames;

  const truthJoined = truthTexts.map(norm).join('|');
  const entriesJoined = [...aRedEntries].join('|');
  const missed = truthTexts.flatMap((t) => segs(t)).filter((t) => !entriesJoined.includes(t));
  const over = [...aRedEntries].filter((e) => e.length > 0 && !truthJoined.includes(e));
  totMissed += missed.length;
  totOver += over.length;
  totTruth += truthTexts.length;
  totBeforeRed += bRed;
  totAfterRed += aRed;
  console.log(`${meta.name}: truthRedTexts=${truthTexts.length} before=${bRed} after=${aRed} missed=${missed.length} over=${over.length}`);
  if (missed.length) console.log('  missed sample:', [...new Set(missed)].slice(0, 6));
  if (over.length) console.log('  over sample:', over.slice(0, 6));
}
console.log(`TOTAL truth=${totTruth} before(red entries)=${totBeforeRed} after(red entries)=${totAfterRed} missed=${totMissed} over=${totOver}`);
