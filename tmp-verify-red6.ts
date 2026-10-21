import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

async function main() {
  const { prisma } = await import('@/server/db/prisma');
  const { readWorkbook, extractWorkTableRows } = await import('@/server/shared-excel-sync');
  const XLSX = await import('xlsx');
  const normalizeKey = (s: string | null | undefined) => (s ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();

  const wb = readWorkbook(process.env.TEMP + '/mh-red/work.xlsx', { fontColors: true });
  const newCells = new Map<string, { red: number; def: number }>();
  for (const name of wb.SheetNames) {
    const one = { ...wb, SheetNames: [name], Sheets: { [name]: wb.Sheets[name] } } as import('xlsx').WorkBook;
    void XLSX;
    for (const row of extractWorkTableRows(one)) {
      for (const a of row.assignees) {
        const key = `${row.dayYmd}|${normalizeKey(a.name)}`;
        const cur = newCells.get(key) ?? { red: 0, def: 0 };
        for (const e of row.entries) { if (e.color === 'red') cur.red += 1; else cur.def += 1; }
        newCells.set(key, cur);
      }
    }
  }

  const rows = await prisma.workEntry.findMany({
    where: { kind: 'NORMAL' },
    select: { accountingMeta: true },
  });
  const oldCells = new Map<string, { red: number; def: number }>();
  let oldRed = 0;
  let oldDef = 0;
  for (const r of rows) {
    const meta = r.accountingMeta as { sharedExcelSync?: { rowKey?: string }; labelColor?: string } | null;
    const rowKey = meta?.sharedExcelSync?.rowKey;
    if (!rowKey) continue;
    const [day, assignee] = rowKey.split('|');
    const key = `${day}|${assignee}`;
    const cur = oldCells.get(key) ?? { red: 0, def: 0 };
    if (meta?.labelColor === 'red') { cur.red += 1; oldRed += 1; } else { cur.def += 1; oldDef += 1; }
    oldCells.set(key, cur);
  }
  let newRed = 0;
  let newDef = 0;
  for (const v of newCells.values()) { newRed += v.red; newDef += v.def; }
  let changedCells = 0;
  let onlyColorShift = 0;
  let notInDb = 0;
  for (const [k, v] of newCells) {
    const o = oldCells.get(k);
    if (!o) { notInDb += 1; continue; }
    if (o.red !== v.red || o.def !== v.def) {
      changedCells += 1;
      if (o.red + o.def === v.red + v.def) onlyColorShift += 1;
    }
  }
  console.log(JSON.stringify({ dbSyncedRows: oldRed + oldDef, dbRed: oldRed, dbDefault: oldDef, fileEntries: newRed + newDef, fileRed: newRed, fileDefault: newDef, cellsInFile: newCells.size, cellsNotInDb: notInDb, cellsChanged: changedCells, cellsColorOnlyShift: onlyColorShift }, null, 2));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
