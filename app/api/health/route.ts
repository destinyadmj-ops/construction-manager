import { prisma } from '@/server/db/prisma';
import { createRedisConnectionOrNull } from '@/server/queue/connection';
import { getStorageBaseDir } from '@/server/site-storage';
import { access, mkdir } from 'node:fs/promises';

export const runtime = 'nodejs';

const CHECK_TIMEOUT_MS = 2_000;

type CheckResult = {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  path?: string;
};

function timeoutMessage(name: string) {
  return `${name} check timed out after ${CHECK_TIMEOUT_MS}ms`;
}

async function withTimeout<T>(name: string, promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage(name))), CHECK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkDatabase(): Promise<CheckResult> {
  const startedAt = Date.now();

  try {
    await withTimeout('database', prisma.$queryRawUnsafe('SELECT 1'));
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Database check failed',
    };
  }
}

async function checkRedis(): Promise<CheckResult> {
  const startedAt = Date.now();
  const redis = createRedisConnectionOrNull();

  if (!redis) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: 'REDIS_URL is not set',
    };
  }

  try {
    await withTimeout(
      'redis',
      new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          redis.off('ready', onReady);
          redis.off('error', onError);
        };

        const onReady = () => {
          cleanup();
          resolve();
        };

        const onError = (error: unknown) => {
          cleanup();
          reject(error);
        };

        if (redis.status === 'ready') {
          resolve();
          return;
        }

        redis.once('ready', onReady);
        redis.once('error', onError);
      }),
    );

    await withTimeout('redis', redis.ping());
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Redis check failed',
    };
  } finally {
    redis.disconnect();
  }
}

async function checkStorage(): Promise<CheckResult> {
  const startedAt = Date.now();
  const storagePath = getStorageBaseDir();

  try {
    await withTimeout('storage', mkdir(storagePath, { recursive: true }));
    await withTimeout('storage', access(storagePath));
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      path: storagePath,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      path: storagePath,
      error: error instanceof Error ? error.message : 'Storage check failed',
    };
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const probe = (url.searchParams.get('probe') ?? 'live').trim().toLowerCase();

  if (probe !== 'ready') {
    return Response.json({
      ok: true,
      service: 'master-hub',
      probe: 'live',
      now: new Date().toISOString(),
    });
  }

  const [database, redis, storage] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkStorage(),
  ]);

  const ok = database.ok && redis.ok && storage.ok;

  return Response.json(
    {
      ok,
      service: 'master-hub',
      probe: 'ready',
      now: new Date().toISOString(),
      checks: {
        database,
        redis,
        storage,
      },
    },
    { status: ok ? 200 : 503 },
  );
}
