import { Queue } from 'bullmq';
import { createRedisConnectionOrNull, RedisUnavailableError } from './connection';

export const QUEUE_NAMES = {
  reminders: 'reminders',
  sharedSync: 'shared-sync',
  sharedSyncSchedule: 'shared-sync-schedule',
} as const;

let remindersQueue: Queue | undefined;
let sharedSyncQueue: Queue | undefined;
let sharedSyncScheduleQueue: Queue | undefined;

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

export function getSharedSyncScheduleQueue() {
  if (!sharedSyncScheduleQueue) {
    const connection = createRedisConnectionOrNull();
    if (!connection) throw new RedisUnavailableError('REDIS_URL is not set');
    sharedSyncScheduleQueue = new Queue(QUEUE_NAMES.sharedSyncSchedule, { connection });
  }

  return sharedSyncScheduleQueue;
}
