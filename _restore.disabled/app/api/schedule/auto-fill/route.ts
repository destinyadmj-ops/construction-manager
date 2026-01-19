import { prisma } from '@/server/db/prisma';
import { z } from 'zod';

export const runtime = 'nodejs';

const BodySchema = z
  .object({
    userId: z.string().min(1),
    siteId: z.string().min(1),
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    days: z
      .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .max(62)
      .optional(),
  })
  .strict();

function startOfDayLocal(ymd: string) {
  const d = new Date(`${ymd}T00:00:00`);
  d.setHours(0, 0, 0, 0);
  return d;
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function toYmd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function getWeekdayMon1Sun7(d: Date): number {
  const dow0Sun = d.getDay();
  return dow0Sun === 0 ? 7 : dow0Sun;
}

function monthIndex(yy: number, mm1to12: number) {
  return yy * 12 + (mm1to12 - 1);
}

export async function POST(request: Request) {
  try {
    const json = await request.json().catch(() => null);
    const parsed = BodySchema.safeParse(json ?? {});
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: 'Invalid body', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const { userId, siteId, month, days } = parsed.data;

    if ((!month || month.length === 0) && (!days || days.length === 0)) {
      return Response.json({ ok: false, error: 'month or days is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return Response.json({ ok: false, error: 'User not found' }, { status: 404 });

    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, name: true, repeatRule: true, createdAt: true },
    });
    if (!site) return Response.json({ ok: false, error: 'Site not found' }, { status: 404 });

    const normalizedDays = Array.isArray(days) ? Array.from(new Set(days)).sort() : null;
    const monthToUse = month ?? (normalizedDays ? normalizedDays[0]!.slice(0, 7) : null);
    if (!monthToUse) {
      return Response.json({ ok: false, error: 'month or days is required' }, { status: 400 });
    }

    const [yy, mm] = monthToUse.split('-').map((x) => Number(x));
    const monthStart = new Date(yy, mm - 1, 1, 0, 0, 0, 0);
    const nextMonth = new Date(yy, mm, 1, 0, 0, 0, 0);

    const rr = (site.repeatRule ?? null) as
      | {
          intervalMonths?: number;
          weekdays?: number[];
          monthDays?: number[];
        }
      | null;

    const intervalMonthsRaw = typeof rr?.intervalMonths === 'number' ? rr!.intervalMonths : 1;
    const intervalMonths =
      Number.isFinite(intervalMonthsRaw) && intervalMonthsRaw >= 1 ? intervalMonthsRaw : 1;

    const weekdays = Array.isArray(rr?.weekdays) ? rr!.weekdays : [];
    const monthDays = Array.isArray(rr?.monthDays) ? rr!.monthDays : [];

  // Apply intervalMonths using the Site.createdAt month as an anchor.
  // Example: createdAt in Dec (diff=0) with intervalMonths=2 => Dec/Feb/... are active; Jan is not.
    const anchor = new Date(site.createdAt);
    const diff = monthIndex(yy, mm) - monthIndex(anchor.getFullYear(), anchor.getMonth() + 1);
    if (intervalMonths > 1 && ((diff % intervalMonths) + intervalMonths) % intervalMonths !== 0) {
      return Response.json({
        ok: true,
        created: 0,
        skipped: 0,
        reason: 'ペース対象外の月です',
      });
    }

    if (weekdays.length === 0 && monthDays.length === 0) {
      return Response.json({ ok: true, created: 0, skipped: 0, reason: 'リピート条件が未設定です' });
    }

    const existingRange = normalizedDays
      ? {
          gte: startOfDayLocal(normalizedDays[0]!),
          lt: (() => {
            const last = startOfDayLocal(normalizedDays[normalizedDays.length - 1]!);
            last.setDate(last.getDate() + 1);
            return last;
          })(),
        }
      : { gte: monthStart, lt: nextMonth };

    const existing = await prisma.workEntry.findMany({
      where: {
        userId,
        siteId,
        startAt: existingRange,
      },
      select: { startAt: true },
    });

    const existingDays = new Set(existing.map((e) => toYmd(e.startAt)));

    const targets: string[] = [];
    if (normalizedDays) {
      for (const ymd of normalizedDays) {
        const d = startOfDayLocal(ymd);
        const dayNum = d.getDate();
        const weekday = getWeekdayMon1Sun7(d);
        const matches = monthDays.includes(dayNum) || weekdays.includes(weekday);
        if (matches) targets.push(ymd);
      }
    } else {
      for (let d = new Date(monthStart); d < nextMonth; d.setDate(d.getDate() + 1)) {
        const dayNum = d.getDate();
        const weekday = getWeekdayMon1Sun7(d);
        const matches = monthDays.includes(dayNum) || weekdays.includes(weekday);
        if (matches) targets.push(toYmd(d));
      }
    }

    const toCreate = targets.filter((ymd) => !existingDays.has(ymd));

    if (toCreate.length === 0) {
      return Response.json({ ok: true, created: 0, skipped: targets.length });
    }

    await prisma.workEntry.createMany({
      data: toCreate.map((ymd) => ({
        userId,
        siteId,
        startAt: startOfDayLocal(ymd),
        summary: site.name,
        accountingMeta: { siteName: site.name },
      })),
    });

    return Response.json({ ok: true, created: toCreate.length, skipped: targets.length - toCreate.length });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}
