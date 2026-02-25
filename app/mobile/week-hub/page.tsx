'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';

type ApiUser = { id: string; name: string | null; email: string | null };

type ApiCell = {
  // Up to 2 slots. Each slot is a short label.
  slot1: string | null;
  slot2: string | null;
  // Optional hint color: 'red' means attention.
  color1: 'default' | 'red';
  color2: 'default' | 'red';
};

type ApiResponse = {
  ok: true;
  weekStart: string;
  users: ApiUser[];
  grid: Record<string, Record<string, ApiCell>>; // userId -> day(yyyy-mm-dd) -> cell
};

type SiteItem = {
  id: string | null;
  label: string;
  invoiceIssuedThisMonth?: boolean;
  reportIssuedThisMonth?: boolean;
  paceNotConsumedAlert?: boolean;
  unassignedThisMonth?: boolean;
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function toYmd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfWeekMonday(input: Date) {
  const d = new Date(input);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(input: Date, days: number) {
  const d = new Date(input);
  d.setDate(d.getDate() + days);
  return d;
}

const DOW = ['月', '火', '水', '木', '金', '土', '日'] as const;

export default function MobileWeekHub() {
  return (
    <Suspense fallback={null}>
      <MobileWeekHubInner />
    </Suspense>
  );
}

function MobileWeekHubInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qsUserId = searchParams.get('userId');
  const [cursorDate] = useState<Date>(() => new Date());
  const [sites, setSites] = useState<SiteItem[]>([]);

  const weekStart = useMemo(() => {
    return startOfWeekMonday(cursorDate);
  }, [cursorDate]);

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  const dayLabels = useMemo(() => {
    return days.map((d, i) => ({
      key: toYmd(d),
      dow: DOW[i],
      dayNum: d.getDate(),
      isSat: i === 5,
      isSun: i === 6,
    }));
  }, [days]);

  useEffect(() => {
    const controller = new AbortController();

    fetch('/api/sites', { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        const json = (await res.json()) as { ok: boolean; sites: SiteItem[] };
        if (!json.ok) throw new Error('Invalid response');
        setSites(json.sites || []);
      })
      .catch(() => {
        setSites([]);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/sites?month=2026-02&kind=normal', { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) return;
        const json = (await r.json()) as {
          ok: true;
          sites: Array<{
            id: string;
            companyName?: string | null;
            name: string;
          }>;
        };
        if (!json?.ok) return;
        setSites(json.sites.map((s) => ({
          id: s.id,
          label: s.companyName ? `${s.companyName} / ${s.name}` : s.name,
        })));
      })
      .catch(() => {
        // ignore
      });
    return () => controller.abort();
  }, []);

  const handleSiteClick = useCallback((siteId: string) => {
    router.push(`/site-ledger/${encodeURIComponent(siteId)}?kind=normal`);
  }, [router]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
      {/* 週予定ヘッダー */}
      <div className="sticky top-0 z-40 border-b border-zinc-200 bg-white px-4 py-4 shadow-sm dark:border-zinc-800 dark:bg-black">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">週予定</h1>
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            {toYmd(weekStart)}〜{toYmd(addDays(weekStart, 6))}
          </div>
        </div>

        {/* 簡易週予定表示 */}
        <div className="mt-4 overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {dayLabels.map((d) => (
              <div
                key={d.key}
                className={`flex-1 min-w-[60px] rounded-md border px-2 py-3 text-center text-sm ${
                  d.isSun
                    ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300'
                    : d.isSat
                      ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300'
                      : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black'
                }`}
              >
                <div className="text-xs text-zinc-500 dark:text-zinc-400">{d.dow}</div>
                <div className="font-medium">{d.dayNum}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 現場リスト */}
      <div className="p-4">
        <h2 className="text-base font-medium mb-4">現場リスト</h2>

        {sites.length === 0 ? (
          <div className="text-center py-8 text-zinc-500 dark:text-zinc-400">
            現場がありません
          </div>
        ) : (
          <div className="space-y-3">
            {sites.map((site) => (
              <button
                key={site.id}
                onClick={() => site.id && handleSiteClick(site.id)}
                className="w-full rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
              >
                <div className="font-medium">{site.label}</div>
                <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  タップして詳細を表示
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}