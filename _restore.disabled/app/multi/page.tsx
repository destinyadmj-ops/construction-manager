'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type Summary = {
  month: string;
  totals: { sales: number; expense: number; labor: number; net: number };
  dailySales: Array<{ day: string; value: number }>;
};

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function fmtYen(n: number) {
  try {
    return new Intl.NumberFormat('ja-JP', {
      style: 'currency',
      currency: 'JPY',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${Math.round(n)}円`;
  }
}

export default function MultiPage() {
  const searchParams = useSearchParams();
  const tab = (searchParams.get('tab') ?? '').trim().toLowerCase();

  const [month, setMonth] = useState<string>(() => currentMonth());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  const maxDaily = useMemo(() => {
    const xs = summary?.dailySales ?? [];
    let m = 0;
    for (const x of xs) m = Math.max(m, x.value);
    return m;
  }, [summary]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`/api/accounting/summary?month=${encodeURIComponent(month)}`);
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        if (!r.ok || obj?.ok !== true) {
          throw new Error((obj?.error as string) || `HTTP ${r.status}`);
        }

        const totalsRaw = (obj?.totals ?? null) as unknown;
        const totalsObj = totalsRaw && typeof totalsRaw === 'object' ? (totalsRaw as Record<string, unknown>) : null;
        const dailyRaw = Array.isArray(obj?.dailySales) ? (obj!.dailySales as unknown[]) : [];
        const dailySales = dailyRaw
          .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null))
          .map((o) => ({
            day: typeof o?.day === 'string' ? o.day : '',
            value: typeof o?.value === 'number' ? o.value : 0,
          }))
          .filter((x) => x.day.length > 0);

        const s: Summary = {
          month: typeof obj?.month === 'string' ? (obj.month as string) : month,
          totals: {
            sales: typeof totalsObj?.sales === 'number' ? (totalsObj.sales as number) : 0,
            expense: typeof totalsObj?.expense === 'number' ? (totalsObj.expense as number) : 0,
            labor: typeof totalsObj?.labor === 'number' ? (totalsObj.labor as number) : 0,
            net: typeof totalsObj?.net === 'number' ? (totalsObj.net as number) : 0,
          },
          dailySales,
        };

        if (cancelled) return;
        setSummary(s);
      } catch (e) {
        if (cancelled) return;
        setSummary(null);
        setError(e instanceof Error ? e.message : '読み込みに失敗しました');
      } finally {
        if (cancelled) return;
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [month]);

  useEffect(() => {
    const id = tab === 'net' ? 'agg-net' : tab === 'sales' ? 'agg-sales' : tab === 'graph' ? 'agg-graph' : '';
    if (!id) return;
    const t = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'start' });
    }, 50);
    return () => window.clearTimeout(t);
  }, [tab, loading]);

  return (
    <main className="mx-auto max-w-5xl p-4">
      <div className="mb-4">
        <h1 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">集計</h1>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">グラフ / 収支 / 売上</div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-zinc-500 dark:text-zinc-400">対象月</label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] dark:border-zinc-800 dark:bg-black"
            />
          </div>
        </div>
        {error ? <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{error}</div> : null}
      </div>

      <div className="space-y-4">
        <section id="agg-graph" className="rounded-xl bg-white p-5 dark:bg-black">
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">グラフ（売上/日）</div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">売上（勘定: 売掛/売上）の日別合計</div>

          {loading ? (
            <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">読み込み中…</div>
          ) : !summary ? (
            <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">（データなし）</div>
          ) : summary.dailySales.length === 0 ? (
            <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">（売上データなし）</div>
          ) : (
            <div className="mt-3 flex h-24 items-end gap-1 overflow-x-auto rounded-md bg-zinc-50 p-2 dark:bg-zinc-900/40">
              {summary.dailySales.map((d) => {
                const h = maxDaily > 0 ? Math.max(2, Math.round((d.value / maxDaily) * 80)) : 2;
                return (
                  <div
                    key={d.day}
                    className="flex w-4 shrink-0 flex-col items-center justify-end gap-1"
                    title={`${d.day}: ${fmtYen(d.value)}`}
                  >
                    <div
                      className="w-full rounded-sm bg-zinc-400/80 dark:bg-zinc-600/80"
                      style={{ height: `${h}px` }}
                    />
                    <div className="text-[9px] text-zinc-500 dark:text-zinc-500">{d.day.slice(-2)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section id="agg-net" className="rounded-xl bg-white p-5 dark:bg-black">
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">収支</div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">売上 -（経費 + 人件費）</div>

          {loading ? (
            <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">読み込み中…</div>
          ) : !summary ? (
            <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">（データなし）</div>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-md bg-zinc-50 p-3 text-xs dark:bg-zinc-900/40">
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">売上</div>
                <div className="mt-1 tabular-nums">{fmtYen(summary.totals.sales)}</div>
              </div>
              <div className="rounded-md bg-zinc-50 p-3 text-xs dark:bg-zinc-900/40">
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">経費</div>
                <div className="mt-1 tabular-nums">{fmtYen(summary.totals.expense)}</div>
              </div>
              <div className="rounded-md bg-zinc-50 p-3 text-xs dark:bg-zinc-900/40">
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">人件費</div>
                <div className="mt-1 tabular-nums">{fmtYen(summary.totals.labor)}</div>
              </div>
              <div className="rounded-md bg-zinc-50 p-3 text-xs dark:bg-zinc-900/40">
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">収支</div>
                <div className="mt-1 tabular-nums">{fmtYen(summary.totals.net)}</div>
              </div>
            </div>
          )}
        </section>

        <section id="agg-sales" className="rounded-xl bg-white p-5 dark:bg-black">
          <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">売上</div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">月合計と日別一覧</div>

          {loading ? (
            <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">読み込み中…</div>
          ) : !summary ? (
            <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">（データなし）</div>
          ) : (
            <>
              <div className="mt-3 rounded-md bg-zinc-50 p-3 text-xs dark:bg-zinc-900/40">
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">月合計</div>
                <div className="mt-1 tabular-nums">{fmtYen(summary.totals.sales)}</div>
              </div>

              <div className="mt-3 max-h-64 overflow-auto rounded-md bg-zinc-50 p-2 text-[11px] dark:bg-zinc-900/40">
                {summary.dailySales.length === 0 ? (
                  <div className="text-zinc-500 dark:text-zinc-400">（売上データなし）</div>
                ) : (
                  summary.dailySales
                    .slice()
                    .reverse()
                    .map((d) => (
                      <div
                        key={d.day}
                        className="flex items-center justify-between gap-3 border-b border-zinc-200/60 py-1 last:border-b-0 dark:border-zinc-800/60"
                      >
                        <div className="tabular-nums text-zinc-600 dark:text-zinc-300">{d.day}</div>
                        <div className="tabular-nums text-zinc-800 dark:text-zinc-200">{fmtYen(d.value)}</div>
                      </div>
                    ))
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
