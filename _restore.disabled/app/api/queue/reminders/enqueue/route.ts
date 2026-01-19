import { z } from 'zod';
import { setTimeout as delay } from 'timers/promises';
import { getRemindersQueue } from '@/server/queue/queues';
import { RedisUnavailableError } from '@/server/queue/connection';

const BodySchema = z
  .object({
    message: z.string().min(1).optional(),
    delayMs: z.number().int().min(0).max(60_000).optional(),
  })
  .default({});

export async function POST(req: Request) {
  const json = await req.json().catch(() => ({}));
  const body = BodySchema.parse(json);

  const redisUnavailable = () =>
    Response.json(
      { ok: false, error: 'Redis is unavailable. Start Docker Desktop then run npm run docker:up.' },
      { status: 503 },
    );

  let remindersQueue;
  try {
    remindersQueue = getRemindersQueue();
  } catch (e) {
    if (e instanceof RedisUnavailableError) {
      return redisUnavailable();
    }
    throw e;
  }

  try {
    await Promise.race([
      remindersQueue.waitUntilReady(),
      delay(2_000).then(() => {
        throw new Error('Redis not ready');
      }),
    ]);
  } catch {
    return redisUnavailable();
  }

  try {
    const job = await Promise.race([
      remindersQueue.add(
        'smoke',
        { message: body.message ?? 'hello', at: new Date().toISOString() },
        { delay: body.delayMs ?? 0 },
      ),
      delay(2_000).then(() => {
        throw new Error('Redis enqueue timeout');
      }),
    ]);

    return Response.json({ ok: true, jobId: job.id });
  } catch {
    return redisUnavailable();
  }
}
