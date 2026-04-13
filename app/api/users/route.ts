import { prisma } from '@/server/db/prisma';
import { requireScheduleEditor } from '@/server/auth/schedule-edit';
import { z } from 'zod';

export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0, must-revalidate',
};

function toReadableDbErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : 'DB unavailable';
  const lower = msg.toLowerCase();

  if (lower.includes('authentication failed') || lower.includes('p1000')) {
    return 'DB認証に失敗しました。Supabase の DATABASE_URL（ユーザー名・パスワード・Pooler設定）を確認してください。';
  }
  if (lower.includes('denied access') || lower.includes('permission denied')) {
    return 'DBアクセス権限が不足しています。Supabase 接続文字列とロール権限を確認してください。';
  }
  if (lower.includes('table') && lower.includes('does not exist')) {
    return 'DBスキーマが未適用です。`npm run db:deploy` を実行してください。';
  }
  return msg;
}

const CreateSchema = z
  .object({
    name: z.string().max(200).optional().nullable(),
    email: z.string().email().max(320).optional().nullable(),
    kind: z.enum(['NORMAL', 'DAILY']).optional(),
  })
  .strict();

const UpdateSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().max(200).optional().nullable(),
    email: z.string().email().max(320).optional().nullable(),
    kind: z.enum(['NORMAL', 'DAILY']).optional().nullable(),
  })
  .strict();

const DeleteSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const kindParam = (url.searchParams.get('kind') ?? '').trim().toLowerCase();
    const kind = kindParam === 'daily' ? 'DAILY' : kindParam === 'all' ? null : 'NORMAL';

    const users = await prisma.user.findMany({
      where: kind ? { kind } : undefined,
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true, kind: true },
      take: 200,
    });

    return Response.json({ ok: true, users }, { headers: NO_STORE_HEADERS });
  } catch (e) {
    return Response.json(
      { ok: false, error: toReadableDbErrorMessage(e) },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}

export async function POST(request: Request) {
  const authError = await requireScheduleEditor(request);
  if (authError) return authError;

  const json = await request.json().catch(() => null);
  const parsed = CreateSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const name = typeof parsed.data.name === 'string' ? parsed.data.name.trim() || null : null;
    const email = typeof parsed.data.email === 'string' ? parsed.data.email.trim() || null : null;
    const kind = parsed.data.kind ?? 'NORMAL';

    if (!name && !email) {
      return Response.json({ ok: false, error: 'name or email is required' }, { status: 400 });
    }

    if (email) {
      const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) {
        const user = await prisma.user.update({
          where: { id: existing.id },
          data: { name, kind },
          select: { id: true, name: true, email: true },
        });
        return Response.json({ ok: true, user });
      }
    }

    const user = await prisma.user.create({
      data: { name, email, kind },
      select: { id: true, name: true, email: true },
    });

    return Response.json({ ok: true, user });
  } catch (e) {
    return Response.json(
      { ok: false, error: toReadableDbErrorMessage(e) },
      { status: 503 },
    );
  }
}

export async function PATCH(request: Request) {
  const authError = await requireScheduleEditor(request);
  if (authError) return authError;

  const json = await request.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const id = parsed.data.id;
    const name = typeof parsed.data.name === 'string' ? parsed.data.name.trim() || null : null;
    const email = typeof parsed.data.email === 'string' ? parsed.data.email.trim() || null : undefined;
    const kind = parsed.data.kind ?? undefined;

    const user = await prisma.user.update({
      where: { id },
      data: {
        name,
        ...(email !== undefined ? { email } : {}),
        ...(kind !== undefined ? { kind } : {}),
      },
      select: { id: true, name: true, email: true },
    });

    return Response.json({ ok: true, user });
  } catch (e) {
    const msg = toReadableDbErrorMessage(e);
    const status = msg.toLowerCase().includes('record to update not found') ? 404 : 503;
    return Response.json({ ok: false, error: msg }, { status });
  }
}

export async function DELETE(request: Request) {
  const authError = await requireScheduleEditor(request);
  if (authError) return authError;

  const url = new URL(request.url);
  const idFromQuery = (url.searchParams.get('id') ?? '').trim();
  const json = idFromQuery ? null : await request.json().catch(() => null);
  const parsed = DeleteSchema.safeParse(idFromQuery ? { id: idFromQuery } : (json ?? {}));
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    await prisma.user.delete({ where: { id: parsed.data.id }, select: { id: true } });
    return Response.json({ ok: true });
  } catch (e) {
    const msg = toReadableDbErrorMessage(e);
    const status = msg.toLowerCase().includes('record to delete does not exist') ? 404 : 503;
    return Response.json({ ok: false, error: msg }, { status });
  }
}
