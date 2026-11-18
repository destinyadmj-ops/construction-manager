import { createRedisConnectionOrNull } from '@/server/queue/connection';
import { waitUntilRedisReady, type SharedSyncScope } from '@/server/shared-sync-lock';

type SiteKind = 'NORMAL' | 'DAILY';

export type SharedSyncRunStatus = {
  scope: Exclude<SharedSyncScope, 'all'>;
  kind: SiteKind;
  /** 直近の実行の完了時刻(ISO) */
  at: string;
  result: 'success' | 'failed' | 'skipped';
  durationMs: number;
  /** 失敗・スキップ時の理由 / 成功時は未設定 */
  message?: string;
  /** 直近の成功時刻(ISO)。失敗が続いても最後に成功した時刻を保つ */
  lastSuccessAt?: string;
  counts?: Record<string, number>;
  warnings?: string[];
};

const STATUS_TTL_SECONDS = 14 * 24 * 60 * 60;

function statusKey(scope: SharedSyncRunStatus['scope'], kind: SiteKind) {
  return `masterhub:shared-sync:status:${scope}:${kind}`;
}

async function withRedis<T>(fn: (redis: NonNullable<ReturnType<typeof createRedisConnectionOrNull>>) => Promise<T>): Promise<T | null> {
  const redis = createRedisConnectionOrNull();
  if (!redis) return null;
  try {
    if (!(await waitUntilRedisReady(redis))) return null;
    return await fn(redis);
  } catch {
    return null;
  } finally {
    redis.disconnect();
  }
}

// 同期の最終実行結果を Redis に残す(web と worker は別プロセスのため)。記録に失敗しても同期自体には影響させない。
export async function recordSharedSyncStatus(
  scope: SharedSyncScope,
  entry: Omit<SharedSyncRunStatus, 'scope' | 'lastSuccessAt'>,
): Promise<void> {
  const scopes: Array<SharedSyncRunStatus['scope']> = scope === 'all' ? ['schedule', 'ledger'] : [scope];
  await withRedis(async (redis) => {
    for (const target of scopes) {
      const key = statusKey(target, entry.kind);
      let lastSuccessAt: string | undefined;
      if (entry.result === 'success') {
        lastSuccessAt = entry.at;
      } else {
        const previousText = await redis.get(key);
        if (previousText) {
          try {
            lastSuccessAt = (JSON.parse(previousText) as Partial<SharedSyncRunStatus>).lastSuccessAt;
          } catch {
            // ignore broken previous record
          }
        }
      }
      const value: SharedSyncRunStatus = { ...entry, scope: target, ...(lastSuccessAt ? { lastSuccessAt } : {}) };
      await redis.set(key, JSON.stringify(value), 'EX', STATUS_TTL_SECONDS);
    }
  });
}

export async function readSharedSyncStatuses(
  kind: SiteKind,
): Promise<{ schedule: SharedSyncRunStatus | null; ledger: SharedSyncRunStatus | null }> {
  const result = await withRedis(async (redis) => {
    const [scheduleText, ledgerText] = await Promise.all([
      redis.get(statusKey('schedule', kind)),
      redis.get(statusKey('ledger', kind)),
    ]);
    const parse = (text: string | null): SharedSyncRunStatus | null => {
      if (!text) return null;
      try {
        return JSON.parse(text) as SharedSyncRunStatus;
      } catch {
        return null;
      }
    };
    return { schedule: parse(scheduleText), ledger: parse(ledgerText) };
  });
  return result ?? { schedule: null, ledger: null };
}

export type SharedPollerTick = {
  scope: Exclude<SharedSyncScope, 'all'>;
  kind: SiteKind;
  /** tick を実行した時刻(ISO)。worker が生きている証拠(ハートビート) */
  at: string;
  reason: 'enqueued' | 'no-sources' | 'previous-pending' | 'error';
  message?: string;
  /** 直近で同期ジョブを投入した時刻(ISO) */
  lastEnqueuedAt?: string;
};

function pollerKey(scope: SharedPollerTick['scope'], kind: SiteKind) {
  return `masterhub:shared-sync:poller:${scope}:${kind}`;
}

// ポーラーの tick 結果を残す。同期自体の成否とは別に「worker が動いているか・なぜ投入されないか」を web から見えるようにする。
export async function recordSharedPollerTick(
  scope: SharedPollerTick['scope'],
  kind: SiteKind,
  entry: Pick<SharedPollerTick, 'reason' | 'message'>,
): Promise<void> {
  await withRedis(async (redis) => {
    const key = pollerKey(scope, kind);
    const now = new Date().toISOString();
    let lastEnqueuedAt: string | undefined;
    if (entry.reason === 'enqueued') {
      lastEnqueuedAt = now;
    } else {
      const previousText = await redis.get(key);
      if (previousText) {
        try {
          lastEnqueuedAt = (JSON.parse(previousText) as Partial<SharedPollerTick>).lastEnqueuedAt;
        } catch {
          // ignore broken previous record
        }
      }
    }
    const value: SharedPollerTick = { scope, kind, at: now, ...entry, ...(lastEnqueuedAt ? { lastEnqueuedAt } : {}) };
    await redis.set(key, JSON.stringify(value), 'EX', STATUS_TTL_SECONDS);
  });
}

export async function readSharedPollerTicks(
  kind: SiteKind,
): Promise<{ schedule: SharedPollerTick | null; ledger: SharedPollerTick | null }> {
  const result = await withRedis(async (redis) => {
    const [scheduleText, ledgerText] = await Promise.all([redis.get(pollerKey('schedule', kind)), redis.get(pollerKey('ledger', kind))]);
    const parse = (text: string | null): SharedPollerTick | null => {
      if (!text) return null;
      try {
        return JSON.parse(text) as SharedPollerTick;
      } catch {
        return null;
      }
    };
    return { schedule: parse(scheduleText), ledger: parse(ledgerText) };
  });
  return result ?? { schedule: null, ledger: null };
}