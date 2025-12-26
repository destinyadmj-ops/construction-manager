import { prisma } from '@/server/db/prisma';

export const runtime = 'nodejs';

// List all export presets (keys, names, updatedAt).
// Used by the UI for template execution/management.
export async function GET() {
  const presets = await prisma.accountingExportPreset.findMany({
    orderBy: { updatedAt: 'desc' },
    select: { key: true, name: true, updatedAt: true },
  });

  return Response.json({ ok: true, presets });
}
