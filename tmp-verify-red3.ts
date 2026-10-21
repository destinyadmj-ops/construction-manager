import 'dotenv/config';
import * as XLSX from 'xlsx';
import { readWorkbook } from '@/server/shared-excel-sync';

const after = readWorkbook(process.env.TEMP + '/mh-red/work.xlsx', { fontColors: true });
let bad = 0;
for (const name of after.SheetNames) {
  const ws = after.Sheets[name];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false, defval: '' }) as unknown[][];
  let mism = 0;
  let total = 0;
  for (let r = 0; r < grid.length; r += 1) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c += 1) {
      const v = grid[r][c];
      if (v === '' || v == null) continue;
      total += 1;
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (!cell || String(cell.v) !== String(v)) mism += 1;
    }
  }
  if (mism > 0) bad += 1;
  console.log(name, ws['!ref'], 'gridRows=', grid.length, 'cells=', total, 'mismatch=', mism);
}
console.log('sheets with mismatch:', bad);
