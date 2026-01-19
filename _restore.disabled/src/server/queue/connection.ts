import IORedis from 'ioredis';

export function createRedisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  const redis = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    connectTimeout: 2_000,
  });

  // ioredis emits an 'error' event on connection failures.
  // If nobody listens to it, Node treats it as an unhandled error event and can terminate the process.
  redis.on('error', () => {
    // intentionally ignore (route handlers already handle readiness/availability)
  });

  return redis;
}

export function createRedisConnectionOrNull() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  return createRedisConnection();
}

export class RedisUnavailableError extends Error {
  constructor(message = 'Redis is unavailable') {
    super(message);
    this.name = 'RedisUnavailableError';
  }
}
