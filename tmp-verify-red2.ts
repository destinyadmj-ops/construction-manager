import 'dotenv/config';
import * as XLSX from 'xlsx';
import { readWorkbook, extractWorkTableRows } from '@/server/shared-excel-sync';

const file = process.env.TEMP + '/mh-red/work.xlsx';
const after = readWorkbook(file, { fontColors: true });
const name = process.argv[2] ?? '10月5日';
const kw = process.argv[3] ?? '吉祥寺';
const ws = after.Sheets[name];
const wb = { ...after, SheetNames: [name], Sheets: { [name]: ws } } as XLSX.WorkBook;
for (const row of extractWorkTableRows(wb)) {
  if (JSON.stringify(row).includes(kw)) console.log(JSON.stringify(row));
}
for (const addr of Object.keys(ws)) {
  if (addr[0] === '!') continue;
  const c = ws[addr] as XLSX.CellObject & { r?: string; mhFont?: unknown };
  if (String(c.v ?? '').includes(kw)) console.log(addr, JSON.stringify(c.v), JSON.stringify(c.mhFont), (c.r ?? '').slice(0, 600));
}
