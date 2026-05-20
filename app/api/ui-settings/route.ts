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
    expectedUpdatedAt: z.union([z.string().datetime(), z.null()]).optional(),
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

async function readCurrentUiSetting(userId: string, key: string) {
  return prisma.userUiSetting.findUnique({
    where: { userId_key: { userId, key } },
    select: { value: true, updatedAt: true },
  });
}

function buildConflictResponse(current: { value: Prisma.JsonValue; updatedAt: Date } | null) {
  return Response.json(
    {
      ok: false,
      error: 'Conflict',
      currentValue: current?.value ?? null,
      currentUpdatedAt: current ? current.updatedAt.toISOString() : null,
    },
    { status: 409 },
  );
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
      select: { value: true, updatedAt: true },
    });

    if (!hit) {
      return Response.json({ ok: true, value: null, updatedAt: null });
    }

    return Response.json({ ok: true, value: hit.value, updatedAt: hit.updatedAt.toISOString() });
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
    const userId = parsed.data.userId;
    const key = parsed.data.key;
    const expectedUpdatedAt = parsed.data.expectedUpdatedAt;

    if (expectedUpdatedAt !== undefined) {
      if (expectedUpdatedAt === null) {
        const created = await prisma.userUiSetting.createMany({
          data: [{ userId, key, value }],
          skipDuplicates: true,
        });

        if (created.count !== 1) {
          const current = await readCurrentUiSetting(userId, key);
          return buildConflictResponse(current);
        }
      } else {
        const updated = await prisma.userUiSetting.updateMany({
          where: {
            userId,
            key,
            updatedAt: new Date(expectedUpdatedAt),
          },
          data: { value },
        });

        if (updated.count !== 1) {
          const current = await readCurrentUiSetting(userId, key);
          return buildConflictResponse(current);
        }
      }

      const saved = await prisma.userUiSetting.findUnique({
        where: { userId_key: { userId, key } },
        select: { updatedAt: true },
      });

      if (!saved) {
        const current = await readCurrentUiSetting(userId, key);
        return buildConflictResponse(current);
      }

      return Response.json({ ok: true, updatedAt: saved.updatedAt.toISOString() });
    }

    const saved = await prisma.userUiSetting.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key, value },
      update: { value },
      select: { updatedAt: true },
    });

    return Response.json({ ok: true, updatedAt: saved.updatedAt.toISOString() });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}
