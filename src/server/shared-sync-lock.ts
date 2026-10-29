import { randomUUID } from 'node:crypto';
import { createRedisConnectionOrNull } from '@/server/queue/connection';

const LOCK_KEY = 'masterhub:shared-sync:lock';
const LOCK_TTL_MS = 15 * 60_000;
const RELEASE_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0";

let localBusy = false;

async function waitUntilReady(redis: NonNullable<ReturnType<typeof createRedisConnectionOrNull>>) {
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

// 同期の同時実行を防ぐ排他。取得できなければ null。Redis があれば worker/web 間も排他し、無ければ(または不達なら)プロセス内のみ。
export async function tryAcquireSharedSyncLock(): Promise<null | (() => Promise<void>)> {
  if (localBusy) return null;
  localBusy = true;
  const releaseLocal = async () => {
    localBusy = false;
  };

  const redis = createRedisConnectionOrNull();
  if (!redis) return releaseLocal;

  const token = randomUUID();
  try {
    if (!(await waitUntilReady(redis))) {
      redis.disconnect();
      return releaseLocal;
    }
    const ok = await redis.set(LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX');
    if (ok !== 'OK') {
      redis.disconnect();
      localBusy = false;
      return null;
    }
  } catch {
    redis.disconnect();
    return releaseLocal;
  }

  return async () => {
    try {
      await redis.eval(RELEASE_SCRIPT, 1, LOCK_KEY, token);
    } catch {
      // TTL で自然に解放される
    } finally {
      redis.disconnect();
      localBusy = false;
    }
  };
}
