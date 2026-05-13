'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  buildNameColumnTrack,
  defaultWeekGridPrefs,
  normalizeWeekGridPrefs,
  type WeekGridPrefs,
} from '@/shared/week-grid-prefs';
import { getCurrentPathWithSearch, readStoredScheduleReturn, writeStoredScheduleReturn } from '@/shared/schedule-return';

type ScheduleKind = 'normal' | 'daily';
type MobileTab = 'week' | 'personal';

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

type ScheduleEntryTarget = {
  entry: string;
  siteId: string | null;
};

type LinkedScheduleEntryTarget = {
  entry: string;
  siteId: string;
};

type CellEntryMenuState = {
  title: string;
  items: ScheduleEntryTarget[];
  top: number;
  left: number;
  width: number;
};

type JsonObject = Record<string, unknown>;

type MobileWeekHubHistoryState = {
  v: 1;
  cursorDate: string;
};

const MOBILE_WEEK_HUB_HISTORY_STATE_KEY = 'masterHub.mobileWeekHubState';

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

function readRequestedScheduleKind(searchParams: ReturnType<typeof useSearchParams>): ScheduleKind | null {
  const raw = (searchParams.get('kind') ?? '').trim().toLowerCase();
  return raw === 'daily' ? 'daily' : raw === 'normal' ? 'normal' : null;
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

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' ? (value as JsonObject) : null;
}

function normalizeMobileWeekHubHistoryState(raw: unknown): MobileWeekHubHistoryState | null {
  const obj = asObject(raw);
  if (!obj) return null;
  const cursorDate = typeof obj.cursorDate === 'string' ? obj.cursorDate : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cursorDate)) return null;
  return { v: 1, cursorDate };
}

function readMobileWeekHubHistoryState(): MobileWeekHubHistoryState | null {
  if (typeof window === 'undefined') return null;
  const rawState = window.history.state;
  if (!rawState || typeof rawState !== 'object') return null;
  return normalizeMobileWeekHubHistoryState((rawState as Record<string, unknown>)[MOBILE_WEEK_HUB_HISTORY_STATE_KEY]);
}

function resolveScheduleEntryTargets(entries: string[], siteIdByScheduleEntry: Map<string, string>): ScheduleEntryTarget[] {
  return entries.flatMap<ScheduleEntryTarget>((entry) => {
    const tokenMatches = entry
      .split('/')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => ({ entry: part, siteId: siteIdByScheduleEntry.get(normalizeSiteLookupKey(part)) ?? null }))
      .filter(isLinkedScheduleEntryTarget);

    if (tokenMatches.length > 1) {
      return tokenMatches;
    }

    const exactSiteId = siteIdByScheduleEntry.get(normalizeSiteLookupKey(entry)) ?? null;
    if (exactSiteId) {
      return [{ entry, siteId: exactSiteId }];
    }

    if (tokenMatches.length === 1) {
      return [{ entry, siteId: tokenMatches[0].siteId }];
    }

    return [{ entry, siteId: null }];
  });
}

function isLinkedScheduleEntryTarget(target: ScheduleEntryTarget): target is LinkedScheduleEntryTarget {
  return typeof target.siteId === 'string' && target.siteId.length > 0;
}

function resolveScheduleEntryPreview(entries: string[], siteIdByScheduleEntry: Map<string, string>) {
  for (const entry of entries) {
    const parts = entry
      .split('/')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    for (const part of parts) {
      if (siteIdByScheduleEntry.has(normalizeSiteLookupKey(part))) return part;
    }

    if (parts.length > 0) return parts[0];
  }

  return '';
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
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const currentMobileHref = typeof window === 'undefined' ? '/mobile/week-hub' : getCurrentPathWithSearch();
  const initialStoredMobileState =
    typeof window === 'undefined'
      ? null
      : (() => {
          const stored = readStoredScheduleReturn();
          if (stored?.target !== 'mobile-week-hub' || stored.href !== currentMobileHref) return null;
          return normalizeMobileWeekHubHistoryState(stored.state);
        })();
  const initialHistoryStateRef = useRef<MobileWeekHubHistoryState | null>(
    typeof window === 'undefined' ? null : readMobileWeekHubHistoryState() ?? initialStoredMobileState,
  );
  const initialHistoryState = initialHistoryStateRef.current;
  const [cursorDate, setCursorDate] = useState<Date>(() => {
    const restored = initialHistoryState?.cursorDate ? new Date(`${initialHistoryState.cursorDate}T00:00:00`) : null;
    if (restored && !Number.isNaN(restored.getTime())) return restored;
    return new Date();
  });
  const [authUser, setAuthUser] = useState<AuthMeUser | null>(null);
  const [schedule, setSchedule] = useState<ApiResponse | null>(null);
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [weekGridPrefs, setWeekGridPrefs] = useState<WeekGridPrefs>(() => defaultWeekGridPrefs('mobile'));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [cellEntryMenu, setCellEntryMenu] = useState<CellEntryMenuState | null>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);

  const requestedScheduleKind = useMemo(() => readRequestedScheduleKind(searchParams), [searchParams]);

  const scheduleKind = useMemo(
    () => requestedScheduleKind ?? normalizeScheduleKind(authUser?.kind),
    [authUser?.kind, requestedScheduleKind],
  );

  const activeTab = useMemo<MobileTab>(() => {
    if (scheduleKind === 'daily') return 'week';
    const raw = (searchParams.get('tab') ?? '').trim().toLowerCase();
    return raw === 'personal' ? 'personal' : 'week';
  }, [scheduleKind, searchParams]);

  const weekStart = useMemo(() => {
    return startOfWeekMonday(cursorDate);
  }, [cursorDate]);

  const monthWeekTabs = useMemo(() => {
    const monthStart = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
    const monthEnd = new Date(cursorDate.getFullYear(), cursorDate.getMonth() + 1, 0);
    const first = startOfWeekMonday(monthStart);
    const tabs: Date[] = [];
    for (let d = new Date(first); d <= monthEnd; d.setDate(d.getDate() + 7)) {
      tabs.push(new Date(d));
    }
    return tabs;
  }, [cursorDate]);

  const weekGridPrefsKey = useMemo(() => `week-hub:${scheduleKind}:week:gridPrefs`, [scheduleKind]);
  const weekViewLabel = useMemo(() => (scheduleKind === 'daily' ? '日常予定' : '週予定'), [scheduleKind]);

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

  const readWeekGridPrefs = useCallback((key: string): WeekGridPrefs => {
    try {
      const localKey = `masterHub.ui:${key}`;
      const txt = window.localStorage.getItem(localKey);
      if (!txt) return defaultWeekGridPrefs('mobile');
      return normalizeWeekGridPrefs(JSON.parse(txt) as unknown, defaultWeekGridPrefs('mobile'));
    } catch {
      return defaultWeekGridPrefs('mobile');
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setWeekGridPrefs(readWeekGridPrefs(weekGridPrefsKey));
  }, [readWeekGridPrefs, weekGridPrefsKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const apply = (event?: Event) => {
      if (event instanceof StorageEvent) {
        if (event.key && event.key !== `masterHub.ui:${weekGridPrefsKey}`) return;
      }

      if (event instanceof CustomEvent) {
        const detail = asObject(event.detail);
        if (typeof detail?.key === 'string' && detail.key !== weekGridPrefsKey) return;
      }

      setWeekGridPrefs(readWeekGridPrefs(weekGridPrefsKey));
    };

    window.addEventListener('masterHub:gridPrefsUpdated', apply as EventListener);
    window.addEventListener('storage', apply as EventListener);
    return () => {
      window.removeEventListener('masterHub:gridPrefsUpdated', apply as EventListener);
      window.removeEventListener('storage', apply as EventListener);
    };
  }, [readWeekGridPrefs, weekGridPrefsKey]);

  useEffect(() => {
    if (!authUser?.id) {
      if (typeof window !== 'undefined') {
        setWeekGridPrefs(readWeekGridPrefs(weekGridPrefsKey));
      }
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(
          `/api/ui-settings?userId=${encodeURIComponent(authUser.id)}&key=${encodeURIComponent(weekGridPrefsKey)}`,
          { cache: 'no-store' },
        );
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        if (!r.ok || obj?.ok !== true) throw new Error('not ok');

        const raw = (obj as { value?: unknown }).value;
        const vObj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
        const next = normalizeWeekGridPrefs(vObj && typeof vObj.v === 'number' ? vObj : raw, defaultWeekGridPrefs('mobile'));
        if (cancelled) return;
        setWeekGridPrefs(next);

        try {
          const localKey = `masterHub.ui:${weekGridPrefsKey}`;
          window.localStorage.setItem(localKey, JSON.stringify({ ...(vObj ?? {}), ...next }));
        } catch {
          // ignore
        }
      } catch {
        if (cancelled || typeof window === 'undefined') return;
        setWeekGridPrefs(readWeekGridPrefs(weekGridPrefsKey));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authUser?.id, readWeekGridPrefs, weekGridPrefsKey]);

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
        if (controller.signal.aborted) return;
        setAuthUser(null);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setIsLoading(true);
      setError(null);
    });

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
  }, [refreshRevision, scheduleKind, viewMonth, weekStart]);

  const currentUser = (() => {
    if (!authUser || !schedule?.users) return null;
    return schedule.users.find((user) => user.id === authUser.id) ?? null;
  })();

  const currentUserGrid = (() => {
    if (!currentUser || !schedule?.grid) return {} as Record<string, ApiCell>;
    return schedule.grid[currentUser.id] ?? {};
  })();

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

  const siteIdByScheduleEntry = useMemo(() => {
    const map = new Map<string, string>();
    for (const site of sites) {
      const key = normalizeSiteLookupKey(site.name.trim());
      if (!key || map.has(key)) continue;
      map.set(key, site.id);
    }
    return map;
  }, [sites]);

  const closeCellEntryMenu = useCallback(() => {
    setCellEntryMenu(null);
  }, []);

  const openCellEntryMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, title: string, items: ScheduleEntryTarget[]) => {
      if (items.length === 0) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(Math.max(rect.width, 220), Math.max(220, viewportWidth - 16));
      const estimatedHeight = Math.min(items.length * 48 + 56, 320);
      const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
      const preferredTop = rect.bottom + 8;
      const top = preferredTop + estimatedHeight <= viewportHeight - 8
        ? preferredTop
        : Math.max(8, rect.top - estimatedHeight - 8);

      setCellEntryMenu({ title, items, top, left, width });
    },
    [],
  );

  useEffect(() => {
    if (!cellEntryMenu) return;

    const close = () => setCellEntryMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [cellEntryMenu]);

  useEffect(() => {
    setCellEntryMenu(null);
  }, [activeTab, scheduleKind, weekStart]);

  const handleTabChange = useCallback((tab: MobileTab, nextKind?: ScheduleKind) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', tab);
    if (nextKind) {
      next.set('kind', nextKind);
    } else {
      next.delete('kind');
    }
    router.replace(`/mobile/week-hub?${next.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const handleReload = useCallback(() => {
    setRefreshRevision((current) => current + 1);
  }, []);

  const setWeekStartByDate = useCallback((date: Date) => {
    setCursorDate(new Date(date));
  }, []);

  const goPrevMonth = useCallback(() => {
    setCursorDate((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1));
  }, []);

  const goNextMonth = useCallback(() => {
    setCursorDate((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1));
  }, []);

  const rangeLabel = useMemo(() => {
    return `${toYmd(weekStart)}〜${toYmd(addDays(weekStart, 6))}`;
  }, [weekStart]);

  const historySnapshotJsonRef = useRef<string | null>(null);
  const writeMobileWeekHubHistorySnapshot = useCallback((overrides?: Partial<MobileWeekHubHistoryState>) => {
    if (typeof window === 'undefined') return;
    const snapshot: MobileWeekHubHistoryState = {
      v: 1,
      cursorDate: overrides?.cursorDate ?? toYmd(cursorDate),
    };
    const nextJson = JSON.stringify(snapshot);
    if (historySnapshotJsonRef.current === nextJson) return;
    const currentState =
      window.history.state && typeof window.history.state === 'object'
        ? (window.history.state as Record<string, unknown>)
        : {};
    try {
      window.history.replaceState({ ...currentState, [MOBILE_WEEK_HUB_HISTORY_STATE_KEY]: snapshot }, '', window.location.href);
      writeStoredScheduleReturn({
        target: 'mobile-week-hub',
        href: currentMobileHref,
        state: snapshot,
      });
      historySnapshotJsonRef.current = nextJson;
    } catch {
      // ignore
    }
  }, [currentMobileHref, cursorDate]);

  useEffect(() => {
    writeMobileWeekHubHistorySnapshot();
  }, [writeMobileWeekHubHistorySnapshot]);

  const handleSiteClick = useCallback((siteId: string) => {
    writeMobileWeekHubHistorySnapshot();
    router.push(`/site-ledger/${encodeURIComponent(siteId)}?kind=${encodeURIComponent(scheduleKind)}#punch`);
  }, [router, scheduleKind, writeMobileWeekHubHistorySnapshot]);

  const handleScheduleEntryClick = useCallback((entry: string) => {
    const siteId = siteIdByScheduleEntry.get(normalizeSiteLookupKey(entry));
    if (!siteId) return;
    handleSiteClick(siteId);
  }, [handleSiteClick, siteIdByScheduleEntry]);

  const weekGridCellMinH = useMemo(() => {
    return weekGridPrefs.gridLayout === 'comfortable'
      ? weekGridPrefs.cellMinHComfortable
      : weekGridPrefs.cellMinHCompact;
  }, [weekGridPrefs.cellMinHComfortable, weekGridPrefs.cellMinHCompact, weekGridPrefs.gridLayout]);

  const weekGridTemplateColumns = useMemo(() => {
    return `${buildNameColumnTrack(weekGridPrefs.nameColW)} repeat(7, minmax(${Math.max(60, Math.round(weekGridPrefs.cellMinW))}px, 1fr))`;
  }, [weekGridPrefs.cellMinW, weekGridPrefs.nameColW]);

  const weekGridMinWidth = useMemo(() => {
    return Math.max(320, weekGridPrefs.nameColW + weekGridPrefs.cellMinW * 7);
  }, [weekGridPrefs.cellMinW, weekGridPrefs.nameColW]);

  const scheduleCellFontSize = 'var(--weekhub-cell-font-size, 12px)';
  const weekGridHeaderScrollRef = useRef<HTMLDivElement | null>(null);
  const weekGridBodyScrollRef = useRef<HTMLDivElement | null>(null);
  const weekGridScrollSyncRef = useRef<0 | 1>(0);

  const syncWeekGridScrollLeft = useCallback((from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to) return;
    const left = from.scrollLeft;
    if (to.scrollLeft !== left) to.scrollLeft = left;
  }, []);

  const onWeekGridHeaderScroll = useCallback(() => {
    if (weekGridScrollSyncRef.current) return;
    weekGridScrollSyncRef.current = 1;
    syncWeekGridScrollLeft(weekGridHeaderScrollRef.current, weekGridBodyScrollRef.current);
    window.requestAnimationFrame(() => {
      weekGridScrollSyncRef.current = 0;
    });
  }, [syncWeekGridScrollLeft]);

  const onWeekGridBodyScroll = useCallback(() => {
    if (weekGridScrollSyncRef.current) return;
    weekGridScrollSyncRef.current = 1;
    syncWeekGridScrollLeft(weekGridBodyScrollRef.current, weekGridHeaderScrollRef.current);
    window.requestAnimationFrame(() => {
      weekGridScrollSyncRef.current = 0;
    });
  }, [syncWeekGridScrollLeft]);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const apply = () => {
      const next = Math.max(0, Math.round(toolbar.getBoundingClientRect().height));
      setToolbarHeight((prev) => (prev === next ? prev : next));
    };

    apply();
    const ro = new ResizeObserver(() => apply());
    ro.observe(toolbar);
    window.addEventListener('resize', apply);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <div ref={toolbarRef} className="sticky top-0 z-40 border-b border-zinc-200 bg-white px-4 py-4 shadow-sm dark:border-zinc-800 dark:bg-black">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold">{weekViewLabel}</h1>
            </div>
            <div className="flex items-center justify-end gap-2">
              <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-950">
                <button
                  type="button"
                  onClick={() => handleTabChange('week', 'normal')}
                  className={`rounded-md px-3 py-1.5 text-sm transition ${
                    activeTab === 'week' && scheduleKind === 'normal'
                      ? 'bg-white text-zinc-900 shadow-sm dark:bg-black dark:text-zinc-50'
                      : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  週予定
                </button>
                <button
                  type="button"
                  onClick={() => handleTabChange('personal', 'normal')}
                  className={`rounded-md px-3 py-1.5 text-sm transition ${
                    activeTab === 'personal' && scheduleKind === 'normal'
                      ? 'bg-white text-zinc-900 shadow-sm dark:bg-black dark:text-zinc-50'
                      : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  個人
                </button>
                <button
                  type="button"
                  onClick={() => handleTabChange('week', 'daily')}
                  className={`rounded-md px-3 py-1.5 text-sm transition ${
                    activeTab === 'week' && scheduleKind === 'daily'
                      ? 'bg-white text-zinc-900 shadow-sm dark:bg-black dark:text-zinc-50'
                      : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  日常
                </button>
              </div>
              <button
                type="button"
                onClick={handleReload}
                disabled={isLoading}
                className="shrink-0 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                aria-label="再読込"
              >
                {isLoading ? '更新中…' : '再読込'}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto">
            <button
              type="button"
              onClick={goPrevMonth}
              className="shrink-0 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-black"
              aria-label="前の月"
            >
              ←
            </button>
            <div className="flex min-w-max items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-950">
              {monthWeekTabs.map((tab) => {
                const label = `${tab.getMonth() + 1}/${tab.getDate()}`;
                const active = toYmd(startOfWeekMonday(tab)) === toYmd(weekStart);
                return (
                  <button
                    key={toYmd(tab)}
                    type="button"
                    onClick={() => setWeekStartByDate(tab)}
                    className={`rounded-md px-3 py-1.5 text-sm transition ${
                      active
                        ? 'bg-white text-zinc-900 shadow-sm dark:bg-black dark:text-zinc-50'
                        : 'text-zinc-600 dark:text-zinc-300'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={goNextMonth}
              className="shrink-0 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-black"
              aria-label="次の月"
            >
              →
            </button>
          </div>

          <div className="text-right text-sm text-zinc-500 dark:text-zinc-400">
            <div>{rangeLabel}</div>
          </div>

          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            {activeTab === 'personal'
              ? `表示対象: ${userLabel(currentUser ?? authUser)}`
              : `表示対象: ${scheduleKind === 'daily' ? '日常予定（全従業員）' : '全従業員'}`}
          </div>

        </div>
      </div>

      <div className="p-4">
        {error ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        ) : null}

        {activeTab === 'week' ? (
          <>
            <h2 className="mb-4 text-base font-medium">{weekViewLabel}</h2>

            {isLoading ? (
              <div className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-black dark:text-zinc-400">
                読み込み中...
              </div>
            ) : !schedule || schedule.users.length === 0 ? (
              <div className="rounded-lg border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-black dark:text-zinc-400">
                表示できる従業員予定がありません。
              </div>
            ) : (
              <div className="rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-black">
                <div
                  className="sticky z-20 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black"
                  style={{ top: `${toolbarHeight}px` }}
                >
                  <div
                    ref={weekGridHeaderScrollRef}
                    className="mh-scrollbar-hidden overflow-x-auto overflow-y-hidden"
                    onScroll={onWeekGridHeaderScroll}
                    data-testid="mobile-week-grid-header-scroll"
                  >
                    <div
                      className="grid"
                      style={{ gridTemplateColumns: weekGridTemplateColumns, minWidth: `${weekGridMinWidth}px` }}
                    >
                      <div
                        className="sticky left-0 z-10 border-r border-zinc-200 bg-white px-3 py-3 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-black dark:text-zinc-400"
                        style={{ minHeight: `${weekGridCellMinH}px` }}
                      >
                        従業員
                      </div>
                      {dayLabels.map((day) => (
                        <div
                          key={`header:${day.key}`}
                          className={`border-l border-zinc-200 bg-white px-2 py-3 text-center text-xs dark:border-zinc-800 dark:bg-black ${
                            day.isSun
                              ? 'text-red-600 dark:text-red-400'
                              : day.isSat
                                ? 'text-blue-600 dark:text-blue-400'
                                : 'text-zinc-500 dark:text-zinc-400'
                          }`}
                          style={{ minHeight: `${weekGridCellMinH}px` }}
                        >
                          <div>{day.dow}</div>
                          <div className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">{day.dayNum}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div
                  ref={weekGridBodyScrollRef}
                  className="overflow-x-auto"
                  onScroll={onWeekGridBodyScroll}
                  data-testid="mobile-week-grid-body-scroll"
                >
                  <div
                    className="grid"
                    style={{ gridTemplateColumns: weekGridTemplateColumns, minWidth: `${weekGridMinWidth}px` }}
                  >
                    {schedule.users.map((user) => {
                      const isCurrentUser = user.id === authUser?.id;
                      return (
                        <Fragment key={user.id}>
                          <div
                            className={`sticky left-0 z-10 border-b border-r border-zinc-200 px-3 py-3 text-sm font-medium dark:border-zinc-800 ${
                              isCurrentUser ? 'bg-blue-50 dark:bg-blue-950/20' : 'bg-white dark:bg-black'
                            }`}
                            style={{ minHeight: `${weekGridCellMinH}px` }}
                          >
                            {userLabel(user)}
                          </div>
                          {dayLabels.map((day) => {
                            const entries = cellEntries(schedule.grid?.[user.id]?.[day.key]);
                            const entryTargets = resolveScheduleEntryTargets(entries, siteIdByScheduleEntry);
                            const previewLabel = resolveScheduleEntryPreview(entries, siteIdByScheduleEntry);
                            const hasMultipleEntries = entryTargets.length > 1;
                            return (
                              <div
                                key={`${user.id}:${day.key}`}
                                className={`border-b border-l border-zinc-200 px-2 py-2 text-xs dark:border-zinc-800 ${
                                  isCurrentUser ? 'bg-blue-50/60 dark:bg-blue-950/10' : ''
                                }`}
                                style={{ minHeight: `${weekGridCellMinH}px` }}
                              >
                                {entries.length > 0 ? (
                                  <button
                                    type="button"
                                    onClick={(event) =>
                                      openCellEntryMenu(
                                        event,
                                        `${userLabel(user)} / ${day.key}`,
                                        entryTargets,
                                      )
                                    }
                                    className={`relative w-full rounded border px-2 py-1 text-left leading-snug ${
                                      entryTargets.some(isLinkedScheduleEntryTarget)
                                        ? 'border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900'
                                        : 'border-dashed border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400'
                                    }`}
                                    style={{ fontSize: scheduleCellFontSize }}
                                    title="内容を確認"
                                    aria-haspopup="menu"
                                    aria-expanded={cellEntryMenu?.title === `${userLabel(user)} / ${day.key}` ? 'true' : undefined}
                                    data-testid={`mobile-week-cell-menu-${user.id}-${day.key}`}
                                  >
                                    <span className="block truncate pr-4">{previewLabel}</span>
                                    {hasMultipleEntries ? (
                                      <span className="absolute bottom-1 right-1 text-xs font-bold leading-none text-red-600 dark:text-red-400">
                                        +
                                      </span>
                                    ) : null}
                                  </button>
                                ) : (
                                  <div className="text-zinc-300 dark:text-zinc-700">-</div>
                                )}
                              </div>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
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
                            <button
                              key={`${day.key}:${entry}`}
                              type="button"
                              onClick={() => handleScheduleEntryClick(entry)}
                              className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                              style={{ fontSize: scheduleCellFontSize }}
                              title="現場詳細を開く"
                            >
                              {entry}
                            </button>
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
              <div className="py-8 text-center text-zinc-500 dark:text-zinc-400">今週の割当現場はありません</div>
            ) : (
              <div className="space-y-3">
                {assignedSites.map((site) =>
                  site.id ? (
                    <button
                      key={`${site.id}:${site.label}`}
                      onClick={() => handleSiteClick(site.id!)}
                      className="w-full rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                    >
                      <div className="font-medium">{site.label}</div>
                      <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">タップして打刻・詳細を表示</div>
                    </button>
                  ) : (
                    <div
                      key={site.label}
                      className="w-full rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm dark:border-zinc-800 dark:bg-black"
                    >
                      <div className="font-medium">{site.label}</div>
                      <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">台帳未紐付けの予定名です</div>
                    </div>
                  ),
                )}
              </div>
            )}
          </>
        )}
      </div>

      {cellEntryMenu ? (
        <>
          <button
            type="button"
            aria-label="現場一覧を閉じる"
            onClick={closeCellEntryMenu}
            className="fixed inset-0 z-40 bg-black/20"
          />
          <div
            className="fixed z-50 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-black"
            style={{ top: cellEntryMenu.top, left: cellEntryMenu.left, width: cellEntryMenu.width }}
            data-testid="mobile-cell-entry-menu"
          >
            <div className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <div className="truncate text-[11px] font-medium text-zinc-700 dark:text-zinc-200">{cellEntryMenu.title}</div>
              <div className="mt-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">現場を選択</div>
            </div>

            <div className="overflow-y-auto p-1" style={{ maxHeight: 'min(50vh, 22rem)' }}>
              {cellEntryMenu.items.map((item) => (
                <button
                  key={`${cellEntryMenu.title}:${item.siteId}`}
                  type="button"
                  onClick={() => {
                    if (!item.siteId) return;
                    closeCellEntryMenu();
                    handleSiteClick(item.siteId);
                  }}
                  disabled={!item.siteId}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-zinc-50 disabled:cursor-default disabled:text-zinc-500 dark:hover:bg-zinc-900 dark:disabled:text-zinc-400"
                  data-testid={`mobile-cell-entry-option-${item.siteId ?? 'unmapped'}`}
                >
                  <span className="truncate">{item.entry}</span>
                  <span className="ml-3 shrink-0 text-[10px] text-zinc-500 dark:text-zinc-400">
                    {item.siteId ? '詳細へ' : '未紐付け'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}