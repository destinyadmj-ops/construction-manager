import { Worker } from 'bullmq';
import { createRedisConnectionOrNull, RedisUnavailableError } from './connection';
import { QUEUE_NAMES, getSharedSyncQueue } from './queues';
import { getSharedSyncSourceVersion, runSharedSync } from '@/server/shared-excel-sync';

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

function readSharedSyncPollIntervalMs() {
  const raw = Number(process.env.SHARED_SYNC_POLL_INTERVAL_MS ?? 2_000);
  if (!Number.isFinite(raw) || raw < 500) return 2_000;
  return Math.floor(raw);
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
      const result = await runSharedSync({ kind, targetTerm });
      return {
        ok: true,
        kind,
        sourceKey: typeof data.sourceKey === 'string' ? data.sourceKey : null,
        counts: result.counts,
      };
    },
    { connection }
  );
}

export function startSharedSyncPoller() {
  const kinds: Array<'NORMAL' | 'DAILY'> = ['NORMAL', 'DAILY'];
  const lastSeenByKind = new Map<'NORMAL' | 'DAILY', string | null>();
  const intervalMs = readSharedSyncPollIntervalMs();
  const syncOnStart = process.env.SHARED_SYNC_POLL_SYNC_ON_START === '1';
  const queue = getSharedSyncQueue();
  let polling = false;

  const tick = async () => {
    if (polling) return;
    polling = true;
    try {
      for (const kind of kinds) {
        const version = await getSharedSyncSourceVersion({
          kind,
          targetTerm: parseTargetTermByKind(kind),
        }).catch(() => null);
        if (!version?.hasSources || !version.key) continue;

        const previous = lastSeenByKind.get(kind) ?? null;
        lastSeenByKind.set(kind, version.key);

        if (!syncOnStart && previous == null) {
          continue;
        }
        if (previous === version.key) {
          continue;
        }

        const targetTerm = parseTargetTermByKind(kind);
        const jobId = `shared-sync:${version.key}`;
        await queue.add(
          'shared-sync',
          { kind, targetTerm, sourceKey: version.key } satisfies SharedSyncJobData,
          {
            jobId,
            removeOnComplete: 20,
            removeOnFail: 50,
          }
        );
        console.log(`[worker][shared-sync] enqueued: kind=${kind} key=${version.key}`);
      }
    } finally {
      polling = false;
    }
  };

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return () => {
    clearInterval(timer);
  };
}
