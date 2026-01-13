import { prisma } from '@/server/db/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toYmdMonth(d: Date) {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function formatLocal(dt: Date) {
  // Keep it simple & readable (local time).
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return `${yy}-${mm}-${dd} ${hh}:${mi}`;
}

function siteLabel(site: { companyName: string | null; name: string }) {
  return `${site.companyName ? `${site.companyName} ` : ''}${site.name}`.trim();
}

function Badge(props: { count: number }) {
  return (
    <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white/60 px-2 py-0.5 text-xs tabular-nums text-zinc-700 dark:border-zinc-800 dark:bg-black/60 dark:text-zinc-200">
      {props.count}
    </span>
  );
}

export default async function AlertsPage() {
  const now = new Date();
  const month = toYmdMonth(now);
  const since = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
  const until = startOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 1));

  const [sites, grouped, invoiceFailed, reportFailed] = await Promise.all([
    prisma.site.findMany({
      orderBy: [{ companyName: 'asc' }, { name: 'asc' }],
      take: 2000,
      select: { id: true, companyName: true, name: true, depreciationThreshold: true, alertsEnabled: true },
    }),
    prisma.workEntry.groupBy({
      by: ['siteId'],
      where: {
        siteId: { not: null },
        startAt: { gte: since, lt: until },
      },
      _count: { _all: true },
    }),
    prisma.outlookSendLog.findMany({
      where: {
        kind: 'INVOICE',
        status: 'FAILED',
        createdAt: { gte: since, lt: until },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        site: { select: { companyName: true, name: true } },
        partner: { select: { name: true, email: true } },
      },
    }),
    prisma.outlookSendLog.findMany({
      where: {
        kind: 'REPORT',
        status: 'FAILED',
        createdAt: { gte: since, lt: until },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        site: { select: { companyName: true, name: true } },
        partner: { select: { name: true, email: true } },
      },
    }),
  ]);

  const counts: Record<string, number> = {};
  for (const g of grouped) {
    if (!g.siteId) continue;
    counts[g.siteId] = g._count._all;
  }

  const deprAlerts = sites
    .map((s) => {
      const count = counts[s.id] ?? 0;
      const threshold = s.depreciationThreshold ?? 10;
      const alertsEnabled = s.alertsEnabled ?? true;
      return {
        siteId: s.id,
        label: siteLabel(s),
        count,
        threshold,
        alert: alertsEnabled ? count >= threshold : false,
      };
    })
    .filter((x) => x.alert)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const invoiceFailedCount = invoiceFailed.length;
  const reportFailedCount = reportFailed.length;
  const deprAlertCount = deprAlerts.length;

  return (
    <main className="mx-auto w-full max-w-screen-2xl px-4 py-6 lg:px-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-lg font-semibold tracking-tight">アラート</h1>
        <div className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{month}（当月）</div>
      </div>

      <div className="mt-4 grid gap-3">
        <section
          data-color-edit-slot="border"
          className="rounded-lg border border-zinc-200 bg-white/60 p-4 dark:border-zinc-800 dark:bg-black/60"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">現場配置</div>
            <Badge count={deprAlertCount} />
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">月回数（入力件数）が閾値以上の現場</div>

          {deprAlerts.length === 0 ? (
            <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">アラートはありません。</div>
          ) : (
            <div className="mt-3 grid gap-1">
              {deprAlerts.slice(0, 200).map((it) => (
                <div
                  key={it.siteId}
                  data-color-edit-slot="border"
                  className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-black/60"
                >
                  <div className="min-w-0 flex-1 truncate" title={it.label}>
                    {it.label}
                  </div>
                  <div className="shrink-0 text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
                    {it.count} / {it.threshold}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section
          data-color-edit-slot="border"
          className="rounded-lg border border-zinc-200 bg-white/60 p-4 dark:border-zinc-800 dark:bg-black/60"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">請求書</div>
            <Badge count={invoiceFailedCount} />
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Outlook送信失敗ログ（当月）</div>

          {invoiceFailed.length === 0 ? (
            <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">失敗ログはありません。</div>
          ) : (
            <div className="mt-3 grid gap-1">
              {invoiceFailed.map((r) => (
                <div
                  key={r.id}
                  data-color-edit-slot="border"
                  className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-black/60"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0 flex-1 truncate" title={siteLabel(r.site)}>
                      {siteLabel(r.site)}
                      <span className="text-zinc-500 dark:text-zinc-400"> / {r.partner.name}</span>
                    </div>
                    <div className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      {formatLocal(r.createdAt)}
                    </div>
                  </div>
                  <div className="mt-1 truncate text-xs text-zinc-600 dark:text-zinc-300" title={r.subject}>
                    {r.subject}
                  </div>
                  {r.error ? (
                    <div className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400" title={r.error}>
                      {r.error}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <section
          data-color-edit-slot="border"
          className="rounded-lg border border-zinc-200 bg-white/60 p-4 dark:border-zinc-800 dark:bg-black/60"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">報告書</div>
            <Badge count={reportFailedCount} />
          </div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Outlook送信失敗ログ（当月）</div>

          {reportFailed.length === 0 ? (
            <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">失敗ログはありません。</div>
          ) : (
            <div className="mt-3 grid gap-1">
              {reportFailed.map((r) => (
                <div
                  key={r.id}
                  data-color-edit-slot="border"
                  className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-black/60"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0 flex-1 truncate" title={siteLabel(r.site)}>
                      {siteLabel(r.site)}
                      <span className="text-zinc-500 dark:text-zinc-400"> / {r.partner.name}</span>
                    </div>
                    <div className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      {formatLocal(r.createdAt)}
                    </div>
                  </div>
                  <div className="mt-1 truncate text-xs text-zinc-600 dark:text-zinc-300" title={r.subject}>
                    {r.subject}
                  </div>
                  {r.error ? (
                    <div className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400" title={r.error}>
                      {r.error}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
