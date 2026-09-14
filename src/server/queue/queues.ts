import { Queue } from 'bullmq';
import { createRedisConnectionOrNull, RedisUnavailableError } from './connection';

export const QUEUE_NAMES = {
  reminders: 'reminders',
  sharedSync: 'shared-sync',
} as const;

let remindersQueue: Queue | undefined;
let sharedSyncQueue: Queue | undefined;

export function getRemindersQueue() {
  if (!remindersQueue) {
    const connection = createRedisConnectionOrNull();
    if (!connection) throw new RedisUnavailableError('REDIS_URL is not set');
    remindersQueue = new Queue(QUEUE_NAMES.reminders, { connection });
  }

  return remindersQueue;
}

export function getSharedSyncQueue() {
  if (!sharedSyncQueue) {
    const connection = createRedisConnectionOrNull();
    if (!connection) throw new RedisUnavailableError('REDIS_URL is not set');
    sharedSyncQueue = new Queue(QUEUE_NAMES.sharedSync, { connection });
  }

  return sharedSyncQueue;
}
