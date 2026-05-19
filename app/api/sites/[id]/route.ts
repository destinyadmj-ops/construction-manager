import { prisma } from '@/server/db/prisma';
import { canCurrentUserEditSchedule, isMobileRequest } from '@/server/auth/schedule-edit';
import { requireUserManager } from '@/server/auth/user-admin';
import { expectedCountForMonth } from '@/shared/pace';

export const runtime = 'nodejs';

function parseMonthParam(month: string | null): { start: Date; end: Date; key: string } | null {
  if (!month) return null;
  const m = month.trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  const [yStr, moStr] = m.split('-');
  const y = Number(yStr);
  const mo = Number(moStr);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return null;
  const start = new Date(y, mo - 1, 1);
  const end = new Date(y, mo, 1);
  return { start, end, key: m };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id) {
    return Response.json({ ok: false, error: 'Missing id' }, { status: 400 });
  }

  try {
    const url = new URL(request.url);
    const monthRange = parseMonthParam(url.searchParams.get('month'));
    const canViewAmount = isMobileRequest(request) || (await canCurrentUserEditSchedule(request));

    const site = await prisma.site.findUnique({
      where: { id },
      select: {
        id: true,
        companyName: true,
        name: true,
        address: true,
        contactName: true,
        pace: true,
        amount: true,
        detail: true,
        peopleCount: true,
        caution: true,
        scheduleLabelColor: true,
        depreciationThreshold: true,
        alertsEnabled: true,
        repeatRule: true,
        kind: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!site) {
      return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
    }

    let monthAlert:
      | {
          month: string;
          invoiceMissing: boolean;
          reportMissing: boolean;
          unassigned: boolean;
          paceExpectedThisMonth: number;
          paceActualThisMonth: number;
          paceNotConsumedAlert: boolean;
        }
      | null = null;

    if (monthRange) {
      const { start, end, key } = monthRange;

      const [workCount, docs, sentLogs] = await Promise.all([
        prisma.workEntry.count({
          where: { siteId: id, startAt: { gte: start, lt: end } },
        }),
        prisma.storedDocument.findMany({
          where: {
            siteId: id,
            createdAt: { gte: start, lt: end },
            kind: { in: ['INVOICE', 'REPORT'] },
          },
          select: { kind: true },
          distinct: ['kind'],
        }),
        prisma.outlookSendLog.findMany({
          where: {
            siteId: id,
            createdAt: { gte: start, lt: end },
            status: 'SENT',
            kind: { in: ['INVOICE', 'REPORT'] },
          },
          select: { kind: true },
          distinct: ['kind'],
        }),
      ]);

      const issuedKinds = new Set<string>();
      for (const doc of docs) issuedKinds.add(doc.kind);
      for (const log of sentLogs) issuedKinds.add(log.kind);

      const paceExpectedThisMonth = expectedCountForMonth({
        rule: site.repeatRule,
        pace: site.pace,
        monthStart: start,
        monthEnd: end,
        anchorDate: site.createdAt,
      });
      const paceActualThisMonth = workCount;
      const paceNotConsumedAlert =
        site.alertsEnabled && paceExpectedThisMonth > 0 && paceActualThisMonth < paceExpectedThisMonth;
      const unassigned = site.alertsEnabled && paceExpectedThisMonth > 0 && paceActualThisMonth === 0;

      monthAlert = {
        month: key,
        invoiceMissing: !issuedKinds.has('INVOICE'),
        reportMissing: !issuedKinds.has('REPORT'),
        unassigned,
        paceExpectedThisMonth,
        paceActualThisMonth,
        paceNotConsumedAlert,
      };
    }

    return Response.json({ ok: true, site: { ...site, amount: canViewAmount ? site.amount : null }, monthAlert });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const authError = await requireUserManager(request);
  if (authError) return authError;

  const { id } = await context.params;
  if (!id) {
    return Response.json({ ok: false, error: 'Missing id' }, { status: 400 });
  }

  try {
    await prisma.site.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Delete failed' },
      { status: 503 },
    );
  }
}
