import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateUploadHealth,
  extensionOfUpload,
  isUploadBusinessHours,
  validateUploadBytes,
  validateUploadFileName,
  type UploadMeta,
} from './shared-sync-upload';

const zip = (n = 10) => Uint8Array.from([0x50, 0x4b, 0x03, 0x04, ...Array(n).fill(1)]);

test('ファイル名: 作業表☆で始まる Excel だけ受け付ける', () => {
  assert.equal(validateUploadFileName('作業表☆.xlsx').ok, true);
  assert.equal(validateUploadFileName('作業表☆2026.XLS').ok, true);
  assert.equal(validateUploadFileName('見積.xlsx').ok, false);
  assert.equal(validateUploadFileName('作業表☆.csv').ok, false);
  assert.equal(validateUploadFileName('../作業表☆.xlsx').ok, false);
  assert.equal(validateUploadFileName('').ok, false);
});

test('中身: ZIP/OLE の先頭バイトだけ受け付け、空・巨大は拒否する', () => {
  assert.equal(validateUploadBytes(zip(), 100).ok, true);
  assert.equal(validateUploadBytes(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]), 100).ok, true);
  assert.equal(validateUploadBytes(new Uint8Array(), 100).ok, false);
  const big = validateUploadBytes(zip(200), 100);
  assert.equal(big.ok === false && big.status, 413);
  const text = validateUploadBytes(new TextEncoder().encode('<html>not excel</html>'), 100);
  assert.equal(text.ok === false && text.status, 415);
  assert.equal(extensionOfUpload('作業表☆.xls'), '.xls');
  assert.equal(extensionOfUpload('作業表☆.xlsx'), '.xlsx');
});

test('稼働時間: 日本時間の月〜土 7時〜20時', () => {
  assert.equal(isUploadBusinessHours(Date.parse('2026-11-20T01:00:00Z')), true); // 金 10:00 JST
  assert.equal(isUploadBusinessHours(Date.parse('2026-11-20T12:00:00Z')), false); // 金 21:00 JST
  assert.equal(isUploadBusinessHours(Date.parse('2026-11-22T01:00:00Z')), false); // 日 10:00 JST
});

test('送信の途絶: 稼働時間内で45分超のときだけ警告。受信実績ゼロも警告', () => {
  const meta: UploadMeta = { sha256: 'a', fileName: '作業表☆.xlsx', sizeBytes: 1, sourceMtimeMs: 0, receivedAt: '2026-11-20T00:00:00Z', via: 'agent' };
  const now = Date.parse('2026-11-20T01:00:00Z'); // 金 10:00 JST
  assert.equal(evaluateUploadHealth({ meta, contact: { lastContactAt: '2026-11-20T00:30:00Z' }, nowMs: now }).level, 'ok');
  assert.equal(evaluateUploadHealth({ meta, contact: { lastContactAt: '2026-11-19T23:00:00Z' }, nowMs: now }).level, 'warn');
  assert.equal(evaluateUploadHealth({ meta: null, contact: null, nowMs: now }).level, 'warn');
  // 夜間は古くても警告しない
  assert.equal(evaluateUploadHealth({ meta, contact: { lastContactAt: '2026-11-20T00:30:00Z' }, nowMs: Date.parse('2026-11-20T14:00:00Z') }).level, 'ok');
});
