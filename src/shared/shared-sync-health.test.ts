import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateSharedSyncHealth } from './shared-sync-health';

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
  assert.ok(h.reasons.some((r) => r.includes('同期元が見つかりません')));
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
