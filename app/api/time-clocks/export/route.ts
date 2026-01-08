import { prisma } from '@/server/db/prisma';
import { z } from 'zod';

export const runtime = 'nodejs';

const ColumnSchema = z.enum(['date', 'site', 'user', 'start', 'end']);

const QuerySchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    userIds: z.string().optional(),
    columns: z.string().optional(),
    siteId: z.string().min(1).optional(),
  })
  .strict();

function startOfDayTokyo(ymd: string) {
  const [y, m, d] = ymd.split('-').map((x) => Number(x));
  return new Date(Date.UTC(y, m - 1, d, -9, 0, 0));
}

function fmtTokyo(dt: Date, withTime: boolean) {
  try {
    const opt: Intl.DateTimeFormatOptions = withTime
      ? {
          timeZone: 'Asia/Tokyo',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }
      : { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' };
    return new Intl.DateTimeFormat('sv-SE', opt).format(dt);
  } catch {
    return withTime ? dt.toISOString() : dt.toISOString().slice(0, 10);
  }
}

function csvEscape(v: string) {
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = {
    from: (url.searchParams.get('from') ?? '').trim(),
    to: (url.searchParams.get('to') ?? '').trim(),
    userIds: (url.searchParams.get('userIds') ?? '').trim() || undefined,
    columns: (url.searchParams.get('columns') ?? '').trim() || undefined,
    siteId: (url.searchParams.get('siteId') ?? '').trim() || undefined,
  };

  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid query', issues: parsed.error.issues }, { status: 400 });
  }

  const fromYmd = parsed.data.from;
  const toYmd = parsed.data.to;
  const from = startOfDayTokyo(fromYmd);
  const toNext = new Date(startOfDayTokyo(toYmd).getTime() + 24 * 60 * 60 * 1000);

  const userIdList = parsed.data.userIds
    ? Array.from(new Set(parsed.data.userIds.split(',').map((s) => s.trim()).filter(Boolean))).slice(0, 200)
    : null;

  const siteId = parsed.data.siteId;
  const siteWhere = !siteId ? null : siteId === '__none__' ? ({ siteId: null } as const) : ({ siteId } as const);

  const cols = (() => {
    if (!parsed.data.columns) return ['date', 'site', 'user', 'start', 'end'] as const;
    const xs = parsed.data.columns
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20);
    const validated: Array<z.infer<typeof ColumnSchema>> = [];
    for (const x of xs) {
      const v = ColumnSchema.safeParse(x);
      if (v.success && !validated.includes(v.data)) validated.push(v.data);
    }
    return (validated.length ? validated : (['date', 'site', 'user', 'start', 'end'] as const)) as Array<
      z.infer<typeof ColumnSchema>
    >;
  })();

  try {
    const rows = await prisma.timeClock.findMany({
      where: {
        inAt: { gte: from, lt: toNext },
        ...(userIdList ? { userId: { in: userIdList } } : {}),
        ...(siteWhere ? siteWhere : {}),
        user: { kind: 'DAILY' },
      },
      orderBy: [{ inAt: 'asc' }],
      select: {
        inAt: true,
        outAt: true,
        user: { select: { id: true, name: true, email: true } },
        site: { select: { id: true, name: true, companyName: true } },
      },
      take: 50000,
    });

    const headerMap: Record<z.infer<typeof ColumnSchema>, string> = {
      date: '日付',
      site: '現場',
      user: '従業員名',
      start: '開始',
      end: '終了',
    };

    const header = cols.map((c) => headerMap[c]).map(csvEscape).join(',');

    const lines = [header];
    for (const r of rows) {
      const userLabel = r.user.name ?? r.user.email ?? r.user.id;
      const siteLabel = r.site ? `${r.site.companyName ? `${r.site.companyName} / ` : ''}${r.site.name}` : '';
      const date = fmtTokyo(r.inAt, false);
      const start = fmtTokyo(r.inAt, true);
      const end = r.outAt ? fmtTokyo(r.outAt, true) : '';

      const row: Record<z.infer<typeof ColumnSchema>, string> = {
        date,
        site: siteLabel,
        user: userLabel,
        start,
        end,
      };

      lines.push(cols.map((c) => csvEscape(row[c] ?? '')).join(','));
    }

    const csv = `\ufeff${lines.join('\r\n')}\r\n`;

    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="daily_timeclocks_${fromYmd}_to_${toYmd}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : 'DB unavailable' },
      { status: 503 },
    );
  }
}
