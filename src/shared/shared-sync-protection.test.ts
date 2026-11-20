import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSuppressionSet,
  buildSyncTombstone,
  isAppEditedSyncMeta,
  isSuppressedByTombstone,
  markAppEditedMeta,
  mergeSyncTombstones,
  parseSyncTombstones,
  pruneSyncTombstones,
} from './shared-sync-protection';

const SYNC_META = { sharedExcelSync: { source: '作業表☆', rowKey: 'k1' }, labelColor: 'red' };

test('同期由来の予定だけに編集印を付け、他のキーは残す。二重に付けない', () => {
  const marked = markAppEditedMeta(SYNC_META, '2030-01-01T00:00:00.000Z');
  assert.ok(marked && isAppEditedSyncMeta(marked));
  assert.equal((marked as { labelColor: string }).labelColor, 'red');
  assert.equal(markAppEditedMeta(marked, '2031-01-01T00:00:00.000Z'), marked);
  assert.equal(markAppEditedMeta(null, 'x'), null);
  const manual = { scheduleEntryKind: 'site' };
  assert.equal(markAppEditedMeta(manual, 'x'), manual);
  assert.equal(isAppEditedSyncMeta(manual), false);
});

test('削除記録: 同じ人・日・文言(空白/全半角の違いを無視)または同じ rowKey のときだけ抑止する', () => {
  const t = buildSyncTombstone({ userId: 'u1', dayYmd: '2030-01-07', summary: '甲 ビル', accountingMeta: SYNC_META }, 'x');
  const set = buildSuppressionSet([t!]);
  assert.equal(isSuppressedByTombstone(set, { userId: 'u1', dayYmd: '2030-01-07', summary: '甲ビル', sourceKey: 'z' }), true);
  assert.equal(isSuppressedByTombstone(set, { userId: 'u1', dayYmd: '2030-01-07', summary: '別の現場', sourceKey: 'k1' }), true);
  assert.equal(isSuppressedByTombstone(set, { userId: 'u1', dayYmd: '2030-01-08', summary: '甲ビル', sourceKey: 'z' }), false);
  assert.equal(isSuppressedByTombstone(set, { userId: 'u2', dayYmd: '2030-01-07', summary: '甲ビル', sourceKey: 'z' }), false);
  assert.equal(isSuppressedByTombstone(new Set(), { userId: 'u1', dayYmd: '2030-01-07', summary: '甲ビル', sourceKey: 'z' }), false);
});

test('削除記録の保持期間: その週が過ぎてから指定日数たつと消える', () => {
  const t = buildSyncTombstone({ userId: 'u1', dayYmd: '2030-01-07', summary: '甲', accountingMeta: SYNC_META }, 'x')!; // 月曜、その週の日曜は 01-13
  assert.equal(pruneSyncTombstones([t], '2031-02-16', 400).length, 1); // 01-13 + 400日 = 2031-02-17
  assert.equal(pruneSyncTombstones([t], '2031-02-17', 400).length, 1);
  assert.equal(pruneSyncTombstones([t], '2031-02-18', 400).length, 0);
});

test('保存形式の復元と統合: 壊れた要素は捨て、重複は1件にする', () => {
  const parsed = parseSyncTombstones([{ cell: 'u1|2030-01-07', text: 'a', rowKey: null, day: '2030-01-07', at: 'x' }, { bad: true }, 'x', null]);
  assert.equal(parsed.length, 1);
  assert.equal(mergeSyncTombstones(parsed, parsed).length, 1);
  assert.deepEqual(parseSyncTombstones(undefined), []);
});
