import { prisma } from '@/server/db/prisma';
import { sendGraphMail } from '@/server/outlook/graph';
import { generateSimplePdf } from '@/server/templates/simplePdf';
import { z } from 'zod';

export const runtime = 'nodejs';

const BodySchema = z
  .object({
    siteId: z.string().min(1),
    partnerId: z.string().min(1),
    kind: z.enum(['report', 'invoice']).optional(),
    toEmail: z.string().email().max(320).optional(),
    subject: z.string().max(200).optional(),
  })
  .strict();

function isAuthorized(request: Request): boolean {
  const sendToken = process.env.OUTLOOK_SEND_TOKEN;
  if (sendToken) return request.headers.get('x-outlook-send-token') === sendToken;

  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken) return request.headers.get('x-admin-token') === adminToken;

  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.ALLOW_EMAIL_SEND_IN_PROD === '1';
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) throw new Error(`${name} is not set`);
  return v;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  const fromUser = (() => {
    try {
      return requireEnv('OUTLOOK_SENDER');
    } catch {
      return null;
    }
  })();

  let logId: string | null = null;

  try {
    if (!fromUser) throw new Error('OUTLOOK_SENDER is not set');

    const [site, partner] = await Promise.all([
      prisma.site.findUnique({ where: { id: parsed.data.siteId } }),
      prisma.partner.findUnique({ where: { id: parsed.data.partnerId } }),
    ]);

    if (!site) return Response.json({ ok: false, error: 'Site not found' }, { status: 404 });
    if (!partner) return Response.json({ ok: false, error: 'Partner not found' }, { status: 404 });

    const toEmail = (parsed.data.toEmail ?? partner.email ?? '').trim();
    if (!toEmail) {
      return Response.json({ ok: false, error: 'Partner email is missing' }, { status: 400 });
    }

    const kind = parsed.data.kind ?? 'report';
    const mailKind = kind === 'invoice' ? 'INVOICE' : 'REPORT';

    const siteLabel = `${site.companyName ? `${site.companyName} ` : ''}${site.name}`.trim();
    const subject = (
      parsed.data.subject && parsed.data.subject.trim().length > 0
        ? parsed.data.subject.trim()
        : `${kind === 'report' ? '報告書' : '請求書'}: ${siteLabel} / ${partner.name}`
    ).slice(0, 200);

    const bodyLines: string[] = [];
    bodyLines.push(`${kind === 'report' ? '報告書' : '請求書'} 送付`);
    bodyLines.push('');
    bodyLines.push(`宛先: ${partner.name}`);
    bodyLines.push(`現場: ${siteLabel}`);
    if (site.address) bodyLines.push(`住所: ${site.address}`);
    if (site.phone) bodyLines.push(`電話: ${site.phone}`);
    if (site.contactName) bodyLines.push(`担当: ${site.contactName}`);
    bodyLines.push('');
    bodyLines.push('※ Master Hub から送信');

    const created = await prisma.outlookSendLog.create({
      data: {
        siteId: site.id,
        partnerId: partner.id,
        kind: mailKind,
        status: 'FAILED',
        toEmail,
        subject,
      },
      select: { id: true },
    });
    logId = created.id;

    const pdfLines: string[] = [];
    pdfLines.push(`宛先: ${partner.name}`);
    pdfLines.push(`現場: ${siteLabel}`);
    if (site.address) pdfLines.push(`住所: ${site.address}`);
    if (site.phone) pdfLines.push(`電話: ${site.phone}`);
    if (site.contactName) pdfLines.push(`担当: ${site.contactName}`);

    const { bytes, filename, contentType } = await generateSimplePdf({
      kind,
      title: kind === 'report' ? '報告書' : '請求書',
      subtitle: 'Master Hub',
      lines: pdfLines,
    });

    const base64 = Buffer.from(bytes).toString('base64');

    await sendGraphMail({
      fromUser,
      to: [toEmail],
      subject,
      bodyText: bodyLines.join('\n'),
      attachments: [
        {
          name: filename,
          contentType,
          contentBytesBase64: base64,
        },
      ],
    });

    await prisma.outlookSendLog.update({
      where: { id: logId },
      data: { status: 'SENT', error: null },
      select: { id: true },
    });

    return Response.json({ ok: true, logId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Send failed';

    if (logId) {
      try {
        await prisma.outlookSendLog.update({
          where: { id: logId },
          data: { status: 'FAILED', error: msg.slice(0, 2000) },
          select: { id: true },
        });
      } catch {
        // ignore
      }
    }

    return Response.json({ ok: false, error: msg }, { status: 503 });
  }
}
