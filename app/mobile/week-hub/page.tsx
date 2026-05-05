'use client';

import { useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';

type ScheduleKind = 'normal' | 'daily';

type AuthMeUser = {
  id: string;
  name: string | null;
  email: string | null;
  kind?: 'NORMAL' | 'DAILY' | null;
};

type ApiUser = {
  id: string;
  name: string | null;
  email: string | null;
};

type ApiCell = {
  slot1: string | null;
  slot2: string | null;
};

type ApiResponse = {
  ok: true;
  weekStart: string;
  days: string[];
  users: ApiUser[];
  grid: Record<string, Record<string, ApiCell>>;
};

type SiteItem = {
  id: string;
  companyName?: string | null;
  name: string;
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

function normalizeScheduleKind(kind: AuthMeUser['kind']): ScheduleKind {
  return kind === 'DAILY' ? 'daily' : 'normal';
}

function userLabel(user: ApiUser | AuthMeUser | null) {
  if (!user) return '未ログイン';
  return (user.name ?? user.email ?? user.id).trim();
}

function cellEntries(cell: ApiCell | null | undefined) {
  return [cell?.slot1 ?? null, cell?.slot2 ?? null]
    .map((entry) => (entry ?? '').trim())
    .filter((entry): entry is string => entry.length > 0);
}

function normalizeSiteLookupKey(value: string) {
  return value.replace(/\s\+\d+$/, '').trim();
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
  const [cursorDate] = useState<Date>(() => new Date());
  const [authUser, setAuthUser] = useState<AuthMeUser | null>(null);
  const [schedule, setSchedule] = useState<ApiResponse | null>(null);
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const weekStart = useMemo(() => {
    return startOfWeekMonday(cursorDate);
  }, [cursorDate]);

  const scheduleKind = useMemo(() => normalizeScheduleKind(authUser?.kind), [authUser?.kind]);

  const viewMonth = useMemo(() => `${weekStart.getFullYear()}-${pad2(weekStart.getMonth() + 1)}`, [weekStart]);

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
    fetch('/api/auth/me', { signal: controller.signal, cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        const json = (await res.json()) as { ok?: boolean; user?: AuthMeUser | null };
        if (json?.ok !== true) throw new Error('Invalid response');
        setAuthUser(json.user ?? null);
      })
      .catch(() => {
        setAuthUser(null);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    Promise.all([
      fetch(`/api/schedule/week?weekStart=${encodeURIComponent(toYmd(weekStart))}&kind=${encodeURIComponent(scheduleKind)}`, {
        signal: controller.signal,
        cache: 'no-store',
      }),
      fetch(`/api/sites?month=${encodeURIComponent(viewMonth)}&kind=${encodeURIComponent(scheduleKind)}`, {
        signal: controller.signal,
        cache: 'no-store',
      }),
    ])
      .then(async ([scheduleRes, sitesRes]) => {
        if (!scheduleRes.ok) throw new Error(`Failed to load schedule (${scheduleRes.status})`);
        const scheduleJson = (await scheduleRes.json()) as ApiResponse;
        const sitesJson = sitesRes.ok
          ? ((await sitesRes.json()) as { ok?: boolean; sites?: SiteItem[] })
          : null;
        setSchedule(scheduleJson);
        setSites(sitesJson?.ok === true && Array.isArray(sitesJson.sites) ? sitesJson.sites : []);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setSchedule(null);
        setSites([]);
        setError(cause instanceof Error ? cause.message : '予定の取得に失敗しました');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [scheduleKind, viewMonth, weekStart]);

  const currentUser = useMemo(() => {
    if (!authUser || !schedule?.users) return null;
    return schedule.users.find((user) => user.id === authUser.id) ?? null;
  }, [authUser, schedule?.users]);

  const currentUserGrid = useMemo(() => {
    if (!currentUser || !schedule?.grid) return {} as Record<string, ApiCell>;
    return schedule.grid[currentUser.id] ?? {};
  }, [currentUser, schedule?.grid]);

  const assignedSites = useMemo(() => {
    const byName = new Map(
      sites.map((site) => [site.name.trim(), {
        id: site.id,
        label: site.companyName ? `${site.companyName} / ${site.name}` : site.name,
      }]),
    );
    const seen = new Set<string>();
    const items: Array<{ id: string | null; label: string }> = [];

    for (const day of dayLabels) {
      const entries = cellEntries(currentUserGrid[day.key]);
      for (const entry of entries) {
        const lookupKey = normalizeSiteLookupKey(entry);
        if (!lookupKey || seen.has(lookupKey)) continue;
        seen.add(lookupKey);
        const matched = byName.get(lookupKey);
        items.push(matched ? matched : { id: null, label: entry });
      }
    }

    return items;
  }, [currentUserGrid, dayLabels, sites]);

  const handleSiteClick = useCallback((siteId: string) => {
    router.push(`/site-ledger/${encodeURIComponent(siteId)}?kind=${encodeURIComponent(scheduleKind)}#punch`);
  }, [router, scheduleKind]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <div className="sticky top-0 z-40 border-b border-zinc-200 bg-white px-4 py-4 shadow-sm dark:border-zinc-800 dark:bg-black">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">週予定</h1>
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            {toYmd(weekStart)}〜{toYmd(addDays(weekStart, 6))}
          </div>
        </div>

        <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          表示対象: {userLabel(currentUser ?? authUser)}
        </div>

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

      <div className="p-4">
        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <h2 className="mb-4 text-base font-medium">今週の予定</h2>

        {isLoading ? (
          <div className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-black dark:text-zinc-400">
            読み込み中...
          </div>
        ) : !currentUser ? (
          <div className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-black dark:text-zinc-400">
            ログイン中ユーザーの予定を表示できません。
          </div>
        ) : (
          <div className="space-y-3">
            {dayLabels.map((day) => {
              const entries = cellEntries(currentUserGrid[day.key]);
              return (
                <div
                  key={day.key}
                  className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-black"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm text-zinc-500 dark:text-zinc-400">{day.key}</div>
                      <div className="font-medium">
                        {day.dow} {day.dayNum}日
                      </div>
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      {entries.length > 0 ? `${entries.length}件` : '予定なし'}
                    </div>
                  </div>

                  {entries.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {entries.map((entry) => (
                        <span
                          key={`${day.key}:${entry}`}
                          className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        >
                          {entry}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">この日の予定はありません。</div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <h2 className="mb-4 mt-8 text-base font-medium">今週の現場リスト</h2>

        {assignedSites.length === 0 ? (
          <div className="text-center py-8 text-zinc-500 dark:text-zinc-400">
            今週の割当現場はありません
          </div>
        ) : (
          <div className="space-y-3">
            {assignedSites.map((site) => (
              site.id ? (
                <button
                  key={`${site.id}:${site.label}`}
                  onClick={() => handleSiteClick(site.id!)}
                  className="w-full rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                >
                  <div className="font-medium">{site.label}</div>
                  <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    タップして打刻・詳細を表示
                  </div>
                </button>
              ) : (
                <div
                  key={site.label}
                  className="w-full rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm dark:border-zinc-800 dark:bg-black"
                >
                  <div className="font-medium">{site.label}</div>
                  <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    台帳未紐付けの予定名です
                  </div>
                </div>
              )
            ))}
          </div>
        )}
      </div>
    </div>
  );
}