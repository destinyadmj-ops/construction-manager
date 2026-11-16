import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as XLSX from 'xlsx';
import { readXlsStyles } from './xls-styles';
import { mergeImportedValues, normalizeSnapshotFormats, sheetJsToSnapshot, snapshotToSheetJs, type WorkSlipBookSnapshot } from './work-slip-book-convert';

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

test('xlsの組み込み書式56(中国語時刻書式に誤変換)を m月d日 に補正し、行高は元の値を保つ', () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['作業日']]);
  ws.A2 = { t: 'n', v: 46303, z: '"上午/下午 "hh"時"mm"分"ss"秒 "' };
  ws['!ref'] = 'A1:A2';
  ws['!rows'] = [{ hpt: 40.4 }, { hpt: 15 }];
  XLSX.utils.book_append_sheet(wb, ws, '作業伝票2026年10月');
  const snap = sheetJsToSnapshot(wb, '作業伝票');
  const patterns = Object.values(snap.styles).map((s) => (s as { n: { pattern: string } }).n.pattern);
  assert.deepEqual(patterns, ['m"月"d"日"']);
  const sheet = snap.sheets['sheet-1'] as { rowData: Record<string, { h?: number }> };
  assert.equal(sheet.rowData[0].h, 54);
  assert.equal(sheet.rowData[1].h, 20);

  const stored = { ...snap, styles: { x: { n: { pattern: '"上午/下午 "hh"時"mm"分"ss"秒 "' } } } };
  assert.equal((normalizeSnapshotFormats(stored).styles.x as { n: { pattern: string } }).n.pattern, 'm"月"d"日"');
});

function sheetBook(rows: unknown[][]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'S');
  return wb;
}

test('.xls の書式(罫線・塗り・太字・固定行)を Univer スタイルへ変換する', () => {
  const buf = Buffer.from(XLSX.write(sheetBook([['a', 'b'], [1, 2]]), { type: 'buffer', bookType: 'biff8' }) as Uint8Array);
  const xls = readXlsStyles(buf);
  assert.ok(xls && xls.xfStyles.length > 0);
  const sheetName = [...xls.sheets.keys()][0];
  assert.ok(xls.sheets.get(sheetName)!.cellXf.size >= 4);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const snap = sheetJsToSnapshot(wb, 'x', xls);
  const cell = (snap.sheets['sheet-1'] as { cellData: Record<string, Record<string, { s?: string }>> }).cellData[0][0];
  assert.ok(cell.s && (snap.styles[cell.s] as { fs?: number }).fs! > 0);
  assert.equal(readXlsStyles(Buffer.from('not an xls')), null);
});

type Sh = {
  name: string;
  id: string;
  rowCount: number;
  columnCount: number;
  freeze: unknown;
  mergeData: unknown;
  columnData: unknown;
  rowData: unknown;
  cellData: Record<string, Record<string, { v?: unknown; s?: string }>>;
};

function bookSnap(): WorkSlipBookSnapshot {
  return {
    id: 'work-slip-book',
    name: 'x',
    appVersion: '3.0.0-alpha',
    locale: 'jaJP',
    styles: { a: { bl: 1 }, b: { bg: { rgb: '#FF0000' } } },
    sheetOrder: ['s1', 's2'],
    sheets: {
      s1: {
        id: 's1',
        name: '当該月',
        rowCount: 10,
        columnCount: 5,
        freeze: { xSplit: 0, ySplit: 1, startRow: 1, startColumn: 0 },
        mergeData: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }],
        columnData: { 0: { w: 321 } },
        rowData: { 0: { h: 77 } },
        cellData: { 0: { 0: { v: 'old', t: 1, s: 'a' }, 1: { v: 5, t: 2, s: 'b' } }, 2: { 0: { v: 'gone', t: 1, s: 'b' }, 1: { v: 'plain', t: 1 } } },
      },
      s2: { id: 's2', name: 'ブックだけ', rowCount: 5, columnCount: 5, cellData: { 0: { 0: { v: 'keep', t: 1 } } } },
    },
  };
}

function importedSnap(): WorkSlipBookSnapshot {
  return {
    id: 'work-slip-book',
    name: 'x',
    appVersion: '3.0.0-alpha',
    locale: 'jaJP',
    styles: { st1: { fs: 18 }, st2: { bl: 1 } },
    sheetOrder: ['sheet-1', 'sheet-2'],
    sheets: {
      'sheet-1': {
        id: 'sheet-1',
        name: '当該月',
        rowCount: 40,
        columnCount: 3,
        columnData: { 0: { w: 10 } },
        rowData: { 0: { h: 10 } },
        mergeData: [],
        cellData: { 0: { 0: { v: 'new', t: 1, s: 'st1' }, 1: { v: 6, t: 2 } }, 3: { 2: { v: 'added', t: 1, s: 'st2' } }, 4: { 0: { s: 'st1' } } },
      },
      'sheet-2': { id: 'sheet-2', name: '新しいタブ', rowCount: 3, columnCount: 3, cellData: { 0: { 0: { v: 'fresh', t: 1, s: 'st1' } } }, columnData: { 0: { w: 99 } } },
    },
  };
}

test('取込マージ: 内容だけ更新し、書式・列幅・行高・結合・固定は維持する', () => {
  const base = bookSnap();
  const imported = importedSnap();
  const baseCopy = structuredClone(base);
  const importedCopy = structuredClone(imported);
  const merged = mergeImportedValues(base, imported);
  assert.deepEqual(base, baseCopy);
  assert.deepEqual(imported, importedCopy);

  const s1 = merged.sheets.s1 as Sh;
  assert.deepEqual(s1.columnData, { 0: { w: 321 } });
  assert.deepEqual(s1.rowData, { 0: { h: 77 } });
  assert.deepEqual(s1.freeze, baseCopy.sheets.s1.freeze);
  assert.deepEqual(s1.mergeData, baseCopy.sheets.s1.mergeData);
  assert.deepEqual(s1.cellData[0][0], { v: 'new', t: 1, s: 'a' });
  assert.deepEqual(s1.cellData[0][1], { v: 6, t: 2, s: 'b' });
  assert.deepEqual(s1.cellData[2][0], { s: 'b' });
  assert.equal(s1.cellData[2][1], undefined);
  assert.equal(s1.cellData[4], undefined);
  assert.equal(s1.rowCount, 40);
  assert.equal(s1.columnCount, 5);
});

test('取込マージ: 新規セルは書式を重複なく引き継ぎ、新しいシートは末尾に追加、ブックだけのシートは残す', () => {
  const merged = mergeImportedValues(bookSnap(), importedSnap());
  const s1 = merged.sheets.s1 as Sh;
  assert.equal(s1.cellData[3][2].s, 'a');
  assert.deepEqual(merged.sheetOrder.slice(0, 2), ['s1', 's2']);
  assert.equal(merged.sheetOrder.length, 3);
  const added = merged.sheets[merged.sheetOrder[2]] as Sh;
  assert.equal(added.name, '新しいタブ');
  assert.equal(added.id, merged.sheetOrder[2]);
  assert.deepEqual(added.columnData, { 0: { w: 99 } });
  assert.deepEqual(merged.styles[added.cellData[0][0].s ?? ''], { fs: 18 });
  assert.deepEqual(merged.styles.a, { bl: 1 });
  assert.equal((merged.sheets.s2 as Sh).cellData[0][0].v, 'keep');
});