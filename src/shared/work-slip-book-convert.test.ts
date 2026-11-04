import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as XLSX from 'xlsx';
import { sheetJsToSnapshot, snapshotToSheetJs } from './work-slip-book-convert';

function sample(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const a = XLSX.utils.aoa_to_sheet([
    ['会社', '現場', '金額'],
    ['甲', '乙', 1000],
    ['丙', '丁', 2500],
  ]);
  a.D2 = { t: 'n', v: 3500, f: 'C2+C3', z: '#,##0' };
  a['!ref'] = 'A1:D3';
  a['!merges'] = [{ s: { r: 2, c: 0 }, e: { r: 2, c: 1 } }];
  a['!cols'] = [{ wpx: 120 }, { wpx: 80 }];
  XLSX.utils.book_append_sheet(wb, a, '作業伝票2026年10月');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), '作業伝票オリジナル');
  return wb;
}

test('SheetJS -> スナップショット -> SheetJS で値・数式・結合・列幅が保たれる', () => {
  const snap = sheetJsToSnapshot(sample(), '作業伝票');
  assert.equal(snap.sheetOrder.length, 2);
  const s1 = snap.sheets['sheet-1'] as { cellData: Record<string, Record<string, { v?: unknown; f?: string }>>; mergeData: unknown[] };
  assert.equal(s1.cellData[1][2].v, 1000);
  assert.equal(s1.cellData[1][3].f, '=C2+C3');
  assert.equal(s1.mergeData.length, 1);

  const back = snapshotToSheetJs(JSON.parse(JSON.stringify(snap)));
  assert.deepEqual(back.SheetNames, ['作業伝票2026年10月', '作業伝票オリジナル']);
  const ws = back.Sheets['作業伝票2026年10月'];
  assert.equal(ws.A2.v, '甲');
  assert.equal(ws.C3.v, 2500);
  assert.equal(ws.D2.f, 'C2+C3');
  assert.equal(ws.D2.z, '#,##0');
  assert.equal(ws['!merges']?.length, 1);
  assert.equal(ws['!cols']?.[0]?.wpx, 120);
});

test('xlsx にバイナリ書き出しできる', () => {
  const buf = XLSX.write(snapshotToSheetJs(sheetJsToSnapshot(sample(), '作業伝票')), { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const re = XLSX.read(buf, { type: 'buffer' });
  assert.equal(re.SheetNames.length, 2);
  assert.equal(re.Sheets['作業伝票オリジナル'].A1.v, 'x');
});
