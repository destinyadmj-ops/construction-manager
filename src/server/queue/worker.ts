import { Worker } from 'bullmq';
import { createRedisConnectionOrNull, RedisUnavailableError } from './connection';
import { QUEUE_NAMES, getSharedSyncQueue, getSharedSyncScheduleQueue } from './queues';
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

type SharedSyncScope = 'schedule' | 'ledger' | 'all';

type SharedSyncJobData = {
  kind: 'NORMAL' | 'DAILY';
  targetTerm: number | null;
  sourceKey: string;
  // 未指定(旧ジョブ)は all として扱う
  scope?: SharedSyncScope;
};

// 週予定(作業表☆)の同期は5分おき、台帳・関係会社(作業伝票)の反映は30分おき。重い台帳反映が週予定を遅らせないよう、キューもロックも分ける。
const DEFAULT_SCHEDULE_SYNC_INTERVAL_MS = 5 * 60_000;
const DEFAULT_LEDGER_SYNC_INTERVAL_MS = 30 * 60_000;
const MIN_SHARED_SYNC_INTERVAL_MS = 60_000;

function readIntervalMs(envName: string, defaultMs: number) {
  const raw = Number(process.env[envName] ?? defaultMs);
  if (!Number.isFinite(raw) || raw < MIN_SHARED_SYNC_INTERVAL_MS) return defaultMs;
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

function createSharedSyncWorker(queueName: string) {
  const connection = createRedisConnectionOrNull();
  if (!connection) throw new RedisUnavailableError('REDIS_URL is not set');

  return new Worker(
    queueName,
    async (job) => {
      const data = (job.data ?? {}) as Partial<SharedSyncJobData>;
      const kind = data.kind === 'DAILY' ? 'DAILY' : 'NORMAL';
      const scope: SharedSyncScope = data.scope === 'schedule' || data.scope === 'ledger' ? data.scope : 'all';
      const targetTerm = Number.isFinite(data.targetTerm) ? Number(data.targetTerm) : null;
      const sourceKey = typeof data.sourceKey === 'string' ? data.sourceKey : null;
      const startedAt = Date.now();
      try {
        const result = await runSharedSync({ kind, targetTerm, scope });
        console.log(
          `[worker][shared-sync] success: scope=${scope} kind=${kind} durationMs=${Date.now() - startedAt} counts=${JSON.stringify(result.counts)}${result.warnings.length > 0 ? ` warnings=${JSON.stringify(result.warnings.slice(0, 3))}` : ''}`
        );
        return { ok: true, scope, kind, sourceKey, counts: result.counts };
      } catch (error) {
        if (error instanceof SharedSyncError && error.code === 'BUSY') {
          // 別の同期(手動同期など)が実行中。次の周期で再実行されるが、見落とさないよう warn で残す。
          console.warn(`[worker][shared-sync] skipped (busy): scope=${scope} kind=${kind} reason=${error.message}`);
          return { ok: true, skipped: true, scope, kind, sourceKey };
        }
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[worker][shared-sync] failed: scope=${scope} kind=${kind} durationMs=${Date.now() - startedAt} error=${message}`);
        throw error;
      }
    },
    { connection }
  );
}

// 台帳・関係会社の反映キュー(30分おき・手動同期の従来キュー)
export function startSharedSyncWorker() {
  return createSharedSyncWorker(QUEUE_NAMES.sharedSync);
}

// 週予定の同期キュー(5分おき)。台帳側の長い処理に待たされないよう別キューにする。
export function startSharedSyncScheduleWorker() {
  return createSharedSyncWorker(QUEUE_NAMES.sharedSyncSchedule);
}

function startScopePoller(scope: Exclude<SharedSyncScope, 'all'>, queue: ReturnType<typeof getSharedSyncQueue>, intervalMs: number) {
  const kinds: Array<'NORMAL' | 'DAILY'> = ['NORMAL', 'DAILY'];
  let polling = false;

  console.log(`[worker][shared-sync] poller started: scope=${scope} intervalMs=${intervalMs} (sync on start + every interval, regardless of file mtime)`);

  // mtime に関わらず毎回同期する(再実行は冪等)。起動前の更新や過去の失敗後でも必ず追従させるため。
  const tick = async (reason: 'start' | 'interval') => {
    if (polling) return;
    polling = true;
    try {
      for (const kind of kinds) {
        const targetTerm = parseTargetTermByKind(kind);
        try {
          const version = await getSharedSyncSourceVersion({ kind, targetTerm, scope });
          if (!version.hasSources || !version.key) {
            console.warn(
              `[worker][shared-sync] skip: scope=${scope} kind=${kind} sources not found dir=${version.sharedDir} workTable=${version.workTableFileName ?? '-'} workSlip=${version.workSlipFileName ?? '-'}`
            );
            continue;
          }

          const pending = await queue.getJobs(['waiting', 'active', 'delayed'], 0, 50);
          if (pending.some((job) => (job.data as Partial<SharedSyncJobData> | undefined)?.kind === kind)) {
            console.log(`[worker][shared-sync] skip enqueue: scope=${scope} kind=${kind} previous job still pending`);
            continue;
          }

          await queue.add(
            'shared-sync',
            { kind, targetTerm, sourceKey: version.key, scope } satisfies SharedSyncJobData,
            {
              jobId: `shared-sync-${scope}-${kind}-${Date.now()}`,
              removeOnComplete: 20,
              removeOnFail: 50,
            }
          );
          console.log(`[worker][shared-sync] enqueued: scope=${scope} kind=${kind} reason=${reason} key=${version.key}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[worker][shared-sync] tick failed: scope=${scope} kind=${kind} reason=${reason} error=${message}`);
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

export function startSharedSyncPoller() {
  const stopSchedule = startScopePoller(
    'schedule',
    getSharedSyncScheduleQueue(),
    readIntervalMs('SHARED_SYNC_SCHEDULE_INTERVAL_MS', DEFAULT_SCHEDULE_SYNC_INTERVAL_MS)
  );
  const stopLedger = startScopePoller(
    'ledger',
    getSharedSyncQueue(),
    readIntervalMs('SHARED_SYNC_POLL_INTERVAL_MS', DEFAULT_LEDGER_SYNC_INTERVAL_MS)
  );
  return () => {
    stopSchedule();
    stopLedger();
  };
}
