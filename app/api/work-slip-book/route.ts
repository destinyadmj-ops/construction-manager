import { z } from 'zod';
import { getCurrentMeta, readVersion, saveVersion, WorkSlipBookConflictError } from '@/server/work-slip-book';
import { guardWorkSlipBook } from '@/server/work-slip-book-auth';
import { reflectBookToLedgerInBackground } from '@/server/work-slip-book-reflect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PutSchema = z.object({ baseVersion: z.number().int().min(0), snapshot: z.unknown() });

export async function GET(request: Request) {
  const guard = await guardWorkSlipBook(request);
  if (guard.response) return guard.response;

  const meta = await getCurrentMeta();
  if (!meta) return Response.json({ ok: true, meta: null, snapshot: null }, { headers: { 'Cache-Control': 'no-store' } });
  const snapshot = await readVersion(meta.version);
  return Response.json({ ok: true, meta, snapshot }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(request: Request) {
  const guard = await guardWorkSlipBook(request);
  if (guard.response) return guard.response;

  const parsed = PutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: 'Invalid body' }, { status: 400 });

  try {
    const meta = await saveVersion({
      snapshot: parsed.data.snapshot,
      baseVersion: parsed.data.baseVersion,
      user: guard.user,
      source: 'edit',
    });
    reflectBookToLedgerInBackground();
    return Response.json({ ok: true, meta });
  } catch (error) {
    if (error instanceof WorkSlipBookConflictError) {
      return Response.json({ ok: false, error: 'CONFLICT', currentVersion: error.currentVersion }, { status: 409 });
    }
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Save failed' }, { status: 400 });
  }
}
