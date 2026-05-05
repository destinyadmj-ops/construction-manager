import { hashUserPassword, validateUserPassword } from '@/server/auth/user-password';
import { requireUserManager } from '@/server/auth/user-admin';
import { prisma } from '@/server/db/prisma';
import { z } from 'zod';

export const runtime = 'nodejs';

const BodySchema = z
  .object({
    userId: z.string().min(1).max(200),
    password: z.string().max(200),
  })
  .strict();

export async function POST(request: Request) {
  const authError = await requireUserManager(request);
  if (authError) return authError;

  const json = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  const passwordError = validateUserPassword(parsed.data.password);
  if (passwordError) {
    return Response.json({ ok: false, error: passwordError }, { status: 400 });
  }

  try {
    const passwordSetAt = new Date();
    const user = await prisma.user.update({
      where: { id: parsed.data.userId },
      data: {
        passwordHash: await hashUserPassword(parsed.data.password),
        passwordSetAt,
      },
      select: { id: true, passwordSetAt: true },
    });

    return Response.json({ ok: true, user: { id: user.id, passwordConfigured: true, passwordSetAt: user.passwordSetAt } });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Update failed' },
      { status: 503 },
    );
  }
}