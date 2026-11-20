import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as XLSX from 'xlsx';
import type * as Sync from './shared-excel-sync';

let mod: typeof Sync;

before(async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:5432/test';
  mod = await import('./shared-excel-sync');
});

const serial = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 86_400_000) + 25569;
const WEEK = ['月', '火', '水', '木', '金', '土', '日'];

function weekSheet(firstSerial: number, people: Array<[string, Array<string | undefined>]>): XLSX.WorkSheet {
  const header: unknown[] = [undefined];
  for (let i = 0; i < 7; i += 1) header.push(firstSerial + i);
  return XLSX.utils.aoa_to_sheet([[], header, [undefined, ...WEEK], ...people.map(([name, cells]) => [name, ...cells])]);
}

function bookOf(sheet: XLSX.WorkSheet): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'w');
  return wb;
}

test('括弧内の区切り(、 , /)では現場を分割せず、括弧の外だけで分割する', () => {
  const split = (text: string) => mod.splitSiteEntriesFromCell({ v: text, t: 's' }, text).map((x) => x.siteName);
  assert.deepEqual(split('甲店（東口、西口）、乙ビル'), ['甲店(東口、西口)', '乙ビル']);
  assert.deepEqual(split('丙ビル（6/9中止分）～丁ビル'), ['丙ビル(6/9中止分)~丁ビル']);
  assert.deepEqual(split('戊ビル（4F,3F専有部あり）己ビル'), ['戊ビル(4F,3F専有部あり)己ビル']);
  assert.deepEqual(split('庚、辛  壬'), ['庚', '辛', '壬']);
  // 閉じ括弧が無くても改行で区切りへ戻る
  assert.deepEqual(split('癸（\n子ビル'), ['癸(', '子ビル']);
});

test('日付セルの年が古くても、曜日行に合う年へ揃える(翌年1月の週)', () => {
  const base = new Date(2026, 10, 19);
  assert.equal(mod.alignYmdToWeekday('2026-01-04', '月', base), '2027-01-04');
  assert.equal(mod.alignYmdToWeekday('2026-11-16', '月', base), '2026-11-16');
  assert.equal(mod.alignYmdToWeekday('2026-11-16', undefined, base), '2026-11-16');
  assert.equal(mod.alignYmdToWeekday('2026-11-16', '？', base), '2026-11-16');

  const stale = bookOf(weekSheet(serial(2026, 1, 4), [['甲 乙', ['丙ビル', undefined, undefined, undefined, undefined, '丁ビル', undefined]]]));
  const { rows, coveredRange } = mod.extractWorkTable(stale, base);
  assert.deepEqual(rows.map((r) => r.dayYmd), ['2027-01-04', '2027-01-09']);
  assert.deepEqual(coveredRange, { minDay: '2027-01-04', maxDay: '2027-01-10' });
});

test('希望休み・休みも原本の文言のまま予定として取り込む', () => {
  const wb = bookOf(weekSheet(serial(2026, 11, 16), [['甲 乙', ['希望休み', '休み', undefined, undefined, undefined, undefined, undefined]]]));
  const { rows } = mod.extractWorkTable(wb, new Date(2026, 10, 19));
  assert.deepEqual(rows.map((r) => [r.dayYmd, r.entries.map((e) => e.siteName)]), [
    ['2026-11-16', ['希望休み']],
    ['2026-11-17', ['休み']],
  ]);
});
