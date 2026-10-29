import { Worker } from 'bullmq';
import { createRedisConnectionOrNull, RedisUnavailableError } from './connection';
import { QUEUE_NAMES, getSharedSyncQueue } from './queues';
import { SharedSyncError, getSharedSyncSourceVersion, runSharedSync } from '@/server/shared-excel-sync';

export function startRemindersWorker() {
  const connection = createRedisConnectionOrNull();
  if (!connection) throw new RedisUnavailableError('REDIS_URL is not set');
  return new Worker(
    QUEUE_NAMES.reminders,
    async (job) => {
      // TODO: implement real reminders (push/email/in-app)
      // This is a smoke-test processor.
      return { ok: true, received: job.data };
    },
    { connection }
  );
}

type SharedSyncJobData = {
  kind: 'NORMAL' | 'DAILY';
  targetTerm: number | null;
  sourceKey: string;
};

const DEFAULT_SHARED_SYNC_INTERVAL_MS = 30 * 60_000;
const MIN_SHARED_SYNC_INTERVAL_MS = 60_000;

function readSharedSyncPollIntervalMs() {
  const raw = Number(process.env.SHARED_SYNC_POLL_INTERVAL_MS ?? DEFAULT_SHARED_SYNC_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw < MIN_SHARED_SYNC_INTERVAL_MS) return DEFAULT_SHARED_SYNC_INTERVAL_MS;
  return Math.floor(raw);
}

// 未設定時は本番(NODE_ENV=production)のみ有効。開発PCの worker が実DBへ書き込まないようにする。
export function isSharedSyncPollEnabled() {
  const raw = (process.env.SHARED_SYNC_POLL_ENABLED ?? '').trim().toLowerCase();
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

function parseTargetTermByKind(kind: 'NORMAL' | 'DAILY'): number | null {
  const key = kind === 'NORMAL' ? 'SHARED_SYNC_TARGET_TERM_NORMAL' : 'SHARED_SYNC_TARGET_TERM_DAILY';
  const raw = Number(process.env[key] ?? '');
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
}

export function startSharedSyncWorker() {
  const connection = createRedisConnectionOrNull();
  if (!connection) throw new RedisUnavailableError('REDIS_URL is not set');

  return new Worker(
    QUEUE_NAMES.sharedSync,
    async (job) => {
      const data = (job.data ?? {}) as Partial<SharedSyncJobData>;
      const kind = data.kind === 'DAILY' ? 'DAILY' : 'NORMAL';
      const targetTerm = Number.isFinite(data.targetTerm) ? Number(data.targetTerm) : null;
      const sourceKey = typeof data.sourceKey === 'string' ? data.sourceKey : null;
      const startedAt = Date.now();
      try {
        const result = await runSharedSync({ kind, targetTerm });
        console.log(
          `[worker][shared-sync] success: kind=${kind} durationMs=${Date.now() - startedAt} counts=${JSON.stringify(result.counts)}`
        );
        return { ok: true, kind, sourceKey, counts: result.counts };
      } catch (error) {
        if (error instanceof SharedSyncError && error.code === 'BUSY') {
          console.log(`[worker][shared-sync] skipped (busy): kind=${kind}`);
          return { ok: true, skipped: true, kind, sourceKey };
        }
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[worker][shared-sync] failed: kind=${kind} durationMs=${Date.now() - startedAt} error=${message}`);
        throw error;
      }
    },
    { connection }
  );
}

export function startSharedSyncPoller() {
  const kinds: Array<'NORMAL' | 'DAILY'> = ['NORMAL', 'DAILY'];
  const intervalMs = readSharedSyncPollIntervalMs();
  const queue = getSharedSyncQueue();
  let polling = false;

  console.log(`[worker][shared-sync] poller started: intervalMs=${intervalMs} (sync on start + every interval, regardless of file mtime)`);

  // mtime に関わらず毎回同期する(再実行は冪等)。起動前の更新や過去の失敗後でも必ず追従させるため。
  const tick = async (reason: 'start' | 'interval') => {
    if (polling) return;
    polling = true;
    try {
      for (const kind of kinds) {
        const targetTerm = parseTargetTermByKind(kind);
        try {
          const version = await getSharedSyncSourceVersion({ kind, targetTerm });
          if (!version.hasSources || !version.key) {
            console.warn(
              `[worker][shared-sync] skip: kind=${kind} sources not found dir=${version.sharedDir} workTable=${version.workTableFileName ?? '-'} workSlip=${version.workSlipFileName ?? '-'}`
            );
            continue;
          }

          const pending = await queue.getJobs(['waiting', 'active', 'delayed'], 0, 50);
          if (pending.some((job) => (job.data as Partial<SharedSyncJobData> | undefined)?.kind === kind)) {
            console.log(`[worker][shared-sync] skip enqueue: kind=${kind} previous job still pending`);
            continue;
          }

          await queue.add(
            'shared-sync',
            { kind, targetTerm, sourceKey: version.key } satisfies SharedSyncJobData,
            {
              jobId: `shared-sync-${kind}-${Date.now()}`,
              removeOnComplete: 20,
              removeOnFail: 50,
            }
          );
          console.log(`[worker][shared-sync] enqueued: kind=${kind} reason=${reason} key=${version.key}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[worker][shared-sync] tick failed: kind=${kind} reason=${reason} error=${message}`);
        }
      }
    } finally {
      polling = false;
    }
  };

  void tick('start');
  const timer = setInterval(() => {
    void tick('interval');
  }, intervalMs);

  return () => {
    clearInterval(timer);
  };
}
