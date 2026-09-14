import "dotenv/config";
import type { Worker } from "bullmq";
import { startRemindersWorker, startSharedSyncPoller, startSharedSyncWorker } from "../src/server/queue/worker";
import { RedisUnavailableError } from "../src/server/queue/connection";

const workers: Worker[] = [];
let stopSharedSyncPoller: (() => void) | null = null;
try {
  workers.push(startRemindersWorker());
  workers.push(startSharedSyncWorker());
  stopSharedSyncPoller = startSharedSyncPoller();
} catch (e) {
  if (e instanceof RedisUnavailableError) {
    console.warn('[worker] Redis is unavailable; workers are not started.');
    console.warn('[worker] Start Docker Desktop then run: npm run docker:up');

    // In development, allow the command to succeed even if Redis is not configured.
    if (process.env.NODE_ENV !== 'production') {
      process.exit(0);
    }

    process.exit(1);
  }
  throw e;
}

for (const worker of workers) {
  worker.on('completed', (job, result) => {
    console.log(`completed queue=${worker.name} id=${job.id} result=${JSON.stringify(result)}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`failed queue=${worker.name} id=${job?.id}`, err);
  });

  worker.on('error', (err) => {
    console.error(`worker error queue=${worker.name}`, err);
  });
}

const closeAll = async () => {
  if (stopSharedSyncPoller) {
    stopSharedSyncPoller();
    stopSharedSyncPoller = null;
  }
  await Promise.all(workers.map((worker) => worker.close().catch(() => undefined)));
};

process.on('SIGINT', () => {
  void closeAll().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  void closeAll().finally(() => process.exit(0));
});

console.log('Workers started: reminders + shared-sync poller');
