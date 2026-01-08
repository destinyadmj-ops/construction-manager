import { prisma } from '@/server/db/prisma';
import { generateSimplePdf } from '@/server/templates/simplePdf';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';

const BodySchema = z
  .object({
    siteId: z.string().min(1),
    partnerId: z.string().min(1),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();

function isAuthorized(request: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return process.env.NODE_ENV !== 'production';
  return request.headers.get('x-admin-token') === token;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) throw new Error(`${name} is not set`);
  return v;
}

function safeFilePart(input: string) {
  const v = input.trim();
  if (!v) return 'unknown';
  return v
    .replace(/[\\/]/g, '-')
    .replace(/[:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const outboxDir = requireEnv('PRINT_OUTBOX_DIR');

    const [site, partner] = await Promise.all([
      prisma.site.findUnique({ where: { id: parsed.data.siteId } }),
      prisma.partner.findUnique({ where: { id: parsed.data.partnerId } }),
    ]);

    if (!site) return Response.json({ ok: false, error: 'Site not found' }, { status: 404 });
    if (!partner) return Response.json({ ok: false, error: 'Partner not found' }, { status: 404 });

    const siteLabel = `${site.companyName ? `${site.companyName} ` : ''}${site.name}`.trim();

    const pdfLines: string[] = [];
    pdfLines.push(`宛先: ${partner.name}`);
    pdfLines.push(`現場: ${siteLabel}`);
    if (parsed.data.from && parsed.data.to) pdfLines.push(`期間: ${parsed.data.from}〜${parsed.data.to}`);
    if (site.amount) pdfLines.push(`金額: ¥${Number(site.amount).toLocaleString('ja-JP')}`);
    if (site.address) pdfLines.push(`住所: ${site.address}`);
    if (site.phone) pdfLines.push(`電話: ${site.phone}`);
    if (site.contactName) pdfLines.push(`担当: ${site.contactName}`);

    const { bytes, filename, contentType } = await generateSimplePdf({
      kind: 'invoice',
      title: '請求書',
      subtitle: 'Master Hub',
      lines: pdfLines,
    });

    if (contentType !== 'application/pdf') {
      throw new Error(`Unexpected contentType: ${contentType}`);
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = `${ts}__${safeFilePart(partner.name)}__${safeFilePart(siteLabel)}__PRINT`;

    const dir = path.resolve(outboxDir);
    await fs.mkdir(dir, { recursive: true });

    const pdfPath = path.join(dir, `${baseName}.pdf`);
    const metaPath = path.join(dir, `${baseName}.json`);

    const buf = Buffer.from(bytes);
    await fs.writeFile(pdfPath, buf);
    await fs.writeFile(
      metaPath,
      JSON.stringify(
        {
          kind: 'INVOICE',
          siteId: site.id,
          partnerId: partner.id,
          partnerName: partner.name,
          siteLabel,
          period: parsed.data.from && parsed.data.to ? { from: parsed.data.from, to: parsed.data.to } : null,
          fileName: filename,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );

    try {
      await prisma.storedDocument.create({
        data: {
          siteId: site.id,
          partnerId: partner.id,
          kind: 'INVOICE',
          subject: `請求書 印刷 ${siteLabel}`,
          tags: {
            action: 'PRINT',
            outbox: 'PRINT_OUTBOX_DIR',
            metaPath,
            period: parsed.data.from && parsed.data.to ? { from: parsed.data.from, to: parsed.data.to } : null,
          },
          fileName: `${baseName}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: buf.byteLength,
          storedPath: pdfPath,
        },
      });
    } catch {
      // History is best-effort; printing should still succeed.
    }

    return Response.json({ ok: true, outboxDir: dir, pdfPath, metaPath });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    return Response.json({ ok: false, error: msg }, { status: 503 });
  }
}
