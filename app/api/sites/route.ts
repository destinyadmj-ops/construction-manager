import { prisma } from '@/server/db/prisma';
import { Prisma } from '@/generated/prisma';
import { requireScheduleEditor } from '@/server/auth/schedule-edit';
import {
  backfillSiteCompanyName,
  ensurePartnerByName,
  findMatchingSite,
  normalizeOptionalRegistryText,
  normalizeRegistryText,
} from '@/server/site-registry';
import { expectedCountForMonth, formatPaceText, parseRepeatRule } from '@/shared/pace';
import { z } from 'zod';

export const runtime = 'nodejs';

const SiteLabelColorSchema = z.enum(['default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink']);

const RepeatRuleSchema = z
  .object({
    intervalMonths: z.number().int().min(1).max(12),
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional().nullable(),
    monthDays: z.array(z.number().int().min(1).max(31)).max(31).optional().nullable(),
    monthsOfYear: z.array(z.number().int().min(1).max(12)).max(12).optional().nullable(),
  })
  .strict();

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
    repeatRule: RepeatRuleSchema.optional().nullable(),
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
    repeatRule: RepeatRuleSchema.optional().nullable(),
    kind: z.enum(['NORMAL', 'DAILY']).optional(),
  })
  .strict();

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
        pace: true,
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
      const paceExpectedThisMonth = expectedCountForMonth({
        rule: s.repeatRule,
        pace: s.pace,
        monthStart: start,
        monthEnd: end,
        anchorDate: s.createdAt,
      });
      const paceActualThisMonth = workCountMap.get(s.id) ?? 0;
      const invoiceIssuedThisMonth = issuedSet.has(`${s.id}:INVOICE`);
      const reportIssuedThisMonth = issuedSet.has(`${s.id}:REPORT`);
      const paceNotConsumedAlert =
        s.alertsEnabled && paceExpectedThisMonth > 0 && paceActualThisMonth < paceExpectedThisMonth;
      const unassignedThisMonth = s.alertsEnabled && paceExpectedThisMonth > 0 && paceActualThisMonth === 0;

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
  const authError = await requireScheduleEditor(request);
  if (authError) return authError;

  const json = await request.json().catch(() => null);

  const asUpdate = UpdateSchema.safeParse(json ?? {});
  if (asUpdate.success) {
    const companyName =
      typeof asUpdate.data.companyName === 'string'
        ? normalizeOptionalRegistryText(asUpdate.data.companyName)
        : asUpdate.data.companyName;

    const address =
      typeof asUpdate.data.address === 'string' ? asUpdate.data.address.trim() || null : asUpdate.data.address;
    const contactName =
      typeof asUpdate.data.contactName === 'string'
        ? asUpdate.data.contactName.trim() || null
        : asUpdate.data.contactName;
    const pace = typeof asUpdate.data.pace === 'string' ? formatPaceText(asUpdate.data.pace) || null : asUpdate.data.pace;
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
    const normalizedName = typeof asUpdate.data.name === 'string' ? normalizeRegistryText(asUpdate.data.name) : undefined;
    const repeatRule = asUpdate.data.repeatRule !== undefined ? parseRepeatRule(asUpdate.data.repeatRule) : undefined;

    const scheduleLabelColor = asUpdate.data.scheduleLabelColor;

    const data: Prisma.SiteUpdateInput = {};
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
    if (asUpdate.data.repeatRule !== undefined) {
      data.repeatRule =
        asUpdate.data.repeatRule === null ? Prisma.DbNull : ((repeatRule ?? parseRepeatRule(null)) as Prisma.InputJsonValue);
    }
    if (asUpdate.data.kind) data.kind = asUpdate.data.kind;

    try {
      const current = await prisma.site.findUnique({
        where: { id: asUpdate.data.id },
        select: { id: true, name: true, companyName: true, kind: true },
      });
      if (!current) {
        return Response.json({ ok: false, error: 'Site not found' }, { status: 404 });
      }

      const nextName = normalizedName ?? current.name;
      const nextCompanyName = asUpdate.data.companyName !== undefined ? companyName ?? null : current.companyName;
      const nextKind = asUpdate.data.kind ?? current.kind;

      const duplicate = await findMatchingSite({
        companyName: nextCompanyName,
        name: nextName,
        kind: nextKind,
        excludeId: asUpdate.data.id,
      });
      if (duplicate.site) {
        return Response.json(
          { ok: false, error: 'Duplicate site exists', site: duplicate.site, matchType: duplicate.matchType },
          { status: 409 },
        );
      }

      const updated = await prisma.site.update({
        where: { id: asUpdate.data.id },
        data,
        select: { id: true },
      });

      if (nextCompanyName) {
        await ensurePartnerByName(nextCompanyName);
      }

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

  const companyName = normalizeOptionalRegistryText(asCreate.data.companyName);
  const name = normalizeRegistryText(asCreate.data.name);
  const address = asCreate.data.address?.trim() || null;
  const contactName = asCreate.data.contactName?.trim() || null;
  const pace = formatPaceText(asCreate.data.pace) || null;
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
  const repeatRule = asCreate.data.repeatRule ? parseRepeatRule(asCreate.data.repeatRule) : null;
  const kind = asCreate.data.kind ?? 'NORMAL';
  try {
    const duplicate = await findMatchingSite({ companyName, name, kind });
    if (duplicate.site) {
      await backfillSiteCompanyName(duplicate.site.id, companyName);
      if (companyName) {
        await ensurePartnerByName(companyName);
      }
      return Response.json({
        ok: true,
        site: { id: duplicate.site.id },
        created: false,
        duplicate: true,
        matchType: duplicate.matchType,
      });
    }

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
        ...(repeatRule ? { repeatRule: repeatRule as Prisma.InputJsonValue } : {}),
        kind,
      },
      select: { id: true },
    });

    if (companyName) {
      await ensurePartnerByName(companyName);
    }

    return Response.json({ ok: true, site: created, created: true });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'Create failed' },
      { status: 503 },
    );
  }
}
