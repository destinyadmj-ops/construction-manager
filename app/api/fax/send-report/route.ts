import { prisma } from '@/server/db/prisma';
import { getSiteDayFolderPaths } from '@/server/site-storage';
import { generateSimplePdf } from '@/server/templates/simplePdf';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';

const BodySchema = z
  .object({
    siteId: z.string().min(1),
    partnerId: z.string().min(1),
    fax: z.string().max(50).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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

function ymdInTokyo(d: Date) {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
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
    const outboxDir = requireEnv('FAX_OUTBOX_DIR');

    const [site, partner] = await Promise.all([
      prisma.site.findUnique({ where: { id: parsed.data.siteId } }),
      prisma.partner.findUnique({ where: { id: parsed.data.partnerId } }),
    ]);

    if (!site) return Response.json({ ok: false, error: 'Site not found' }, { status: 404 });
    if (!partner) return Response.json({ ok: false, error: 'Partner not found' }, { status: 404 });

    const faxNumber = (parsed.data.fax ?? partner.fax ?? '').trim();
    if (!faxNumber) {
      return Response.json({ ok: false, error: 'Partner fax is missing' }, { status: 400 });
    }

    const siteLabel = `${site.companyName ? `${site.companyName} ` : ''}${site.name}`.trim();

    const pdfLines: string[] = [];
    pdfLines.push(`宛先: ${partner.name}`);
    pdfLines.push(`FAX: ${faxNumber}`);
    pdfLines.push(`現場: ${siteLabel}`);
    if (site.address) pdfLines.push(`住所: ${site.address}`);
    if (site.phone) pdfLines.push(`電話: ${site.phone}`);
    if (site.contactName) pdfLines.push(`担当: ${site.contactName}`);

    const { bytes, filename, contentType } = await generateSimplePdf({
      kind: 'report',
      title: '報告書',
      subtitle: 'Master Hub',
      lines: pdfLines,
    });

    if (contentType !== 'application/pdf') {
      throw new Error(`Unexpected contentType: ${contentType}`);
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = `${ts}__${safeFilePart(partner.name)}__${safeFilePart(siteLabel)}`;

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
          kind: 'REPORT',
          siteId: site.id,
          partnerId: partner.id,
          partnerName: partner.name,
          siteLabel,
          faxNumber,
          fileName: filename,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );

    try {
      const dateYmd = parsed.data.date ?? ymdInTokyo(new Date());
      const { reportsDir } = await getSiteDayFolderPaths(site.id, site.name, dateYmd);
      await fs.mkdir(reportsDir, { recursive: true });

      const storedPdfPath = path.join(reportsDir, `${baseName}.pdf`);
      await fs.copyFile(pdfPath, storedPdfPath);

      await prisma.storedDocument.create({
        data: {
          siteId: site.id,
          partnerId: partner.id,
          kind: 'REPORT',
          subject: `報告書 FAX ${siteLabel}`,
          bizDateYmd: parsed.data.date ?? dateYmd,
          tags: {
            action: 'FAX',
            outbox: 'FAX_OUTBOX_DIR',
            metaPath,
            faxNumber,
          },
          fileName: `${baseName}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: buf.byteLength,
          storedPath: storedPdfPath,
        },
      });
    } catch {
      // History is best-effort; fax outbox should still succeed.
    }

    return Response.json({ ok: true, outboxDir: dir, pdfPath, metaPath });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed';
    return Response.json({ ok: false, error: msg }, { status: 503 });
  }
}
