import { z } from 'zod';
import { POST as cellPost } from '../cell/route';

export const runtime = 'nodejs';

const BodySchema = z
  .object({
    userId: z.string().min(1),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    siteId: z.string().optional().nullable(),
    siteName: z.string().min(1).max(200).optional().nullable(),
  })
  .strict();

// Assign a site name to a user/day by creating a WorkEntry.
// This is a minimal MVP endpoint to support list-driven input.
export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(json ?? {});
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'Invalid body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Legacy alias: behave exactly like POST /api/schedule/cell with action=toggle.
  return cellPost(
    new Request(request.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: parsed.data.userId,
        day: parsed.data.day,
        action: 'toggle',
        siteId: parsed.data.siteId ?? null,
        siteName: parsed.data.siteName ?? null,
      }),
    }),
  );
}
