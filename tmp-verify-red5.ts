import 'dotenv/config';
import * as XLSX from 'xlsx';
import { readWorkbook } from '@/server/shared-excel-sync';
import { isRedRgb, getCellFont } from '@/server/excel-font-color';
const wb = readWorkbook(process.env.TEMP + '/mh-red/work.xlsx', { fontColors: true });
let n = 0; const names: string[] = [];
for (const s of wb.SheetNames) { const ws = wb.Sheets[s]; for (const a of Object.keys(ws)) { if (a[0] === '!' || !/^A\d+$/.test(a)) continue; const c = ws[a] as XLSX.CellObject; if (c.v == null || c.v === '') continue; const r = (c as {r?: string}).r ?? ''; if (isRedRgb(getCellFont(c)?.rgb) || /FFFF0000/.test(r)) { n++; names.push(s + ':' + a + ':' + String(c.v)); } } }
console.log('red col A cells', n, names.slice(0, 10));

