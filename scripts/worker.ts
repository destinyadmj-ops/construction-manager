import "dotenv/config";
import { startRemindersWorker } from "../src/server/queue/worker";
import { RedisUnavailableError } from "../src/server/queue/connection";

let worker;
try {
  worker = startRemindersWorker();
} catch (e) {
  if (e instanceof RedisUnavailableError) {
    console.warn('[worker] Redis is unavailable; reminders worker is not started.');
    console.warn('[worker] Start Docker Desktop then run: npm run docker:up');

    // In development, allow the command to succeed even if Redis is not configured.
    if (process.env.NODE_ENV !== 'production') {
      process.exit(0);
    }

    process.exit(1);
  }
  throw e;
}

worker.on('completed', (job) => {
  console.log(`completed ${job.id}`);
});

worker.on('failed', (job, err) => {
  console.error(`failed ${job?.id}`, err);
});

worker.on('error', (err) => {
  console.error('worker error', err);
});

console.log('Reminders worker started');
