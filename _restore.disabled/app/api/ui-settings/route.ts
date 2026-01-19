import { prisma } from '@/server/db/prisma';
import type { Prisma } from '@/generated/prisma';
import { z } from 'zod';

export const runtime = 'nodejs';

const GetSchema = z
  .object({
    userId: z.string().min(1).max(64),
    key: z.string().min(1).max(200),
  })
  .strict();

const PostSchema = z
  .object({
    userId: z.string().min(1).max(64),
    key: z.string().min(1).max(200),
    value: z.unknown(),
  })
  .strict();

function isReasonableValue(value: unknown): boolean {
  try {
    const s = JSON.stringify(value);
    // Prevent accidental huge writes.
    return s.length <= 50_000;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = GetSchema.safeParse({
    userId: (url.searchParams.get('userId') ?? '').trim(),
    key: (url.searchParams.get('key') ?? '').trim(),
  });

  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid query', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const hit = await prisma.userUiSetting.findUnique({
      where: { userId_key: { userId: parsed.data.userId, key: parsed.data.key } },
      select: { value: true },
    });

    if (!hit) {
      return Response.json({ ok: true, value: null });
    }

    return Response.json({ ok: true, value: hit.value });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = PostSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  if (!isReasonableValue(parsed.data.value)) {
    return Response.json({ ok: false, error: 'value is too large or not serializable' }, { status: 400 });
  }

  try {
    const value = parsed.data.value as Prisma.InputJsonValue;

    await prisma.userUiSetting.upsert({
      where: { userId_key: { userId: parsed.data.userId, key: parsed.data.key } },
      create: { userId: parsed.data.userId, key: parsed.data.key, value },
      update: { value },
      select: { id: true },
    });

    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}
