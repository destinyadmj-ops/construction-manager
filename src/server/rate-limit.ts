import { createRedisConnectionOrNull } from '@/server/queue/connection';
import { waitUntilRedisReady } from '@/server/shared-sync-lock';

// Redis による固定窓のレート制限。Redis が使えないときは制限しない(受け口自体も Redis が無いと保存できない)。
export async function countRateLimitHit(bucket: string, windowSeconds: number): Promise<number | null> {
  const redis = createRedisConnectionOrNull();
  if (!redis) return null;
  try {
    if (!(await waitUntilRedisReady(redis))) return null;
    const key = `masterhub:ratelimit:${bucket}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    return count;
  } catch {
    return null;
  } finally {
    redis.disconnect();
  }
}

export async function readRateLimitCount(bucket: string): Promise<number> {
  const redis = createRedisConnectionOrNull();
  if (!redis) return 0;
  try {
    if (!(await waitUntilRedisReady(redis))) return 0;
    return Number(await redis.get(`masterhub:ratelimit:${bucket}`)) || 0;
  } catch {
    return 0;
  } finally {
    redis.disconnect();
  }
}
