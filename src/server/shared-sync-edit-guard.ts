import { prisma } from '@/server/db/prisma';
import { Prisma } from '@/generated/prisma';
import { requireScheduleEditor } from '@/server/auth/schedule-edit';
import { recordSyncDeletions, type DeletedScheduleRow } from '@/server/shared-sync-tombstones';
import { hasSyncOriginMeta, isAppEditedSyncMeta, markAppEditedMeta } from '@/shared/shared-sync-protection';

// 週予定の編集API(セル編集・入替・色変更)を包み、作業表☆から同期された予定をアプリで
// 編集/移動/削除したときに「編集済みの印」と「削除記録」を残す。次回以降の同期はそれらを上書き・再作成しない。
// 保護の記録に失敗しても、利用者の編集自体は成功のまま返す。

type ScheduleKind = 'NORMAL' | 'DAILY';
type Target = { userId: string; dayYmd: string };
type GuardRow = { id: string; userId: string; dayYmd: string; startAt: Date; summary: string | null; siteId: string | null; accountingMeta: Prisma.JsonValue | null };
type Snapshot = { kind: ScheduleKind; rows: GuardRow[] };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readTarget(value: unknown): Target | null {
  const o = asObject(value);
  if (!o || typeof o.userId !== 'string' || typeof o.day !== 'string' || !DAY_RE.test(o.day) || !o.userId) return null;
  return { userId: o.userId, dayYmd: o.day };
}

export function extractGuardTargets(body: unknown): { kind: ScheduleKind; targets: Target[] } {
  const o = asObject(body);
  const kind: ScheduleKind = o?.kind === 'DAILY' ? 'DAILY' : 'NORMAL';
  const targets = [readTarget(o), readTarget(o?.from), readTarget(o?.to)].filter((t): t is Target => t != null);
  return { kind, targets };
}

function startOfDayLocal(ymd: string): Date {
  const d = new Date(`${ymd}T00:00:00`);
  d.setHours(0, 0, 0, 0);
  return d;
}

function localYmd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function takeSnapshot(kind: ScheduleKind, targets: Target[]): Promise<Snapshot | null> {
  const rows: GuardRow[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    const key = `${target.userId}|${target.dayYmd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const startAt = startOfDayLocal(target.dayYmd);
    const until = new Date(startAt);
    until.setDate(until.getDate() + 1);
    const found = await prisma.workEntry.findMany({
      where: { userId: target.userId, kind, startAt: { gte: startAt, lt: until } },
      select: { id: true, userId: true, startAt: true, summary: true, siteId: true, accountingMeta: true },
    });
    for (const row of found) {
      if (hasSyncOriginMeta(row.accountingMeta)) rows.push({ ...row, dayYmd: target.dayYmd });
    }
  }
  return rows.length > 0 ? { kind, rows } : null;
}

async function applyGuard(snapshot: Snapshot): Promise<void> {
  const after = await prisma.workEntry.findMany({
    where: { id: { in: snapshot.rows.map((r) => r.id) } },
    select: { id: true, userId: true, startAt: true, summary: true, siteId: true, accountingMeta: true },
  });
  const afterById = new Map(after.map((row) => [row.id, row] as const));
  const nowIso = new Date().toISOString();
  const tombstoned: DeletedScheduleRow[] = [];

  for (const before of snapshot.rows) {
    const now = afterById.get(before.id);
    if (!now) {
      tombstoned.push(before); // 削除された
      continue;
    }
    const moved = now.userId !== before.userId || localYmd(now.startAt) !== before.dayYmd;
    if (moved) tombstoned.push(before); // 元の人・日からは無くなった(原本が元の場所へ作り直さない)
    if (!hasSyncOriginMeta(now.accountingMeta) || isAppEditedSyncMeta(now.accountingMeta)) continue;
    const changed =
      moved ||
      now.summary !== before.summary ||
      now.siteId !== before.siteId ||
      now.startAt.getTime() !== before.startAt.getTime() ||
      JSON.stringify(now.accountingMeta) !== JSON.stringify(before.accountingMeta);
    if (!changed) continue;
    const marked = markAppEditedMeta(now.accountingMeta, nowIso);
    if (!marked) continue;
    await prisma.workEntry.update({ where: { id: now.id }, data: { accountingMeta: marked as Prisma.InputJsonObject }, select: { id: true } });
  }

  await recordSyncDeletions(snapshot.kind, tombstoned);
}

export async function guardScheduleEdit(request: Request, handler: (request: Request) => Promise<Response>): Promise<Response> {
  let snapshot: Snapshot | null = null;
  try {
    // 権限の無いリクエストでは DB を読まない(handler 側でも同じ認可が行われる)
    if (!(await requireScheduleEditor(request))) {
      const body = await request.clone().json().catch(() => null);
      const { kind, targets } = extractGuardTargets(body);
      if (targets.length > 0) snapshot = await takeSnapshot(kind, targets);
    }
  } catch (error) {
    console.warn('[shared-sync] 編集前の記録に失敗しました(編集は続行):', error instanceof Error ? error.message : error);
  }

  const response = await handler(request);

  if (snapshot && response.ok) {
    try {
      await applyGuard(snapshot);
    } catch (error) {
      console.warn('[shared-sync] 編集内容の保護記録に失敗しました:', error instanceof Error ? error.message : error);
    }
  }
  return response;
}
