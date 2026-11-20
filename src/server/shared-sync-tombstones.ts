import { prisma } from '@/server/db/prisma';
import { Prisma } from '@/generated/prisma';
import {
  buildSyncTombstone,
  mergeSyncTombstones,
  parseSyncTombstones,
  pruneSyncTombstones,
  type SyncTombstone,
} from '@/shared/shared-sync-protection';

// 同期由来の予定をアプリで削除/移動したことの記録(作業表☆の同期で再作成しないため)。
// 既存の全体設定(UserUiSetting)の JSON に保存する(マイグレーション不要)。失敗しても予定の編集自体は止めない。
type ScheduleKind = 'NORMAL' | 'DAILY';

const GLOBAL_UI_SETTINGS_USER_ID = '__MASTER_HUB_GLOBAL__';
const MAX_TOMBSTONES = 20000;

function settingKey(kind: ScheduleKind): string {
  return `shared-sync:${kind === 'DAILY' ? 'daily' : 'normal'}:tombstones`;
}

function localYmd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function readSyncTombstones(kind: ScheduleKind): Promise<SyncTombstone[]> {
  try {
    const setting = await prisma.userUiSetting.findUnique({
      where: { userId_key: { userId: GLOBAL_UI_SETTINGS_USER_ID, key: settingKey(kind) } },
      select: { value: true },
    });
    return pruneSyncTombstones(parseSyncTombstones(setting?.value), localYmd(new Date()));
  } catch (error) {
    console.warn('[shared-sync] 削除記録の読み込みに失敗しました(再作成の抑止なしで続行):', error instanceof Error ? error.message : error);
    return [];
  }
}

export type DeletedScheduleRow = { userId: string; startAt: Date; summary: string | null; accountingMeta: unknown; dayYmd?: string };

// 同期由来(accountingMeta.sharedExcelSync あり)の予定だけを記録する。手入力の予定は同期が触らないので記録しない。
export async function recordSyncDeletions(kind: ScheduleKind, rows: DeletedScheduleRow[]): Promise<void> {
  if (rows.length === 0) return;
  const atIso = new Date().toISOString();
  const added: SyncTombstone[] = [];
  for (const row of rows) {
    const t = buildSyncTombstone({ userId: row.userId, dayYmd: row.dayYmd ?? localYmd(row.startAt), summary: row.summary, accountingMeta: row.accountingMeta }, atIso);
    if (t) added.push(t);
  }
  if (added.length === 0) return;
  try {
    const key = settingKey(kind);
    const current = await readSyncTombstones(kind);
    const merged = mergeSyncTombstones(current, added).slice(-MAX_TOMBSTONES);
    const value = merged as unknown as Prisma.InputJsonValue;
    await prisma.userUiSetting.upsert({
      where: { userId_key: { userId: GLOBAL_UI_SETTINGS_USER_ID, key } },
      create: { userId: GLOBAL_UI_SETTINGS_USER_ID, key, value },
      update: { value },
    });
  } catch (error) {
    console.warn('[shared-sync] 削除記録の保存に失敗しました:', error instanceof Error ? error.message : error);
  }
}
