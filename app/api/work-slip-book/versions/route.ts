import { z } from 'zod';
import { getCurrentMeta, listVersions, readVersion, saveVersion } from '@/server/work-slip-book';
import { guardWorkSlipBook } from '@/server/work-slip-book-auth';
import { reflectBookToLedgerInBackground } from '@/server/work-slip-book-reflect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RestoreSchema = z.object({ version: z.number().int().min(1) });

export async function GET(request: Request) {
  const guard = await guardWorkSlipBook(request);
  if (guard.response) return guard.response;
  return Response.json({ ok: true, current: (await getCurrentMeta())?.version ?? null, versions: await listVersions() });
}

// 過去の版を「新しい版」として復元する(履歴は消さない)。
export async function POST(request: Request) {
  const guard = await guardWorkSlipBook(request);
  if (guard.response) return guard.response;

  const parsed = RestoreSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: 'Invalid body' }, { status: 400 });

  const snapshot = await readVersion(parsed.data.version);
  if (!snapshot) return Response.json({ ok: false, error: 'Version not found' }, { status: 404 });
  const meta = await saveVersion({ snapshot, baseVersion: null, user: guard.user, source: 'restore' });
  reflectBookToLedgerInBackground();
  return Response.json({ ok: true, meta });
}
