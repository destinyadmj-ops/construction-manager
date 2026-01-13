import { prisma } from '@/server/db/prisma';
import { z } from 'zod';

export const runtime = 'nodejs';

const SiteLabelColorSchema = z.enum(['default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink']);

type RepeatRule = {
  intervalMonths: number;
  weekdays: number[];
  monthDays: number[];
};

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

function parseRepeatRule(x: unknown): RepeatRule {
  const base: RepeatRule = { intervalMonths: 1, weekdays: [], monthDays: [] };
  if (!x || typeof x !== 'object') return base;
  const o = x as Record<string, unknown>;
  const intervalMonths = typeof o.intervalMonths === 'number' ? o.intervalMonths : 1;
  const weekdays = Array.isArray(o.weekdays) ? o.weekdays.filter((n) => typeof n === 'number') : [];
  const monthDays = Array.isArray(o.monthDays) ? o.monthDays.filter((n) => typeof n === 'number') : [];
  return {
    intervalMonths: Math.min(12, Math.max(1, intervalMonths || 1)),
    weekdays: weekdays.map((n) => Math.min(7, Math.max(1, n))).sort((a, b) => a - b),
    monthDays: monthDays.map((n) => Math.min(31, Math.max(1, n))).sort((a, b) => a - b),
  };
}

function expectedCountForMonth(rule: unknown, monthStart: Date, monthEnd: Date): number {
  const r = parseRepeatRule(rule);
  const weekdaySet = new Set<number>(r.weekdays);
  const monthDaySet = new Set<number>(r.monthDays);
  if (weekdaySet.size === 0 && monthDaySet.size === 0) return 0;

  const seen = new Set<number>();
  const cur = new Date(monthStart);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(monthEnd);
  end.setHours(0, 0, 0, 0);
  while (cur < end) {
    const day = cur.getDate();
    const jsDow = cur.getDay(); // 0=Sun
    const dow = jsDow === 0 ? 7 : jsDow; // 1=Mon ... 7=Sun
    if (monthDaySet.has(day) || weekdaySet.has(dow)) {
      seen.add(cur.getTime());
    }
    cur.setDate(cur.getDate() + 1);
  }
  return seen.size;
}

const CreateSchema = z
  .object({
    companyName: z.string().optional().nullable(),
    name: z.string().min(1).max(200),
    address: z.string().max(500).optional().nullable(),
    contactName: z.string().max(200).optional().nullable(),
    pace: z.string().max(200).optional().nullable(),
    amount: z.union([z.string(), z.number()]).optional().nullable(),
    detail: z.string().max(5000).optional().nullable(),
    peopleCount: z.number().int().min(0).max(999999).optional().nullable(),
    caution: z.string().max(5000).optional().nullable(),
    scheduleLabelColor: SiteLabelColorSchema.optional(),
    depreciationThreshold: z.number().int().min(1).max(999).optional(),
    alertsEnabled: z.boolean().optional(),
    kind: z.enum(['NORMAL', 'DAILY']).optional(),
  })
  .strict();

const UpdateSchema = z
  .object({
    id: z.string().min(1),
    companyName: z.string().optional().nullable(),
    name: z.string().min(1).max(200).optional(),
    address: z.string().max(500).optional().nullable(),
    contactName: z.string().max(200).optional().nullable(),
    pace: z.string().max(200).optional().nullable(),
    amount: z.union([z.string(), z.number()]).optional().nullable(),
    detail: z.string().max(5000).optional().nullable(),
    peopleCount: z.number().int().min(0).max(999999).optional().nullable(),
    caution: z.string().max(5000).optional().nullable(),
    scheduleLabelColor: SiteLabelColorSchema.optional(),
    depreciationThreshold: z.number().int().min(1).max(999).optional(),
    alertsEnabled: z.boolean().optional(),
    kind: z.enum(['NORMAL', 'DAILY']).optional(),
  })
  .strict();

function isAuthorized(request: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return process.env.NODE_ENV !== 'production';
  return request.headers.get('x-admin-token') === token;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const kindParam = (url.searchParams.get('kind') ?? '').trim().toLowerCase();
    const kind = kindParam === 'daily' ? 'DAILY' : kindParam === 'normal' ? 'NORMAL' : null;

    const monthRange = parseMonthParam(url.searchParams.get('month'));

    const sites = await prisma.site.findMany({
      where: kind ? { kind } : undefined,
      orderBy: [{ companyName: 'asc' }, { name: 'asc' }],
      take: 1000,
      select: {
        id: true,
        companyName: true,
        name: true,
        kind: true,
        repeatRule: true,
        caution: true,
        contactName: true,
        scheduleLabelColor: true,
        createdAt: true,
        depreciationThreshold: true,
        alertsEnabled: true,
        updatedAt: true,
      },
    });

    if (!monthRange || sites.length === 0) {
      return Response.json({ ok: true, sites });
    }

    const siteIds = sites.map((s) => s.id);
    const { start, end, key } = monthRange;

    const workCounts = await prisma.workEntry.groupBy({
      by: ['siteId'],
      where: { siteId: { in: siteIds }, startAt: { gte: start, lt: end } },
      _count: { _all: true },
    });
    const workCountMap = new Map<string, number>();
    for (const row of workCounts) {
      if (row.siteId) workCountMap.set(row.siteId, row._count._all);
    }

    const docs = await prisma.storedDocument.findMany({
      where: {
        siteId: { in: siteIds },
        createdAt: { gte: start, lt: end },
        kind: { in: ['INVOICE', 'REPORT'] },
      },
      select: { siteId: true, kind: true },
      distinct: ['siteId', 'kind'],
    });
    const issuedSet = new Set<string>();
    for (const d of docs) {
      if (d.siteId) issuedSet.add(`${d.siteId}:${d.kind}`);
    }

    const sentLogs = await prisma.outlookSendLog.findMany({
      where: {
        siteId: { in: siteIds },
        createdAt: { gte: start, lt: end },
        status: 'SENT',
        kind: { in: ['INVOICE', 'REPORT'] },
      },
      select: { siteId: true, kind: true },
      distinct: ['siteId', 'kind'],
    });
    for (const l of sentLogs) {
      issuedSet.add(`${l.siteId}:${l.kind}`);
    }

    const sitesWithAlerts = sites.map((s) => {
      const paceExpectedThisMonth = expectedCountForMonth(s.repeatRule, start, end);
      const paceActualThisMonth = workCountMap.get(s.id) ?? 0;
      const invoiceIssuedThisMonth = issuedSet.has(`${s.id}:INVOICE`);
      const reportIssuedThisMonth = issuedSet.has(`${s.id}:REPORT`);
      const paceNotConsumedAlert =
        s.alertsEnabled && paceExpectedThisMonth > 0 && paceActualThisMonth < paceExpectedThisMonth;
      const unassignedThisMonth = s.alertsEnabled && paceActualThisMonth === 0;

      return {
        ...s,
        month: key,
        invoiceIssuedThisMonth,
        reportIssuedThisMonth,
        workCountThisMonth: paceActualThisMonth,
        paceExpectedThisMonth,
        paceActualThisMonth,
        paceNotConsumedAlert,
        unassignedThisMonth,
      };
    });

    return Response.json({ ok: true, sites: sitesWithAlerts });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}

// Minimal helper for creating sites without Prisma Studio.
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const json = await request.json().catch(() => null);

  const asUpdate = UpdateSchema.safeParse(json ?? {});
  if (asUpdate.success) {
    const companyName =
      typeof asUpdate.data.companyName === 'string'
        ? asUpdate.data.companyName.trim() || null
        : asUpdate.data.companyName;

    const address =
      typeof asUpdate.data.address === 'string' ? asUpdate.data.address.trim() || null : asUpdate.data.address;
    const contactName =
      typeof asUpdate.data.contactName === 'string'
        ? asUpdate.data.contactName.trim() || null
        : asUpdate.data.contactName;
    const pace = typeof asUpdate.data.pace === 'string' ? asUpdate.data.pace.trim() || null : asUpdate.data.pace;
    const amount =
      typeof asUpdate.data.amount === 'string'
        ? asUpdate.data.amount.trim() || null
        : typeof asUpdate.data.amount === 'number'
          ? asUpdate.data.amount
          : asUpdate.data.amount;
    const detail =
      typeof asUpdate.data.detail === 'string' ? asUpdate.data.detail.trim() || null : asUpdate.data.detail;
    const caution =
      typeof asUpdate.data.caution === 'string' ? asUpdate.data.caution.trim() || null : asUpdate.data.caution;

    const scheduleLabelColor = asUpdate.data.scheduleLabelColor;

    const data: {
      companyName?: string | null;
      name?: string;
      address?: string | null;
      contactName?: string | null;
      pace?: string | null;
      amount?: string | number | null;
      detail?: string | null;
      peopleCount?: number | null;
      caution?: string | null;
      scheduleLabelColor?: string;
      depreciationThreshold?: number;
      alertsEnabled?: boolean;
      kind?: 'NORMAL' | 'DAILY';
    } = {};
    if (asUpdate.data.companyName !== undefined) data.companyName = companyName ?? null;
    if (typeof asUpdate.data.name === 'string') data.name = asUpdate.data.name.trim();
    if (asUpdate.data.address !== undefined) data.address = address ?? null;
    if (asUpdate.data.contactName !== undefined) data.contactName = contactName ?? null;
    if (asUpdate.data.pace !== undefined) data.pace = pace ?? null;
    if (asUpdate.data.amount !== undefined) data.amount = (amount as string | number | null) ?? null;
    if (asUpdate.data.detail !== undefined) data.detail = detail ?? null;
    if (asUpdate.data.peopleCount !== undefined) data.peopleCount = asUpdate.data.peopleCount ?? null;
    if (asUpdate.data.caution !== undefined) data.caution = caution ?? null;
    if (scheduleLabelColor !== undefined) data.scheduleLabelColor = scheduleLabelColor;
    if (typeof asUpdate.data.depreciationThreshold === 'number') {
      data.depreciationThreshold = asUpdate.data.depreciationThreshold;
    }
    if (typeof asUpdate.data.alertsEnabled === 'boolean') {
      data.alertsEnabled = asUpdate.data.alertsEnabled;
    }
    if (asUpdate.data.kind) data.kind = asUpdate.data.kind;

    try {
      const updated = await prisma.site.update({
        where: { id: asUpdate.data.id },
        data,
        select: { id: true },
      });
      return Response.json({ ok: true, site: updated });
    } catch (e) {
      return Response.json(
        { ok: false, error: e instanceof Error ? e.message : 'Update failed' },
        { status: 503 },
      );
    }
  }

  const asCreate = CreateSchema.safeParse(json ?? {});
  if (!asCreate.success) {
    return Response.json(
      { ok: false, error: 'Invalid body', issues: asCreate.error.issues },
      { status: 400 },
    );
  }

  const companyName = asCreate.data.companyName?.trim() || null;
  const name = asCreate.data.name.trim();
  const address = asCreate.data.address?.trim() || null;
  const contactName = asCreate.data.contactName?.trim() || null;
  const pace = asCreate.data.pace?.trim() || null;
  const amount =
    typeof asCreate.data.amount === 'string'
      ? asCreate.data.amount.trim() || null
      : typeof asCreate.data.amount === 'number'
        ? asCreate.data.amount
        : null;
  const detail = asCreate.data.detail?.trim() || null;
  const peopleCount = typeof asCreate.data.peopleCount === 'number' ? asCreate.data.peopleCount : null;
  const caution = asCreate.data.caution?.trim() || null;
  const scheduleLabelColor = asCreate.data.scheduleLabelColor ?? 'default';
  try {
    const created = await prisma.site.create({
      data: {
        companyName,
        name,
        address,
        contactName,
        pace,
        amount: (amount as string | number | null) ?? null,
        detail,
        peopleCount,
        caution,
        scheduleLabelColor,
        depreciationThreshold: asCreate.data.depreciationThreshold ?? 10,
          alertsEnabled: typeof asCreate.data.alertsEnabled === 'boolean' ? asCreate.data.alertsEnabled : true,
        kind: asCreate.data.kind ?? 'NORMAL',
      },
      select: { id: true },
    });

    return Response.json({ ok: true, site: created });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Create failed' },
      { status: 503 },
    );
  }
}
