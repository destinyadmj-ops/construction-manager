import 'dotenv/config';
import * as XLSX from 'xlsx';
import { readWorkbook, extractWorkTableRows } from '@/server/shared-excel-sync';

const file = process.env.TEMP + '/mh-red/work.xlsx';
for (const fc of [false, true]) {
  const wb = readWorkbook(file, { fontColors: fc });
  const red = new Map<string, number>();
  const def = new Map<string, number>();
  let redEntries = 0;
  let allEntries = 0;
  for (const name of wb.SheetNames) {
    const one = { ...wb, SheetNames: [name], Sheets: { [name]: wb.Sheets[name] } } as XLSX.WorkBook;
    for (const row of extractWorkTableRows(one)) {
      for (const a of row.assignees) (a.color === 'red' ? red : def).set(a.name, (red.get(a.name) ?? 0) + 1);
      for (const e of row.entries) { allEntries += 1; if (e.color === 'red') redEntries += 1; }
    }
  }
  console.log(fc ? 'AFTER' : 'BEFORE', 'entries', allEntries, 'redEntries', redEntries, 'redAssigneeNames', [...red.keys()].join(','));
}
