import { randomUUID } from 'node:crypto';
import { createRedisConnectionOrNull } from '@/server/queue/connection';

// 週予定の同期(schedule)と台帳・関係会社の反映(ledger)は別ロックにする。重い台帳反映が5分おきの週予定同期を止めないため。
export type SharedSyncScope = 'schedule' | 'ledger' | 'all';
type SingleScope = Exclude<SharedSyncScope, 'all'>;

const LOCK_KEYS: Record<SingleScope, string> = {
  schedule: 'masterhub:shared-sync:schedule:lock',
  ledger: 'masterhub:shared-sync:ledger:lock',
};
// プロセスが落ちた場合の最長保持時間。実行中は定期的に延長する。
const LOCK_TTL_MS = 10 * 60_000;
const EXTEND_INTERVAL_MS = LOCK_TTL_MS / 3;
const RELEASE_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0";
const EXTEND_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) end return 0";

const localBusy: Record<SingleScope, boolean> = { schedule: false, ledger: false };

export async function waitUntilRedisReady(redis: NonNullable<ReturnType<typeof createRedisConnectionOrNull>>) {
  if (redis.status === 'ready') return true;
  return await new Promise<boolean>((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      redis.off('ready', onReady);
      redis.off('end', onEnd);
      resolve(ok);
    };
    const onReady = () => done(true);
    const onEnd = () => done(false);
    const timer = setTimeout(() => done(false), 3_000);
    redis.once('ready', onReady);
    redis.once('end', onEnd);
  });
}

async function acquireSingle(scope: SingleScope): Promise<null | (() => Promise<void>)> {
  if (localBusy[scope]) return null;
  localBusy[scope] = true;
  const releaseLocal = async () => {
    localBusy[scope] = false;
  };

  const redis = createRedisConnectionOrNull();
  if (!redis) return releaseLocal;

  const key = LOCK_KEYS[scope];
  const token = randomUUID();
  try {
    if (!(await waitUntilRedisReady(redis))) {
      redis.disconnect();
      return releaseLocal;
    }
    const ok = await redis.set(key, token, 'PX', LOCK_TTL_MS, 'NX');
    if (ok !== 'OK') {
      redis.disconnect();
      localBusy[scope] = false;
      return null;
    }
  } catch {
    redis.disconnect();
    return releaseLocal;
  }

  const extendTimer = setInterval(() => {
    void redis.eval(EXTEND_SCRIPT, 1, key, token, String(LOCK_TTL_MS)).catch(() => undefined);
  }, EXTEND_INTERVAL_MS);
  extendTimer.unref?.();

  return async () => {
    clearInterval(extendTimer);
    try {
      await redis.eval(RELEASE_SCRIPT, 1, key, token);
    } catch {
      // TTL で自然に解放される
    } finally {
      redis.disconnect();
      localBusy[scope] = false;
    }
  };
}

// 同期の同時実行を防ぐ排他。取得できなければ null。Redis があれば worker/web 間も排他し、無ければ(または不達なら)プロセス内のみ。
// scope=all は schedule と ledger の両方を取る(片方でも実行中なら null)。
export async function tryAcquireSharedSyncLock(scope: SharedSyncScope = 'all'): Promise<null | (() => Promise<void>)> {
  if (scope !== 'all') return await acquireSingle(scope);

  const releaseSchedule = await acquireSingle('schedule');
  if (!releaseSchedule) return null;
  const releaseLedger = await acquireSingle('ledger');
  if (!releaseLedger) {
    await releaseSchedule();
    return null;
  }
  return async () => {
    await releaseLedger();
    await releaseSchedule();
  };
}
