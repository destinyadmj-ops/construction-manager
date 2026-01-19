import { Worker } from 'bullmq';
import { createRedisConnectionOrNull, RedisUnavailableError } from './connection';
import { QUEUE_NAMES } from './queues';

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
