// 週予定の同期(作業表☆→アプリ)から、アプリでの編集・削除を守るための純粋関数(DB・Node 依存なし)。
// 編集印: accountingMeta.sharedExcelSync.appEditedAt / 削除記録: 人・日・文言(と rowKey)のキー。

export const APP_EDITED_AT_KEY = 'appEditedAt';

// 削除記録の保持期間(その週が過ぎてからの日数)。【要承認】原本は過去の週のタブも残るため、短いと削除した過去の予定が再作成される。
export const SYNC_TOMBSTONE_RETENTION_DAYS = 400;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function syncMetaOf(meta: unknown): Record<string, unknown> | null {
  return asObject(asObject(meta)?.sharedExcelSync);
}

export function hasSyncOriginMeta(meta: unknown): boolean {
  return syncMetaOf(meta) != null;
}

export function getSyncRowKey(meta: unknown): string | null {
  const rowKey = syncMetaOf(meta)?.rowKey;
  return typeof rowKey === 'string' ? rowKey : null;
}

export function isAppEditedSyncMeta(meta: unknown): boolean {
  const at = syncMetaOf(meta)?.[APP_EDITED_AT_KEY];
  return typeof at === 'string' && at.length > 0;
}

// 同期由来の予定をアプリで編集したときの accountingMeta。同期由来でない・既に印があるときは入力をそのまま返す。
export function markAppEditedMeta(meta: unknown, atIso: string): Record<string, unknown> | null {
  const base = asObject(meta);
  const sync = syncMetaOf(meta);
  if (!base || !sync) return base;
  if (isAppEditedSyncMeta(meta)) return base;
  return { ...base, sharedExcelSync: { ...sync, [APP_EDITED_AT_KEY]: atIso } };
}

export function normalizeTombstoneText(text: string | null | undefined): string {
  return (text ?? '').normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('ja-JP');
}

export type SyncTombstone = {
  /** `${userId}|${YYYY-MM-DD}` */
  cell: string;
  /** 正規化した現場名/文言 */
  text: string;
  /** 削除された予定が持っていた同期キー(あれば) */
  rowKey: string | null;
  /** 予定の日付(保持期間の起点) */
  day: string;
  /** 記録時刻(ISO) */
  at: string;
};

export function buildSyncTombstone(
  row: { userId: string; dayYmd: string; summary: string | null; accountingMeta: unknown },
  atIso: string,
): SyncTombstone | null {
  if (!hasSyncOriginMeta(row.accountingMeta)) return null;
  const text = normalizeTombstoneText(row.summary);
  const rowKey = getSyncRowKey(row.accountingMeta);
  if (!text && !rowKey) return null;
  return { cell: `${row.userId}|${row.dayYmd}`, text, rowKey, day: row.dayYmd, at: atIso };
}

function textKey(cell: string, text: string) {
  return `text|${cell}|${text}`;
}

export function buildSuppressionSet(tombstones: SyncTombstone[]): Set<string> {
  const keys = new Set<string>();
  for (const t of tombstones) {
    if (t.text) keys.add(textKey(t.cell, t.text));
    if (t.rowKey) keys.add(`row|${t.rowKey}`);
  }
  return keys;
}

// 原本の希望(want)が、アプリで削除された同期由来の予定と同じなら true(再作成しない)。文言が変われば別のキーになるので false。
export function isSuppressedByTombstone(
  suppression: ReadonlySet<string>,
  want: { userId: string; dayYmd: string; summary: string; sourceKey: string },
): boolean {
  if (suppression.size === 0) return false;
  return suppression.has(`row|${want.sourceKey}`) || suppression.has(textKey(`${want.userId}|${want.dayYmd}`, normalizeTombstoneText(want.summary)));
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function endOfWeekYmd(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  const dow = d.getUTCDay(); // 0=日
  return addDaysYmd(ymd, dow === 0 ? 0 : 7 - dow);
}

export function pruneSyncTombstones(
  tombstones: SyncTombstone[],
  todayYmd: string,
  retentionDays: number = SYNC_TOMBSTONE_RETENTION_DAYS,
): SyncTombstone[] {
  return tombstones.filter((t) => addDaysYmd(endOfWeekYmd(t.day), retentionDays) >= todayYmd);
}

// 保存形式(JSON)から安全に復元する。壊れた要素は捨てる。
export function parseSyncTombstones(value: unknown): SyncTombstone[] {
  if (!Array.isArray(value)) return [];
  const out: SyncTombstone[] = [];
  for (const item of value) {
    const o = asObject(item);
    if (!o) continue;
    if (typeof o.cell !== 'string' || typeof o.text !== 'string' || typeof o.day !== 'string' || typeof o.at !== 'string') continue;
    out.push({ cell: o.cell, text: o.text, rowKey: typeof o.rowKey === 'string' ? o.rowKey : null, day: o.day, at: o.at });
  }
  return out;
}

export function mergeSyncTombstones(current: SyncTombstone[], added: SyncTombstone[]): SyncTombstone[] {
  const seen = new Set(current.map((t) => `${t.cell}|${t.text}|${t.rowKey ?? ''}`));
  const merged = [...current];
  for (const t of added) {
    const key = `${t.cell}|${t.text}|${t.rowKey ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(t);
  }
  return merged;
}
