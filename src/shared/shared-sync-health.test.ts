import assert from 'node:assert/strict';
import test from 'node:test';
import { describeSharedFolderAccessFailure, evaluateSharedSyncHealth, getSharedSourceDirConfigWarning } from './shared-sync-health';

const now = Date.parse('2026-01-01T12:00:00.000Z');
const ago = (min: number) => new Date(now - min * 60_000).toISOString();

test('最近成功していれば警告なし', () => {
  const h = evaluateSharedSyncHealth({ scope: 'schedule', run: { at: ago(3), result: 'success', lastSuccessAt: ago(3) }, poller: null, nowMs: now });
  assert.equal(h.level, 'ok');
});

test('schedule は 15 分超で警告、ledger は 90 分までは警告なし', () => {
  const run = { at: ago(20), result: 'success' as const, lastSuccessAt: ago(20) };
  assert.equal(evaluateSharedSyncHealth({ scope: 'schedule', run, poller: null, nowMs: now }).level, 'warn');
  assert.equal(evaluateSharedSyncHealth({ scope: 'ledger', run, poller: null, nowMs: now }).level, 'ok');
  const old = { at: ago(100), result: 'success' as const, lastSuccessAt: ago(100) };
  assert.equal(evaluateSharedSyncHealth({ scope: 'ledger', run: old, poller: null, nowMs: now }).level, 'warn');
});

test('原本に変化なしで同期を省いている間は、再同期の期限内なら警告しない', () => {
  const run = { at: ago(50), result: 'success' as const, lastSuccessAt: ago(50) };
  assert.equal(evaluateSharedSyncHealth({ scope: 'schedule', run, poller: { at: ago(1), reason: 'unchanged' }, nowMs: now }).level, 'ok');
  // 期限(再同期間隔+余裕)を超えても同期されていなければ警告
  const stale = { at: ago(120), result: 'success' as const, lastSuccessAt: ago(120) };
  assert.equal(evaluateSharedSyncHealth({ scope: 'schedule', run: stale, poller: { at: ago(1), reason: 'unchanged' }, nowMs: now }).level, 'warn');
  // ポーラー自体が止まっていれば警告
  assert.equal(evaluateSharedSyncHealth({ scope: 'schedule', run, poller: { at: ago(40), reason: 'unchanged' }, nowMs: now }).level, 'warn');
});

test('worker 停止(ポーラーの記録が古い)', () => {
  const h = evaluateSharedSyncHealth({
    scope: 'schedule',
    run: { at: ago(60), result: 'success', lastSuccessAt: ago(60) },
    poller: { at: ago(60), reason: 'enqueued' },
    nowMs: now,
  });
  assert.equal(h.level, 'warn');
  assert.ok(h.reasons.some((r) => r.includes('動いていません')));
});

test('共有フォルダにファイルなし', () => {
  const h = evaluateSharedSyncHealth({
    scope: 'schedule',
    run: { at: ago(60), result: 'success', lastSuccessAt: ago(60) },
    poller: { at: ago(1), reason: 'no-sources', message: '作業表☆なし' },
    nowMs: now,
  });
  assert.equal(h.cause, 'no-files');
  assert.ok(h.reasons.some((r) => r.includes('同期元のファイルがありません')));
});

test('共有フォルダが見えない(worker は動作中)は worker 停止と区別する', () => {
  const message = describeSharedFolderAccessFailure({ dir: '\\\\host\\x', code: 'ENOENT', usingDefaultDir: true });
  const h = evaluateSharedSyncHealth({ scope: 'schedule', run: null, poller: { at: ago(1), reason: 'no-sources', message }, nowMs: now });
  assert.equal(h.cause, 'folder-unreachable');
  assert.ok(h.reasons.some((r) => r.includes('worker は動作中ですが共有フォルダが見えません') && r.includes('SHARED_SOURCE_HOST_PATH')));
  const down = evaluateSharedSyncHealth({ scope: 'schedule', run: null, poller: null, nowMs: now });
  assert.equal(down.cause, 'no-worker');
});

test('共有フォルダ不可の案内: 既定 UNC のままか、設定済みパスが見えないかで文言が変わる', () => {
  const unset = describeSharedFolderAccessFailure({ dir: 'D', code: 'ENOENT', usingDefaultDir: true });
  assert.match(unset, /MASTER_HUB_SHARED_SOURCE_DIR=\/shared-source/);
  const mounted = describeSharedFolderAccessFailure({ dir: '/shared-source', code: 'ENOENT', usingDefaultDir: false });
  assert.match(mounted, /\/shared-source にマウント/);
  assert.doesNotMatch(mounted, /未設定/);
});

test('同期失敗が続く', () => {
  const h = evaluateSharedSyncHealth({
    scope: 'schedule',
    run: { at: ago(2), result: 'failed', message: 'boom', lastSuccessAt: ago(40) },
    poller: { at: ago(1), reason: 'enqueued' },
    nowMs: now,
  });
  assert.ok(h.reasons.some((r) => r.includes('boom')));
});

test('起動直後(成功記録なし・投入済み)は警告しない', () => {
  const h = evaluateSharedSyncHealth({ scope: 'schedule', run: null, poller: { at: ago(1), reason: 'enqueued' }, nowMs: now });
  assert.equal(h.level, 'ok');
});

test('記録が何も無ければ警告', () => {
  const h = evaluateSharedSyncHealth({ scope: 'ledger', run: null, poller: null, nowMs: now });
  assert.equal(h.level, 'warn');
});

test('worker 起動時の警告は本番かつ MASTER_HUB_SHARED_SOURCE_DIR 未設定のときだけ', () => {
  assert.match(getSharedSourceDirConfigWarning({ NODE_ENV: 'production' }) ?? '', /SHARED_SOURCE_HOST_PATH/);
  assert.equal(getSharedSourceDirConfigWarning({ NODE_ENV: 'production', MASTER_HUB_SHARED_SOURCE_DIR: '/shared-source' }), null);
  assert.equal(getSharedSourceDirConfigWarning({ NODE_ENV: 'production', SHARED_SYNC_UPLOAD_TOKEN: 'x'.repeat(32) }), null);
  assert.equal(getSharedSourceDirConfigWarning({ NODE_ENV: 'development' }), null);
});
