import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as XLSX from 'xlsx';
import { resolveWorkSlipLedgerSheets } from '../shared/work-slip-tabs';
import type { extractWorkSlipLedgerRows as ExtractFn } from './shared-excel-sync';

let extractWorkSlipLedgerRows: typeof ExtractFn;

// prisma クライアントの import に DATABASE_URL が要る(接続はしない)
before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test';
  ({ extractWorkSlipLedgerRows } = await import('./shared-excel-sync'));
});

type Row = [company: string, site: string, amount: number | ''];

function sheetOf(rows: Row[]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet([['請求先', '件名', '金額'], ...rows]);
}

function bookOf(tabs: Record<string, Row[]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(tabs)) XLSX.utils.book_append_sheet(wb, sheetOf(rows), name);
  return wb;
}

test('2タブ(当該月 + オリジナル)のみ取り込み、他タブは同じ見出しでも無視する', () => {
  const wb = bookOf({
    '（旧）台帳': [['旧会社', '旧現場', 1]],
    解約: [['解約会社', '解約現場', 2]],
    作業伝票オリジナル: [['会社A', '現場A', 100]],
    作業伝票2026年10月: [['会社B', '現場B', 200]],
    作業伝票2026年11月: [['会社C', '現場C', 300]],
  });
  const { rows, sheets } = extractWorkSlipLedgerRows(wb, '2026-10-15');
  assert.deepEqual(rows.map((r) => r.siteName).sort(), ['現場A', '現場B']);
  assert.equal(sheets.monthSheet, '作業伝票2026年10月');
  assert.equal(sheets.originalSheet, '作業伝票オリジナル');
  assert.deepEqual(sheets.warnings, []);
});

test('当該月のタブは対象月に応じて切り替わる', () => {
  const wb = bookOf({
    作業伝票オリジナル: [['会社A', '現場A', 100]],
    作業伝票2026年10月: [['会社B', '現場B', 200]],
    作業伝票2026年11月: [['会社C', '現場C', 300]],
  });
  const nov = extractWorkSlipLedgerRows(wb, '2026-11-01');
  assert.deepEqual(nov.rows.map((r) => r.siteName).sort(), ['現場A', '現場C']);
  const oct = extractWorkSlipLedgerRows(wb, '2026-10-31');
  assert.deepEqual(oct.rows.map((r) => r.siteName).sort(), ['現場A', '現場B']);
});

test('全角数字・空白の揺れを吸収してタブを解決する', () => {
  const sheets = resolveWorkSlipLedgerSheets(['作業伝票 ２０２６年１０月', '作業伝票オリジナル'], '2026-10-05');
  assert.equal(sheets.monthSheet, '作業伝票 ２０２６年１０月');
  assert.equal(sheets.originalSheet, '作業伝票オリジナル');
});

test('タブ欠落時は警告を返し、全シートへフォールバックしない', () => {
  const onlyOriginal = bookOf({
    作業伝票オリジナル: [['会社A', '現場A', 100]],
    解約: [['解約会社', '解約現場', 2]],
  });
  const a = extractWorkSlipLedgerRows(onlyOriginal, '2026-10-15');
  assert.deepEqual(a.rows.map((r) => r.siteName), ['現場A']);
  assert.equal(a.sheets.monthSheet, null);
  assert.equal(a.sheets.warnings.length, 1);

  const none = bookOf({ 解約: [['解約会社', '解約現場', 2]], 作業伝票2026年9月: [['会社', '9月現場', 1]] });
  const b = extractWorkSlipLedgerRows(none, '2026-10-15');
  assert.deepEqual(b.rows, []);
  assert.equal(b.sheets.warnings.length, 2);
});

test('同じ会社/現場が2タブにある場合は当該月を優先し、金額が空の時だけオリジナルで補う', () => {
  const wb = bookOf({
    作業伝票オリジナル: [
      ['会社A', '現場X', 100],
      ['会社A', '現場Y', 500],
    ],
    作業伝票2026年10月: [
      ['会社A', '現場X', 200],
      ['会社A', '現場Y', ''],
    ],
  });
  const { rows } = extractWorkSlipLedgerRows(wb, '2026-10-15');
  const byName = new Map(rows.map((r) => [r.siteName, r.amount] as const));
  assert.equal(rows.length, 2);
  assert.equal(byName.get('現場X'), 200);
  assert.equal(byName.get('現場Y'), 500);
});
