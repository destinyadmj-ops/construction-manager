'use client';

import { useSearchParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHeaderActions } from './header-actions';

type ViewMode = 'week' | 'month' | 'year';

type CellClickAction = 'toggle' | 'add' | 'remove' | 'replace2' | 'swap';

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
  days: string[];
  users: ApiUser[];
  grid: Record<string, Record<string, ApiCell>>; // userId -> day(yyyy-mm-dd) -> cell
};

type MonthApiResponse = {
  ok: true;
  month: string; // YYYY-MM
  days: string[];
  users: ApiUser[];
  grid: Record<string, Record<string, ApiCell>>;
};

type YearSummaryApiResponse = {
  ok: true;
  year: number;
  months: string[]; // YYYY-MM x 12
  users: ApiUser[];
  grid: Record<string, Record<string, { entries: number; days: number }>>;
};

type SiteItem = {
  id: string | null;
  label: string;
};

type CellSlots = [string | null, string | null];

type CellHistoryEntry = {
  kind: 'cell';
  userId: string;
  day: string; // YYYY-MM-DD
  before: CellSlots;
  after: CellSlots;
  at: number;
};

const HISTORY_GROUP_MS = 800;

function slotsEqual(a: CellSlots, b: CellSlots) {
  return a[0] === b[0] && a[1] === b[1];
}

type RepeatRule = {
  intervalMonths: number;
  weekdays: number[];
  monthDays: number[];
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

function monthIndex(yy: number, mm1to12: number) {
  return yy * 12 + (mm1to12 - 1);
}

function daysInMonth(yy: number, mm1to12: number) {
  return new Date(yy, mm1to12, 0).getDate();
}

function weekdayMon1Sun7FromYmd(ymd: string): number {
  const d = new Date(`${ymd}T00:00:00`);
  const dow0Sun = d.getDay();
  return dow0Sun === 0 ? 7 : dow0Sun;
}

const DOW = ['月', '火', '水', '木', '金', '土', '日'] as const;

export default function WeekHub() {
  const { setAddAction, setSaveAction, setUndoAction, setRedoAction } = useHeaderActions();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<ViewMode>('week');
  const [cursorDate, setCursorDate] = useState<Date>(() => new Date());
  const [data, setData] = useState<ApiResponse | null>(null);
  const [monthData, setMonthData] = useState<MonthApiResponse | null>(null);
  const [yearData, setYearData] = useState<YearSummaryApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [selectedSite, setSelectedSite] = useState<SiteItem | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [cellClickAction, setCellClickAction] = useState<CellClickAction>('toggle');
  const [cellActionMsg, setCellActionMsg] = useState<string | null>(null);
  const cellActionMsgTimer = useRef<number | null>(null);

  const [undoStack, setUndoStack] = useState<CellHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<CellHistoryEntry[]>([]);
  const [isUndoRedoBusy, setIsUndoRedoBusy] = useState(false);

  useEffect(() => {
    const m = searchParams.get('mode');
    if (m === 'week' || m === 'month' || m === 'year') {
      setMode(m);
    }
  }, [searchParams]);

  useEffect(() => {
    try {
      const key = 'masterHub.lastSelectedSiteLabel';
      if (selectedSite?.label) {
        window.localStorage.setItem(key, selectedSite.label);
      } else {
        window.localStorage.removeItem(key);
      }
    } catch {
      // ignore
    }
  }, [selectedSite?.label]);

  const showCellActionMsg = useCallback((msg: string | null) => {
    if (cellActionMsgTimer.current) {
      window.clearTimeout(cellActionMsgTimer.current);
      cellActionMsgTimer.current = null;
    }
    setCellActionMsg(msg);
    if (msg) {
      cellActionMsgTimer.current = window.setTimeout(() => {
        setCellActionMsg(null);
        cellActionMsgTimer.current = null;
      }, 2500);
    }
  }, []);

  const cellActionButtons = (
    <div className="ml-1 flex items-center gap-1">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">セル操作</span>
      <div className="flex max-w-[60vw] items-center gap-1 overflow-x-auto">
        {(
          [
            {
              value: 'toggle' as const,
              label: 'トグル',
              title: '選択現場があれば削除 / なければ追加（満杯なら2枠目を置換）',
            },
            { value: 'add' as const, label: '追加', title: '空きがある時だけ追加（満杯なら変更なし）' },
            { value: 'replace2' as const, label: '置換2', title: '2枠目を置換（空きなら追加）' },
            { value: 'remove' as const, label: '削除', title: '選択現場を削除（無ければ変更なし）' },
            { value: 'swap' as const, label: '入替', title: '1枠目と2枠目を入替（現場選択なしでOK）' },
          ] satisfies Array<{ value: CellClickAction; label: string; title: string }>
        ).map((a) => {
          const active = cellClickAction === a.value;
          return (
            <button
              key={a.value}
              type="button"
              onClick={() => setCellClickAction(a.value)}
              aria-pressed={active}
              title={a.title}
              data-testid={`cell-action-${a.value}`}
              className={`shrink-0 rounded-md border px-2 py-1 text-[11px] tabular-nums ${
                active
                  ? 'border-zinc-300 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-black dark:text-zinc-200'
                  : 'border-zinc-200 bg-white/60 text-zinc-600 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:text-zinc-300 dark:hover:bg-black'
              }`}
            >
              {a.label}
            </button>
          );
        })}
      </div>
    </div>
  );
  const modeTabsRef = useRef<HTMLDivElement | null>(null);
  const [selectedSiteCreatedAt, setSelectedSiteCreatedAt] = useState<string | null>(null);
  const [newSiteName, setNewSiteName] = useState('');
  const [siteCreateMsg, setSiteCreateMsg] = useState<string | null>(null);
  const [repeatRule, setRepeatRule] = useState<RepeatRule>({
    intervalMonths: 1,
    weekdays: [],
    monthDays: [],
  });
  const [isSavingRule, setIsSavingRule] = useState(false);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [autoFillMonth, setAutoFillMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  });

  const [siteDetailOpen, setSiteDetailOpen] = useState(false);
  const [deprMonth, setDeprMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  });
  const [deprState, setDeprState] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ok'; count: number; threshold: number; alert: boolean }
    | { status: 'error'; message: string }
  >({ status: 'idle' });

  const [siteDeprMap, setSiteDeprMap] = useState<
    Record<string, { count: number; threshold: number; alert: boolean }>
  >({});
  const [deprThresholdInput, setDeprThresholdInput] = useState<string>('10');
  const [deprSaveMsg, setDeprSaveMsg] = useState<string | null>(null);
  const [autoFillResult, setAutoFillResult] = useState<
    | {
        ok: true;
        created: number;
        skipped: number;
        reason?: string;
      }
    | { ok: false; error: string }
    | null
  >(null);

  const weekStart = useMemo(() => {
    return startOfWeekMonday(cursorDate);
  }, [cursorDate]);

  const historyScopeKey = useMemo(() => {
    if (mode === 'week') return `week:${toYmd(weekStart)}`;
    if (mode === 'month') return `month:${cursorDate.getFullYear()}-${pad2(cursorDate.getMonth() + 1)}`;
    return `year:${cursorDate.getFullYear()}`;
  }, [cursorDate, mode, weekStart]);

  useEffect(() => {
    // Keep Undo/Redo local to the current view scope.
    setUndoStack([]);
    setRedoStack([]);
  }, [historyScopeKey]);

  const selectedUserLabel = useMemo(() => {
    if (!selectedUserId) return null;
    const pools: ApiUser[] = [
      ...(data?.users ?? []),
      ...(monthData?.users ?? []),
      ...(yearData?.users ?? []),
    ];
    const hit = pools.find((u) => u.id === selectedUserId);
    return hit ? hit.name ?? hit.email ?? hit.id : selectedUserId;
  }, [data?.users, monthData?.users, selectedUserId, yearData?.users]);

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  useEffect(() => {
    if (mode !== 'week') return;

    const controller = new AbortController();
    queueMicrotask(() => setIsLoading(true));

    fetch(`/api/schedule/week?weekStart=${encodeURIComponent(toYmd(weekStart))}`,
      { signal: controller.signal },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return (await res.json()) as ApiResponse;
      })
      .then((json) => setData(json))
      .catch(() => {
        // Keep UI usable even if API is not ready.
        setData(null);
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, [mode, weekStart]);

  const viewMonth = useMemo(() => {
    return `${cursorDate.getFullYear()}-${pad2(cursorDate.getMonth() + 1)}`;
  }, [cursorDate]);

  const viewYear = useMemo(() => cursorDate.getFullYear(), [cursorDate]);

  const refreshCurrentView = useCallback(async () => {
    try {
      if (mode === 'week') {
        const res = await fetch(`/api/schedule/week?weekStart=${encodeURIComponent(toYmd(weekStart))}`);
        if (res.ok) setData((await res.json()) as ApiResponse);
        return;
      }
      if (mode === 'month') {
        const res = await fetch(`/api/schedule/month?month=${encodeURIComponent(viewMonth)}`);
        if (res.ok) setMonthData((await res.json()) as MonthApiResponse);
        return;
      }
      if (mode === 'year') {
        const res = await fetch(`/api/schedule/year/summary?year=${encodeURIComponent(String(viewYear))}`);
        if (res.ok) setYearData((await res.json()) as YearSummaryApiResponse);
      }
    } catch {
      // ignore
    }
  }, [mode, viewMonth, viewYear, weekStart]);

  const pushHistory = (entry: CellHistoryEntry) => {
    setUndoStack((cur) => {
      const last = cur[cur.length - 1];
      if (
        last &&
        last.kind === 'cell' &&
        last.userId === entry.userId &&
        last.day === entry.day &&
        entry.at - last.at <= HISTORY_GROUP_MS &&
        slotsEqual(last.after, entry.before)
      ) {
        const merged: CellHistoryEntry = {
          ...last,
          after: entry.after,
          at: entry.at,
        };
        const next = [...cur.slice(0, -1), merged];
        const limit = 50;
        return next.length > limit ? next.slice(next.length - limit) : next;
      }

      const next = [...cur, entry];
      const limit = 50;
      return next.length > limit ? next.slice(next.length - limit) : next;
    });
    setRedoStack([]);
  };

  const restoreCell = useCallback(async (entry: CellHistoryEntry, target: 'before' | 'after') => {
    setIsUndoRedoBusy(true);
    try {
      const slots = target === 'before' ? entry.before : entry.after;
      const r = await fetch('/api/schedule/cell/set', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: entry.userId,
          day: entry.day,
          slot1: slots[0],
          slot2: slots[1],
        }),
      });
      const json = (await r.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error?: string }
        | null;
      if (!r.ok || !json || !('ok' in json) || json.ok !== true) {
        const msg = json && 'ok' in json && json.ok === false ? json.error : undefined;
        showCellActionMsg(msg ? `Undo/Redoに失敗: ${msg}` : `Undo/Redoに失敗（HTTP ${r.status}）`);
        return false;
      }
      await refreshCurrentView();
      return true;
    } catch {
      showCellActionMsg('Undo/Redoの通信に失敗しました');
      return false;
    } finally {
      setIsUndoRedoBusy(false);
    }
  }, [refreshCurrentView, showCellActionMsg]);

  const undo = useCallback(async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    const ok = await restoreCell(last, 'before');
    if (!ok) return;
    setUndoStack((cur) => cur.slice(0, -1));
    setRedoStack((cur) => [...cur, last]);
    showCellActionMsg('取り消しました');
  }, [restoreCell, showCellActionMsg, undoStack]);

  const redo = useCallback(async () => {
    const last = redoStack[redoStack.length - 1];
    if (!last) return;
    const ok = await restoreCell(last, 'after');
    if (!ok) return;
    setRedoStack((cur) => cur.slice(0, -1));
    setUndoStack((cur) => [...cur, last]);
    showCellActionMsg('やり直しました');
  }, [redoStack, restoreCell, showCellActionMsg]);

  useEffect(() => {
    if (mode !== 'month') return;

    const controller = new AbortController();
    queueMicrotask(() => setIsLoading(true));

    fetch(`/api/schedule/month?month=${encodeURIComponent(viewMonth)}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return (await res.json()) as MonthApiResponse;
      })
      .then((json) => setMonthData(json))
      .catch(() => {
        setMonthData(null);
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, [mode, viewMonth]);

  useEffect(() => {
    if (mode !== 'year') return;

    const controller = new AbortController();
    queueMicrotask(() => setIsLoading(true));

    fetch(`/api/schedule/year/summary?year=${encodeURIComponent(String(viewYear))}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return (await res.json()) as YearSummaryApiResponse;
      })
      .then((json) => setYearData(json))
      .catch(() => {
        setYearData(null);
      })
      .finally(() => setIsLoading(false));

    return () => controller.abort();
  }, [mode, viewYear]);

  useEffect(() => {
    if (!siteDetailOpen) return;
    if (!selectedSite?.id) {
      setDeprState({ status: 'error', message: '現場IDがありません（台帳から選択してください）' });
      return;
    }

    const controller = new AbortController();
    setDeprSaveMsg(null);
    setDeprState({ status: 'loading' });
    fetch(
      `/api/sites/depreciation-count?siteId=${encodeURIComponent(selectedSite.id)}&month=${encodeURIComponent(deprMonth)}`,
      { signal: controller.signal },
    )
      .then(async (r) => {
        const json = (await r.json().catch(() => null)) as
          | { ok: true; count: number; threshold: number; alert: boolean }
          | { ok: false; error?: string }
          | null;
        if (!r.ok || !json || !json.ok) {
          throw new Error((json && !json.ok ? json.error : undefined) || `HTTP ${r.status}`);
        }
        setDeprState({ status: 'ok', count: json.count, threshold: json.threshold, alert: json.alert });
        setDeprThresholdInput(String(json.threshold));
      })
      .catch((e) => {
        setDeprState({ status: 'error', message: e instanceof Error ? e.message : '読み込みに失敗しました' });
      });

    return () => controller.abort();
  }, [deprMonth, selectedSite?.id, siteDetailOpen]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/schedule/sites', { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) return null;
        return (await r.json()) as {
          ok: true;
          names: string[];
          sites?: Array<{ id: string; label: string }>;
        };
      })
      .then((json) => {
        if (!json?.ok) return;
        const fromLedger = (json.sites ?? []).map((s) => ({ id: s.id, label: s.label }));
        if (fromLedger.length > 0) {
          setSites(fromLedger);
        } else {
          setSites((json.names ?? []).map((label) => ({ id: null, label })));
        }
      })
      .catch(() => {
        // ignore
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const ids = sites.map((s) => s.id).filter((x): x is string => Boolean(x));
    if (ids.length === 0) {
      setSiteDeprMap({});
      return;
    }

    const controller = new AbortController();
    fetch(`/api/sites/depreciation-counts?month=${encodeURIComponent(deprMonth)}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const json = (await r.json().catch(() => null)) as
          | {
              ok: true;
              month: string;
              items: Array<{ siteId: string; count: number; threshold: number; alert: boolean }>;
            }
          | { ok: false; error?: string }
          | null;
        if (!r.ok || !json || !json.ok) return;
        const next: Record<string, { count: number; threshold: number; alert: boolean }> = {};
        for (const it of json.items) {
          next[it.siteId] = { count: it.count, threshold: it.threshold, alert: it.alert };
        }
        setSiteDeprMap(next);
      })
      .catch(() => {
        // ignore
      });

    return () => controller.abort();
  }, [deprMonth, sites]);

  useEffect(() => {
    if (!selectedSite?.id) return;
    const controller = new AbortController();
    fetch('/api/sites', { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) return null;
        return (await r.json()) as {
          ok: true;
          sites: Array<{ id: string; repeatRule: unknown; createdAt: string | Date }>;
        };
      })
      .then((json) => {
        if (!json?.ok) return;
        const found = json.sites.find((s) => s.id === selectedSite.id);
        setSelectedSiteCreatedAt(found?.createdAt ? String(found.createdAt) : null);
        const rr = (found?.repeatRule ?? null) as Partial<RepeatRule> | null;
        setRepeatRule({
          intervalMonths: typeof rr?.intervalMonths === 'number' ? rr.intervalMonths : 1,
          weekdays: Array.isArray(rr?.weekdays) ? (rr!.weekdays as number[]) : [],
          monthDays: Array.isArray(rr?.monthDays) ? (rr!.monthDays as number[]) : [],
        });
      })
      .catch(() => {
        // ignore
      });
    return () => controller.abort();
  }, [selectedSite?.id]);

  const autoFillPreview = useMemo(() => {
    if (!selectedSite?.id) {
      return { status: 'no-site' as const, targets: [] as string[] };
    }

    const [yyStr, mmStr] = autoFillMonth.split('-');
    const yy = Number(yyStr);
    const mm = Number(mmStr);
    if (!Number.isFinite(yy) || !Number.isFinite(mm) || mm < 1 || mm > 12) {
      return { status: 'invalid-month' as const, targets: [] as string[] };
    }

    const intervalMonths =
      Number.isFinite(repeatRule.intervalMonths) && repeatRule.intervalMonths >= 1
        ? repeatRule.intervalMonths
        : 1;

    if (intervalMonths > 1 && selectedSiteCreatedAt) {
      const anchor = new Date(selectedSiteCreatedAt);
      const diff = monthIndex(yy, mm) - monthIndex(anchor.getFullYear(), anchor.getMonth() + 1);
      if (((diff % intervalMonths) + intervalMonths) % intervalMonths !== 0) {
        return { status: 'interval-mismatch' as const, targets: [] as string[] };
      }
    }

    const weekdays = repeatRule.weekdays ?? [];
    const monthDays = repeatRule.monthDays ?? [];
    if (weekdays.length === 0 && monthDays.length === 0) {
      return { status: 'no-repeat' as const, targets: [] as string[] };
    }

    const dim = daysInMonth(yy, mm);
    const targets: string[] = [];
    for (let day = 1; day <= dim; day += 1) {
      const ymd = `${yy}-${pad2(mm)}-${pad2(day)}`;
      const wd = weekdayMon1Sun7FromYmd(ymd);
      if (monthDays.includes(day) || weekdays.includes(wd)) targets.push(ymd);
    }
    return { status: 'ok' as const, targets };
  }, [autoFillMonth, repeatRule.intervalMonths, repeatRule.weekdays, repeatRule.monthDays, selectedSite?.id, selectedSiteCreatedAt]);

  const dayLabels = useMemo(() => {
    return days.map((d, i) => ({
      key: toYmd(d),
      dow: DOW[i],
      dayNum: d.getDate(),
      isSat: i === 5,
      isSun: i === 6,
    }));
  }, [days]);

  const monthDayLabels = useMemo(() => {
    if (!monthData?.ok) return [] as Array<{ key: string; dow: string; dayNum: number; isSat: boolean; isSun: boolean }>;
    return monthData.days.map((ymd) => {
      const d = new Date(`${ymd}T00:00:00`);
      const dow0Sun = d.getDay();
      const dowMon0 = dow0Sun === 0 ? 6 : dow0Sun - 1;
      return {
        key: ymd,
        dow: DOW[dowMon0],
        dayNum: d.getDate(),
        isSat: dow0Sun === 6,
        isSun: dow0Sun === 0,
      };
    });
  }, [monthData]);

  const monthWeekTabs = useMemo(() => {
    const monthStart = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1);
    const monthEnd = new Date(cursorDate.getFullYear(), cursorDate.getMonth() + 1, 0);
    // Include the week that contains the 1st (even if its Monday is in the previous month).
    const first = startOfWeekMonday(monthStart);
    const tabs: Date[] = [];
    for (let d = new Date(first); d <= monthEnd; d.setDate(d.getDate() + 7)) {
      tabs.push(new Date(d));
    }
    return {
      monthKey: `${cursorDate.getFullYear()}-${pad2(cursorDate.getMonth() + 1)}`,
      tabs,
    };
  }, [cursorDate]);

  const setWeekStartByDate = (d: Date) => {
    setCursorDate(new Date(d));
  };

  const goPrevMonth = () => {
    setCursorDate(new Date(cursorDate.getFullYear(), cursorDate.getMonth() - 1, 1));
  };
  const goNextMonth = () => {
    setCursorDate(new Date(cursorDate.getFullYear(), cursorDate.getMonth() + 1, 1));
  };

  const goPrevYear = () => {
    setCursorDate(new Date(cursorDate.getFullYear() - 1, 0, 1));
  };
  const goNextYear = () => {
    setCursorDate(new Date(cursorDate.getFullYear() + 1, 0, 1));
  };

  const openMonthFromYear = (month: string, userId: string) => {
    setSelectedUserId(userId);
    setMode('month');
    setCursorDate(new Date(`${month}-01T00:00:00`));
  };

  const modeTabs = (
    <div
      id="mode-tabs"
      ref={modeTabsRef}
      className="sticky top-[var(--app-header-h)] z-40 scroll-mt-20 rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-black"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setMode('month')}
            className={`rounded-md border px-2 py-1 text-xs ${
              mode === 'month'
                ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-black'
                : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
            }`}
          >
            月予定
          </button>
          <button
            type="button"
            onClick={() => setMode('year')}
            className={`rounded-md border px-2 py-1 text-xs ${
              mode === 'year'
                ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-black'
                : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
            }`}
          >
            年予定
          </button>
          <button
            type="button"
            onClick={() => setMode('week')}
            className={`rounded-md border px-2 py-1 text-xs ${
              mode === 'week'
                ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-black'
                : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
            }`}
          >
            週予定
          </button>

          <div className="ml-2 flex min-w-0 flex-1 items-center gap-2 text-xs">
            <span className="text-zinc-500 dark:text-zinc-400">選択:</span>
            {selectedUserId ? (
              <span
                className="min-w-0 flex-1 truncate rounded-full border border-zinc-200 bg-white/60 px-2 py-1 text-zinc-700 dark:border-zinc-800 dark:bg-black/60 dark:text-zinc-200"
                title={selectedUserLabel ?? selectedUserId}
                data-testid="selected-user-chip"
              >
                {selectedUserLabel ?? selectedUserId}
              </span>
            ) : (
              <span className="rounded-full border border-zinc-200 bg-white/60 px-2 py-1 text-zinc-400 dark:border-zinc-800 dark:bg-black/60 dark:text-zinc-500">
                （なし）
              </span>
            )}
            {selectedUserId ? (
              <button
                type="button"
                onClick={() => setSelectedUserId(null)}
                className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                aria-label="選択解除"
                data-testid="clear-selected-user"
              >
                解除
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {mode === 'month' ? (
            <>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={goPrevMonth}
                  className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                  aria-label="前の月"
                >
                  ←
                </button>
                <div
                  className="px-1 text-xs tabular-nums text-zinc-600 dark:text-zinc-300"
                  data-testid="modebar-month"
                >
                  {viewMonth}
                </div>
                <button
                  type="button"
                  onClick={goNextMonth}
                  className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                  aria-label="次の月"
                >
                  →
                </button>
                <button
                  type="button"
                  onClick={() => setWeekStartByDate(new Date())}
                  className="ml-1 rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                >
                  今月
                </button>
              </div>

              {cellActionButtons}
            </>
          ) : mode === 'year' ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={goPrevYear}
                className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                aria-label="前の年"
              >
                ←
              </button>
              <div
                className="px-1 text-xs tabular-nums text-zinc-600 dark:text-zinc-300"
                data-testid="modebar-year"
              >
                {viewYear}年
              </div>
              <button
                type="button"
                onClick={goNextYear}
                className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                aria-label="次の年"
              >
                →
              </button>
              <button
                type="button"
                onClick={() => setWeekStartByDate(new Date())}
                className="ml-1 rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
              >
                今年
              </button>
            </div>
          ) : mode === 'week' ? (
            <>
              <div className="px-1 text-xs tabular-nums text-zinc-600 dark:text-zinc-300" data-testid="modebar-week">
                {toYmd(weekStart)}〜{toYmd(addDays(weekStart, 6))}
              </div>

              {cellActionButtons}
            </>
          ) : null}

          {isLoading ? (
            <div className="text-xs text-zinc-500 dark:text-zinc-400">読み込み中…</div>
          ) : null}

          {cellActionMsg ? (
            <div
              className="max-w-[60vw] truncate text-xs text-zinc-500 dark:text-zinc-400"
              role="status"
              aria-live="polite"
              data-testid="cell-action-msg"
              title={cellActionMsg}
            >
              {cellActionMsg}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  useEffect(() => {
    const el = modeTabsRef.current;
    if (!el) return;
    const apply = () => {
      const h = Math.max(0, Math.round(el.getBoundingClientRect().height));
      document.documentElement.style.setProperty('--mode-tabs-h', `${h || 0}px`);
    };
    apply();
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    window.addEventListener('resize', apply);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, [mode]);

  useEffect(() => {
    const canAddSite = !!newSiteName.trim();
    const canSaveRule = !!selectedSite?.id && !isSavingRule;

    setAddAction({
      onClick: async () => {
        const name = newSiteName.trim();
        if (!name) return;
        setSiteCreateMsg(null);
        try {
          const r = await fetch('/api/sites', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name }),
          });
          const json = (await r.json().catch(() => null)) as
            | { ok: true; site: { id: string } }
            | { ok: false; error?: string }
            | null;
          if (!r.ok || !json?.ok) {
            const msg = json && !json.ok ? json.error : undefined;
            setSiteCreateMsg(msg || `HTTP ${r.status}`);
            return;
          }
          const created: SiteItem = { id: json.site.id, label: name };
          setSites((cur) => [created, ...cur]);
          setSelectedSite(created);
          setNewSiteName('');
          setSiteCreateMsg('追加しました');
        } catch {
          setSiteCreateMsg('作成に失敗しました');
        }
      },
      disabled: !canAddSite,
      title: '追加（現場）',
    });

    setSaveAction({
      onClick: async () => {
        if (!selectedSite?.id) return;
        setIsSavingRule(true);
        try {
          await fetch('/api/sites/repeat-rule', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ siteId: selectedSite.id, repeatRule }),
          });
        } finally {
          setIsSavingRule(false);
        }
      },
      disabled: !canSaveRule,
      title: '作業や入力（リピート設定）',
    });

    return () => {
      setAddAction(undefined);
      setSaveAction(undefined);
    };
  }, [isSavingRule, newSiteName, repeatRule, selectedSite?.id, setAddAction, setSaveAction]);

  useEffect(() => {
    const canUndo = undoStack.length > 0 && !isUndoRedoBusy;
    const canRedo = redoStack.length > 0 && !isUndoRedoBusy;

    setUndoAction(
      canUndo
        ? {
            onClick: undo,
            disabled: !canUndo,
            title: '入力を取り消し',
          }
        : undefined,
    );
    setRedoAction(
      canRedo
        ? {
            onClick: redo,
            disabled: !canRedo,
            title: '入力をやり直し',
          }
        : undefined,
    );

    return () => {
      setUndoAction(undefined);
      setRedoAction(undefined);
    };
  }, [isUndoRedoBusy, redoStack.length, setRedoAction, setUndoAction, undo, undoStack.length]);

  return (
    <div className="min-h-[calc(100vh-56px)] bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <div className="mx-auto w-full max-w-screen-2xl px-4 py-4 lg:px-6">
        {/* Main content */}
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[200px_1fr]">
          {mode === 'week' ? (
            <>
              <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-black">
                <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">現場リスト</div>
                <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  現場を選択 → 週表のセルをクリックで入力
                </div>

                <div className="mt-3">
                  <div className="text-xs text-zinc-600 dark:text-zinc-400">バッジ月（償却カウント）</div>
                  <input
                    type="month"
                    value={deprMonth}
                    onChange={(e) => setDeprMonth(e.target.value)}
                    className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                  />
                </div>

                <div className="mt-3 max-h-[calc(100vh-56px-240px)] overflow-y-auto">
                  {sites.length === 0 ? (
                    <div className="py-3 text-xs text-zinc-500 dark:text-zinc-400">
                      まだ候補がありません（過去データから自動で出ます）。
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {sites.map((s) => {
                        const active = selectedSite?.label === s.label;
                        const badge = s.id ? siteDeprMap[s.id] : undefined;
                        return (
                          <button
                            key={s.id ?? s.label}
                            type="button"
                            onClick={() => setSelectedSite((cur) => (cur?.label === s.label ? null : s))}
                            className={`w-full rounded-md border px-2 py-2 text-left text-xs ${
                              active
                                ? 'border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950'
                                : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex-1 truncate">
                                {s.label}
                                {s.label.includes('!') ? (
                                  <span className="ml-2 text-red-600 dark:text-red-400">!</span>
                                ) : null}
                              </div>
                              {badge ? (
                                <span
                                  className={`rounded-md border px-1.5 py-0.5 text-[10px] tabular-nums ${
                                    badge.alert
                                      ? 'border-red-200 text-red-700 dark:border-red-900 dark:text-red-300'
                                      : 'border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300'
                                  }`}
                                  title={`今月(${deprMonth}): ${badge.count}件 / 閾値 ${badge.threshold}`}
                                >
                                  {badge.count}
                                </span>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                  選択中: {selectedSite?.label ?? '（なし）'}
                </div>

                <button
                  type="button"
                  disabled={!selectedSite}
                  onClick={() => setSiteDetailOpen(true)}
                  className="mt-2 w-full rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                >
                  現場詳細（償却カウント）
                </button>

                <div
                  id="site-ledger"
                  className="mt-3 scroll-mt-20 rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                >
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">現場台帳（追加）</div>
                  <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    新しい現場名を追加できます（devではトークン無しでもOK）。
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={newSiteName}
                      onChange={(e) => setNewSiteName(e.target.value)}
                      placeholder="現場名"
                      className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                    />
                    <button
                      type="button"
                      disabled={!newSiteName.trim()}
                      onClick={async () => {
                        const name = newSiteName.trim();
                        if (!name) return;
                        setSiteCreateMsg(null);
                        try {
                          const r = await fetch('/api/sites', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ name }),
                          });
                          const json = (await r.json().catch(() => null)) as
                            | { ok: true; site: { id: string } }
                            | { ok: false; error?: string }
                            | null;
                          if (!r.ok || !json?.ok) {
                            const msg = json && !json.ok ? json.error : undefined;
                            setSiteCreateMsg(msg || `HTTP ${r.status}`);
                            return;
                          }
                          const created: SiteItem = { id: json.site.id, label: name };
                          setSites((cur) => [created, ...cur]);
                          setSelectedSite(created);
                          setNewSiteName('');
                          setSiteCreateMsg('追加しました');
                        } catch {
                          setSiteCreateMsg('作成に失敗しました');
                        }
                      }}
                      className="shrink-0 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                    >
                      追加
                    </button>
                  </div>
                  {siteCreateMsg ? (
                    <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{siteCreateMsg}</div>
                  ) : null}
                </div>

                <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  入力対象の従業員:{' '}
                  {selectedUserId ? selectedUserLabel ?? selectedUserId : '（週表の従業員名をクリックして選択）'}
                </div>

                <div id="management" className="mt-4 scroll-mt-20 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    ペース（リピート）
                  </div>
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    選択した現場のリピート条件（ツリー）を設定します。
                  </div>

                  <div className="mt-3 space-y-3">
                    <div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-400">
                        月スパン（1〜12ヶ月）
                      </div>
                      <select
                        value={repeatRule.intervalMonths}
                        onChange={(e) =>
                          setRepeatRule((r) => ({
                            ...r,
                            intervalMonths: Number(e.target.value) || 1,
                          }))
                        }
                        className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                        disabled={!selectedSite?.id}
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>
                            {n}ヶ月
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-400">曜日</div>
                      <div className="mt-2 grid grid-cols-7 gap-1">
                        {DOW.map((label, idx) => {
                          const v = idx + 1;
                          const checked = repeatRule.weekdays.includes(v);
                          return (
                            <button
                              key={label}
                              type="button"
                              disabled={!selectedSite?.id}
                              onClick={() =>
                                setRepeatRule((r) => ({
                                  ...r,
                                  weekdays: checked
                                    ? r.weekdays.filter((x) => x !== v)
                                    : [...r.weekdays, v].sort((a, b) => a - b),
                                }))
                              }
                              className={`rounded-md border px-1 py-2 text-xs ${
                                checked
                                  ? 'border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950'
                                  : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-400">日付</div>
                      <div className="mt-2 grid grid-cols-7 gap-1">
                        {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => {
                          const checked = repeatRule.monthDays.includes(n);
                          return (
                            <button
                              key={n}
                              type="button"
                              disabled={!selectedSite?.id}
                              onClick={() =>
                                setRepeatRule((r) => ({
                                  ...r,
                                  monthDays: checked
                                    ? r.monthDays.filter((x) => x !== n)
                                    : [...r.monthDays, n].sort((a, b) => a - b),
                                }))
                              }
                              className={`rounded-md border px-1 py-2 text-[11px] tabular-nums ${
                                checked
                                  ? 'border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950'
                                  : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900'
                              }`}
                            >
                              {n}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={!selectedSite?.id || isSavingRule}
                      onClick={async () => {
                        if (!selectedSite?.id) return;
                        setIsSavingRule(true);
                        try {
                          await fetch('/api/sites/repeat-rule', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ siteId: selectedSite.id, repeatRule }),
                          });
                        } finally {
                          setIsSavingRule(false);
                        }
                      }}
                      className="w-full rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                    >
                      {isSavingRule ? '保存中…' : 'リピートを保存'}
                    </button>

                    <div>
                      <div className="text-xs text-zinc-600 dark:text-zinc-400">自動入力の対象月</div>
                      <input
                        type="month"
                        value={autoFillMonth}
                        onChange={(e) => setAutoFillMonth(e.target.value)}
                        className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                      />
                    </div>

                    <div className="rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-black dark:text-zinc-300">
                      {autoFillPreview.status === 'no-site' ? (
                        <span>プレビュー: 現場を選択してください</span>
                      ) : autoFillPreview.status === 'invalid-month' ? (
                        <span>プレビュー: 対象月が不正です</span>
                      ) : autoFillPreview.status === 'interval-mismatch' ? (
                        <span>プレビュー: ペース対象外の月です</span>
                      ) : autoFillPreview.status === 'no-repeat' ? (
                        <span>プレビュー: リピート条件が未設定です</span>
                      ) : (
                        <span>
                          プレビュー: {autoFillPreview.targets.length}日（
                          {autoFillPreview.targets
                            .slice(0, 14)
                            .map((ymd) => {
                              const day = Number(ymd.slice(-2));
                              const wd = weekdayMon1Sun7FromYmd(ymd);
                              return `${day}(${DOW[wd - 1]})`;
                            })
                            .join('、')}
                          {autoFillPreview.targets.length > 14 ? '…' : ''}）
                        </span>
                      )}
                    </div>

                    {autoFillPreview.status === 'ok' && autoFillPreview.targets.length > 0 ? (
                      <div className="max-h-40 overflow-y-auto rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-black dark:text-zinc-300">
                        {autoFillPreview.targets.map((ymd) => {
                          const day = Number(ymd.slice(-2));
                          const wd = weekdayMon1Sun7FromYmd(ymd);
                          return (
                            <div key={ymd} className="tabular-nums">
                              {ymd}（{day}日/{DOW[wd - 1]}）
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      disabled={!selectedSite?.id || !selectedUserId || isAutoFilling}
                      onClick={async () => {
                        if (!selectedSite?.id || !selectedUserId) return;
                        setIsAutoFilling(true);
                        setAutoFillResult(null);
                        try {
                          const r = await fetch('/api/schedule/auto-fill', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({
                              userId: selectedUserId,
                              siteId: selectedSite.id,
                              month: autoFillMonth,
                            }),
                          });

                          const json = (await r.json().catch(() => null)) as
                            | { ok: true; created: number; skipped: number; reason?: string }
                            | { ok: false; error?: string }
                            | null;

                          if (json && json.ok) {
                            setAutoFillResult(json);
                          } else {
                            setAutoFillResult({
                              ok: false,
                              error: json?.error || (!r.ok ? `HTTP ${r.status}` : 'Unknown error'),
                            });
                          }

                          const res = await fetch(
                            `/api/schedule/week?weekStart=${encodeURIComponent(toYmd(weekStart))}`,
                          );
                          if (res.ok) setData((await res.json()) as ApiResponse);
                        } finally {
                          setIsAutoFilling(false);
                        }
                      }}
                      className="w-full rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                    >
                      {isAutoFilling ? '自動入力中…' : '自動入力'}
                    </button>

                    <button
                      type="button"
                      disabled={!selectedSite?.id || !selectedUserId || isAutoFilling}
                      onClick={async () => {
                        if (!selectedSite?.id || !selectedUserId) return;
                        setIsAutoFilling(true);
                        setAutoFillResult(null);
                        try {
                          const weekDays = Array.from({ length: 7 }, (_, i) => toYmd(addDays(weekStart, i)));
                          const r = await fetch('/api/schedule/auto-fill', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({
                              userId: selectedUserId,
                              siteId: selectedSite.id,
                              month: autoFillMonth,
                              days: weekDays,
                            }),
                          });

                          const json = (await r.json().catch(() => null)) as
                            | { ok: true; created: number; skipped: number; reason?: string }
                            | { ok: false; error?: string }
                            | null;

                          if (json && json.ok) {
                            setAutoFillResult(json);
                          } else {
                            setAutoFillResult({
                              ok: false,
                              error: json?.error || (!r.ok ? `HTTP ${r.status}` : 'Unknown error'),
                            });
                          }

                          const res = await fetch(
                            `/api/schedule/week?weekStart=${encodeURIComponent(toYmd(weekStart))}`,
                          );
                          if (res.ok) setData((await res.json()) as ApiResponse);
                        } finally {
                          setIsAutoFilling(false);
                        }
                      }}
                      className="w-full rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                    >
                      {isAutoFilling ? '自動入力中…' : '自動入力（今週）'}
                    </button>

                    <button
                      type="button"
                      disabled={!selectedSite?.id || isAutoFilling || (data?.users?.length ?? 0) === 0}
                      onClick={async () => {
                        if (!selectedSite?.id) return;
                        const users = data?.users ?? [];
                        if (users.length === 0) return;
                        setIsAutoFilling(true);
                        setAutoFillResult(null);
                        let createdSum = 0;
                        let skippedSum = 0;
                        let errorCount = 0;
                        try {
                          for (const u of users) {
                            const r = await fetch('/api/schedule/auto-fill', {
                              method: 'POST',
                              headers: { 'content-type': 'application/json' },
                              body: JSON.stringify({
                                userId: u.id,
                                siteId: selectedSite.id,
                                month: autoFillMonth,
                              }),
                            });
                            const json = (await r.json().catch(() => null)) as
                              | { ok: true; created: number; skipped: number }
                              | { ok: false; error?: string }
                              | null;

                            if (r.ok && json && json.ok) {
                              createdSum += json.created;
                              skippedSum += json.skipped;
                            } else {
                              errorCount += 1;
                            }
                          }

                          setAutoFillResult({
                            ok: true,
                            created: createdSum,
                            skipped: skippedSum,
                            reason: errorCount > 0 ? `一部失敗: ${errorCount}人` : undefined,
                          });

                          const res = await fetch(
                            `/api/schedule/week?weekStart=${encodeURIComponent(toYmd(weekStart))}`,
                          );
                          if (res.ok) setData((await res.json()) as ApiResponse);
                        } finally {
                          setIsAutoFilling(false);
                        }
                      }}
                      className="w-full rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                    >
                      {isAutoFilling ? '自動入力中…' : '自動入力（全員）'}
                    </button>

                    {autoFillResult ? (
                      <div
                        className={`rounded-md border px-2 py-2 text-xs ${
                          autoFillResult.ok
                            ? 'border-zinc-200 bg-white text-zinc-600 dark:border-zinc-800 dark:bg-black dark:text-zinc-300'
                            : 'border-red-200 bg-white text-red-700 dark:border-red-900 dark:bg-black dark:text-red-300'
                        }`}
                      >
                        {autoFillResult.ok ? (
                          <span>
                            結果: created={autoFillResult.created}, skipped={autoFillResult.skipped}
                            {autoFillResult.reason ? `, reason=${autoFillResult.reason}` : ''}
                          </span>
                        ) : (
                          <span>エラー: {autoFillResult.error}</span>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {modeTabs}
                <WeekGrid
                  dayLabels={dayLabels}
                  data={data}
                  weekStart={weekStart}
                  monthWeekTabs={monthWeekTabs}
                  onSelectWeekStart={setWeekStartByDate}
                  onPrevMonth={goPrevMonth}
                  onNextMonth={goNextMonth}
                  onToday={() => setCursorDate(new Date())}
                  selectedSite={selectedSite}
                  cellClickAction={cellClickAction}
                  selectedUserId={selectedUserId}
                  onSelectUser={setSelectedUserId}
                  onNotify={showCellActionMsg}
                  onCellHistory={pushHistory}
                  onAssigned={async () => {
                    // Refresh week after an assignment
                    try {
                      const res = await fetch(
                        `/api/schedule/week?weekStart=${encodeURIComponent(toYmd(weekStart))}`,
                      );
                      if (res.ok) setData((await res.json()) as ApiResponse);
                    } catch {
                      // ignore
                    }
                  }}
                />
              </div>
            </>
          ) : mode === 'month' ? (
            <>
              <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-black">
                <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">現場リスト</div>
                <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  現場を選択 → 月表のセルをクリックで入力
                </div>

                <div className="mt-3">
                  <div className="text-xs text-zinc-600 dark:text-zinc-400">バッジ月（償却カウント）</div>
                  <input
                    type="month"
                    value={deprMonth}
                    onChange={(e) => setDeprMonth(e.target.value)}
                    className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                  />
                </div>

                <div className="mt-3 max-h-[calc(100vh-56px-240px)] overflow-y-auto">
                  {sites.length === 0 ? (
                    <div className="py-3 text-xs text-zinc-500 dark:text-zinc-400">
                      まだ候補がありません（過去データから自動で出ます）。
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {sites.map((s) => {
                        const active = selectedSite?.label === s.label;
                        const badge = s.id ? siteDeprMap[s.id] : undefined;
                        return (
                          <button
                            key={s.id ?? s.label}
                            type="button"
                            onClick={() =>
                              setSelectedSite((cur) => (cur?.label === s.label ? null : s))
                            }
                            className={`w-full rounded-md border px-2 py-2 text-left text-xs ${
                              active
                                ? 'border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950'
                                : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex-1 truncate">{s.label}</div>
                              {badge ? (
                                <span
                                  className={`rounded-md border px-1.5 py-0.5 text-[10px] tabular-nums ${
                                    badge.alert
                                      ? 'border-red-200 text-red-700 dark:border-red-900 dark:text-red-300'
                                      : 'border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300'
                                  }`}
                                  title={`今月(${deprMonth}): ${badge.count}件 / 閾値 ${badge.threshold}`}
                                >
                                  {badge.count}
                                </span>
                              ) : null}
                              {s.label.includes('!') ? (
                                <span className="ml-2 text-red-600 dark:text-red-400">!</span>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                  選択中: {selectedSite?.label ?? '（なし）'}
                </div>

                <button
                  type="button"
                  disabled={!selectedSite}
                  onClick={() => setSiteDetailOpen(true)}
                  className="mt-2 w-full rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                >
                  現場詳細（償却カウント）
                </button>
              </div>

              <div className="space-y-3">
                {modeTabs}
                <MonthGrid
                  dayLabels={monthDayLabels}
                  data={monthData}
                  selectedSite={selectedSite}
                  cellClickAction={cellClickAction}
                  selectedUserId={selectedUserId}
                  onSelectUser={setSelectedUserId}
                  onNotify={showCellActionMsg}
                  onCellHistory={pushHistory}
                  onAssigned={async () => {
                    try {
                      const res = await fetch(
                        `/api/schedule/month?month=${encodeURIComponent(viewMonth)}`,
                      );
                      if (res.ok) setMonthData((await res.json()) as MonthApiResponse);
                    } catch {
                      // ignore
                    }
                  }}
                />
              </div>
            </>
          ) : mode === 'year' ? (
            <>
              <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-black">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">年予定（サマリ）</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">{viewYear}年</div>
                </div>
                <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  従業員×12ヶ月。各セルは「日数 / 件数」です（セルクリックで月予定へ）。
                </div>

                <div className="mt-3">
                  <div className="text-xs text-zinc-600 dark:text-zinc-400">バッジ月（償却カウント）</div>
                  <input
                    type="month"
                    value={deprMonth}
                    onChange={(e) => setDeprMonth(e.target.value)}
                    className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                  />
                </div>
              </div>

              <div className="space-y-3">
                {modeTabs}
                <YearGrid
                  data={yearData}
                  selectedUserId={selectedUserId}
                  onSelectUser={setSelectedUserId}
                  onOpenMonth={openMonthFromYear}
                />
              </div>
            </>
          ) : (
            <div className="space-y-3">
              {modeTabs}
              <div className="rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-black dark:text-zinc-300">
                表示モードが不明です。上のタブから選択してください。
              </div>
            </div>
          )}
        </div>

        {siteDetailOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <button
              type="button"
              aria-label="close"
              onClick={() => setSiteDetailOpen(false)}
              className="absolute inset-0 bg-black/40"
            />

            <div className="relative w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-black">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-zinc-900 dark:text-zinc-50">現場詳細</div>
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {selectedSite?.label ?? '（未選択）'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSiteDetailOpen(false)}
                  className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                >
                  閉じる
                </button>
              </div>

              <div className="mt-4 rounded-md border border-zinc-200 bg-white px-3 py-3 text-xs dark:border-zinc-800 dark:bg-black">
                <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">償却カウント</div>
                <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  指定月に、この現場の入力件数を集計します（閾値以上でアラート）。
                </div>

                <div className="mt-2">
                  <div className="text-xs text-zinc-600 dark:text-zinc-400">対象月</div>
                  <input
                    type="month"
                    value={deprMonth}
                    onChange={(e) => setDeprMonth(e.target.value)}
                    className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                  />
                </div>

                <div className="mt-2">
                  {deprState.status === 'idle' || deprState.status === 'loading' ? (
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">読み込み中…</div>
                  ) : deprState.status === 'error' ? (
                    <div className="text-xs text-red-700 dark:text-red-300">{deprState.message}</div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm tabular-nums text-zinc-900 dark:text-zinc-50">
                        {deprState.count}件
                      </div>
                      {deprState.alert ? (
                        <div className="rounded-md border border-red-200 bg-white px-2 py-1 text-[11px] text-red-700 dark:border-red-900 dark:bg-black dark:text-red-300">
                          アラート: {deprState.threshold}件以上
                        </div>
                      ) : (
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">OK</div>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    アラート閾値（現場ごと）
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    例: 10 → 10件以上でアラート
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <input
                      inputMode="numeric"
                      value={deprThresholdInput}
                      onChange={(e) => setDeprThresholdInput(e.target.value)}
                      className="w-28 rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs tabular-nums dark:border-zinc-800 dark:bg-black"
                      placeholder="10"
                    />
                    <button
                      type="button"
                      disabled={!selectedSite?.id}
                      onClick={async () => {
                        if (!selectedSite?.id) return;
                        setDeprSaveMsg(null);

                        const n = Number(deprThresholdInput);
                        if (!Number.isFinite(n) || n < 1 || n > 999) {
                          setDeprSaveMsg('1〜999の数値で入力してください');
                          return;
                        }

                        try {
                          const r = await fetch('/api/sites', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ id: selectedSite.id, depreciationThreshold: n }),
                          });

                          const json = (await r.json().catch(() => null)) as
                            | { ok: true }
                            | { ok: false; error?: string }
                            | null;

                          if (!r.ok || !json || !json.ok) {
                            setDeprSaveMsg((json && !json.ok ? json.error : undefined) || `HTTP ${r.status}`);
                            return;
                          }

                          setDeprSaveMsg('保存しました');

                          // Update local badge + modal state
                          setSiteDeprMap((cur) => {
                            const prev = cur[selectedSite.id!];
                            return prev
                              ? { ...cur, [selectedSite.id!]: { ...prev, threshold: n, alert: prev.count >= n } }
                              : cur;
                          });

                          setDeprState((s) =>
                            s.status === 'ok' ? { ...s, threshold: n, alert: s.count >= n } : s,
                          );
                        } catch {
                          setDeprSaveMsg('保存に失敗しました');
                        }
                      }}
                      className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                    >
                      保存
                    </button>
                  </div>

                  {deprSaveMsg ? (
                    <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{deprSaveMsg}</div>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
                現場ID: {selectedSite?.id ?? '（なし）'}
                {selectedSiteCreatedAt ? ` / 作成: ${String(selectedSiteCreatedAt).slice(0, 10)}` : ''}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WeekGrid({
  dayLabels,
  data,
  weekStart,
  monthWeekTabs,
  onSelectWeekStart,
  onPrevMonth,
  onNextMonth,
  onToday,
  selectedSite,
  cellClickAction,
  selectedUserId,
  onSelectUser,
  onNotify,
  onCellHistory,
  onAssigned,
}: {
  dayLabels: Array<{ key: string; dow: string; dayNum: number; isSat: boolean; isSun: boolean }>;
  data: ApiResponse | null;
  weekStart: Date;
  monthWeekTabs: { monthKey: string; tabs: Date[] };
  onSelectWeekStart: (d: Date) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  selectedSite: SiteItem | null;
  cellClickAction: CellClickAction;
  selectedUserId: string | null;
  onSelectUser: (userId: string | null) => void;
  onNotify?: (msg: string | null) => void;
  onCellHistory?: (entry: CellHistoryEntry) => void;
  onAssigned: () => void | Promise<void>;
}) {
  const users = data?.users ?? [];
  const grid = data?.grid ?? {};
  const activeWeekKey = toYmd(weekStart);
  const scrollRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedUserId) return;
    const root = scrollRootRef.current;
    if (!root) return;

    const candidates = Array.from(root.querySelectorAll<HTMLElement>('[data-user-row]'));
    const hit = candidates.find((el) => el.dataset.userRow === selectedUserId);
    if (!hit) return;
    hit.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [selectedUserId, users.length]);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black">
      <div ref={scrollRootRef} className="overflow-x-auto">
        <div
          className="grid"
          style={{
            gridTemplateColumns: 'minmax(120px, 180px) repeat(7, minmax(0, 1fr))',
          }}
        >
          {/* Header row */}
          <div className="pointer-events-none sticky left-0 top-[calc(var(--app-header-h)+var(--mode-tabs-h))] z-30 border-b border-r border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-black dark:text-zinc-300">
            従業員
          </div>
          {dayLabels.map((d) => (
            <div
              key={d.key}
              className={`pointer-events-none sticky top-[calc(var(--app-header-h)+var(--mode-tabs-h))] z-20 border-b border-l border-zinc-200 bg-white px-2 py-2 text-xs font-medium dark:border-zinc-800 dark:bg-black ${
                d.isSun
                  ? 'text-red-600 dark:text-red-400'
                  : d.isSat
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-zinc-600 dark:text-zinc-300'
              }`}
            >
              <div className="flex items-center gap-1">
                <span className="tabular-nums">{d.dayNum}</span>
                <span>{d.dow}</span>
              </div>
            </div>
          ))}

          {/* Rows */}
          {users.length === 0 ? (
            <div className="col-span-8 px-3 py-6 text-sm text-zinc-500 dark:text-zinc-400">
              従業員が未登録、またはデータ取得に失敗しました。
            </div>
          ) : (
            users.map((u) => {
              const isSelectedUser = selectedUserId === u.id;
              return (
                <Row
                  key={u.id}
                  user={u}
                  dayLabels={dayLabels}
                  grid={grid[u.id] ?? {}}
                  selectedSite={selectedSite}
                  selectedUserId={selectedUserId}
                  cellClickAction={cellClickAction}
                  onSelectUser={onSelectUser}
                  onNotify={onNotify}
                  onCellHistory={onCellHistory}
                  onAssigned={onAssigned}
                  rowCellClassName={
                    isSelectedUser ? 'bg-zinc-50 dark:bg-zinc-950' : 'bg-white dark:bg-black'
                  }
                />
              );
            })
          )}
        </div>

        {/* Month week-start tabs: sticky bottom-left inside the grid scroll area */}
        <div className="sticky bottom-0 left-0 z-20 border-t border-zinc-200 bg-white/90 px-2 py-2 text-xs backdrop-blur dark:border-zinc-800 dark:bg-black/90">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onPrevMonth}
                className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                aria-label="前の月"
              >
                ←
              </button>

              <div className="flex items-center gap-1 overflow-x-auto rounded-md border border-zinc-200 bg-white/60 px-2 py-1 dark:border-zinc-800 dark:bg-black/60">
                {monthWeekTabs.tabs.map((t) => {
                  const k = toYmd(t);
                  const active = k === activeWeekKey;
                  const label = `${t.getMonth() + 1}/${t.getDate()}`;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => onSelectWeekStart(t)}
                      className={`rounded-md border px-2 py-1 text-[11px] tabular-nums ${
                        active
                          ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-black'
                          : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
                      }`}
                      aria-current={active ? 'true' : undefined}
                      title={k}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={onNextMonth}
                className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                aria-label="次の月"
              >
                →
              </button>
            </div>

            <button
              type="button"
              onClick={onToday}
              className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
            >
              今週
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MonthGrid({
  dayLabels,
  data,
  selectedSite,
  cellClickAction,
  selectedUserId,
  onSelectUser,
  onNotify,
  onCellHistory,
  onAssigned,
}: {
  dayLabels: Array<{ key: string; dow: string; dayNum: number; isSat: boolean; isSun: boolean }>;
  data: MonthApiResponse | null;
  selectedSite: SiteItem | null;
  cellClickAction: CellClickAction;
  selectedUserId: string | null;
  onSelectUser: (userId: string | null) => void;
  onNotify?: (msg: string | null) => void;
  onCellHistory?: (entry: CellHistoryEntry) => void;
  onAssigned: () => void | Promise<void>;
}) {
  const users = data?.users ?? [];
  const grid = data?.grid ?? {};
  const scrollRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedUserId) return;
    const root = scrollRootRef.current;
    if (!root) return;

    const candidates = Array.from(root.querySelectorAll<HTMLElement>('[data-user-row]'));
    const hit = candidates.find((el) => el.dataset.userRow === selectedUserId);
    if (!hit) return;
    hit.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [selectedUserId, users.length]);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black">
      <div ref={scrollRootRef} className="overflow-x-auto">
        <div
          className="grid"
          style={{
            gridTemplateColumns: `minmax(120px, 180px) repeat(${Math.max(dayLabels.length, 1)}, minmax(0, 1fr))`,
          }}
        >
          <div className="pointer-events-none sticky left-0 top-[calc(var(--app-header-h)+var(--mode-tabs-h))] z-30 border-b border-r border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-black dark:text-zinc-300">
            従業員
          </div>

          {dayLabels.map((d) => (
            <div
              key={d.key}
              className={`pointer-events-none sticky top-[calc(var(--app-header-h)+var(--mode-tabs-h))] z-20 border-b border-l border-zinc-200 bg-white px-2 py-2 text-xs font-medium dark:border-zinc-800 dark:bg-black ${
                d.isSun
                  ? 'text-red-600 dark:text-red-400'
                  : d.isSat
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-zinc-600 dark:text-zinc-300'
              }`}
            >
              <div className="flex items-center gap-1">
                <span className="tabular-nums">{d.dayNum}</span>
                <span>{d.dow}</span>
              </div>
            </div>
          ))}

          {users.length === 0 ? (
            <div
              className="px-3 py-6 text-sm text-zinc-500 dark:text-zinc-400"
              style={{ gridColumn: `span ${Math.max(dayLabels.length + 1, 2)}` }}
            >
              従業員が未登録、またはデータ取得に失敗しました。
            </div>
          ) : (
            users.map((u) => {
              const isSelectedUser = selectedUserId === u.id;
              return (
                <Row
                  key={u.id}
                  user={u}
                  dayLabels={dayLabels}
                  grid={grid[u.id] ?? {}}
                  selectedSite={selectedSite}
                  selectedUserId={selectedUserId}
                  cellClickAction={cellClickAction}
                  onSelectUser={onSelectUser}
                  onNotify={onNotify}
                  onCellHistory={onCellHistory}
                  onAssigned={onAssigned}
                  rowCellClassName={
                    isSelectedUser ? 'bg-zinc-50 dark:bg-zinc-950' : 'bg-white dark:bg-black'
                  }
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function YearGrid({
  data,
  selectedUserId,
  onSelectUser,
  onOpenMonth,
}: {
  data: YearSummaryApiResponse | null;
  selectedUserId: string | null;
  onSelectUser: (userId: string | null) => void;
  onOpenMonth: (month: string, userId: string) => void;
}) {
  const users = data?.users ?? [];
  const months = data?.months ?? [];
  const grid = data?.grid ?? {};
  const scrollRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedUserId) return;
    const root = scrollRootRef.current;
    if (!root) return;

    const candidates = Array.from(root.querySelectorAll<HTMLElement>('[data-user-row]'));
    const hit = candidates.find((el) => el.dataset.userRow === selectedUserId);
    if (!hit) return;
    hit.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [selectedUserId, users.length]);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black">
      <div ref={scrollRootRef} className="overflow-x-auto">
        <div
          className="grid"
          style={{
            gridTemplateColumns: `minmax(120px, 180px) repeat(${Math.max(months.length, 1)}, minmax(0, 1fr))`,
          }}
        >
          <div className="pointer-events-none sticky left-0 top-[calc(var(--app-header-h)+var(--mode-tabs-h))] z-30 border-b border-r border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-black dark:text-zinc-300">
            従業員
          </div>

          {months.map((m) => {
            const mm = Number(m.slice(-2));
            return (
              <div
                key={m}
                className="pointer-events-none sticky top-[calc(var(--app-header-h)+var(--mode-tabs-h))] z-20 border-b border-l border-zinc-200 bg-white px-2 py-2 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-black dark:text-zinc-300"
              >
                <div className="flex items-center gap-1">
                  <span className="tabular-nums">{mm}</span>
                  <span>月</span>
                </div>
              </div>
            );
          })}

          {users.length === 0 ? (
            <div
              className="px-3 py-6 text-sm text-zinc-500 dark:text-zinc-400"
              style={{ gridColumn: `span ${Math.max(months.length + 1, 2)}` }}
            >
              従業員が未登録、またはデータ取得に失敗しました。
            </div>
          ) : (
            users.map((u) => {
              const isSelectedUser = selectedUserId === u.id;
              return (
                <Fragment key={u.id}>
                  <button
                    key={`${u.id}-name`}
                    type="button"
                    onClick={() => onSelectUser(isSelectedUser ? null : u.id)}
                    aria-current={isSelectedUser ? 'true' : undefined}
                    data-user-row={u.id}
                    data-testid={`user-row-${u.id}`}
                    className={`sticky left-0 z-10 border-b border-r border-zinc-200 px-2 py-2 text-left text-[13px] dark:border-zinc-800 ${
                      isSelectedUser ? 'bg-zinc-50 dark:bg-zinc-950' : 'bg-white dark:bg-black'
                    }`}
                  >
                    <div className="truncate font-medium">{u.name ?? u.email ?? u.id}</div>
                  </button>

                  {months.map((m) => {
                    const cell = grid[u.id]?.[m] ?? { days: 0, entries: 0 };
                    return (
                      <button
                        key={`${u.id}-${m}`}
                        type="button"
                        onClick={() => onOpenMonth(m, u.id)}
                        className={`border-b border-l border-zinc-200 px-2 py-2 text-left text-xs dark:border-zinc-800 ${
                          isSelectedUser ? 'bg-zinc-50 dark:bg-zinc-950' : ''
                        }`}
                        title={`${m}の月予定へ（${cell.days}日 / ${cell.entries}件）`}
                        data-testid={`year-cell-${u.id}-${m}`}
                      >
                        <div className="min-h-10">
                          <div className="text-zinc-800 dark:text-zinc-200">
                            <span className="tabular-nums">{cell.days}</span>日
                          </div>
                          <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                            <span className="tabular-nums">{cell.entries}</span>件
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </Fragment>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  user,
  dayLabels,
  grid,
  selectedSite,
  selectedUserId,
  cellClickAction,
  onSelectUser,
  onNotify,
  onCellHistory,
  onAssigned,
  rowCellClassName,
}: {
  user: ApiUser;
  dayLabels: Array<{ key: string; dow: string; dayNum: number; isSat: boolean; isSun: boolean }>;
  grid: Record<string, ApiCell>;
  selectedSite: SiteItem | null;
  selectedUserId: string | null;
  cellClickAction: CellClickAction;
  onSelectUser: (userId: string | null) => void;
  onNotify?: (msg: string | null) => void;
  onCellHistory?: (entry: CellHistoryEntry) => void;
  onAssigned: () => void | Promise<void>;
  rowCellClassName?: string;
}) {
  const isSelectedUser = selectedUserId === user.id;

  const formatCellActionReason = (
    reason: unknown,
    action: CellClickAction,
  ): string | null => {
    if (typeof reason !== 'string') return null;
    if (reason === 'cell-full') {
      return action === 'add'
        ? '満杯のため追加できません（2枠あり）'
        : action === 'toggle'
          ? '満杯のため2枠目を置換できませんでした'
          : '満杯のため反映できません（2枠あり）';
    }
    if (reason === 'already-exists') {
      return action === 'remove' ? '削除対象がありません（未登録）' : 'すでに登録済みです';
    }
    if (reason === 'not-found') return '削除対象がありません（未登録）';
    if (reason === 'not-enough-entries') return '入替できません（2枠揃っていません）';
    return `反映できません（reason=${reason}）`;
  };

  const formatCellActionSuccess = (input: {
    action: CellClickAction;
    toggled?: unknown;
    replaced?: unknown;
  }): string => {
    if (input.action === 'swap') return '入替しました';
    if (input.replaced === 'slot2') return '2枠目を置換しました';
    if (input.action === 'remove') return '削除しました';
    if (input.action === 'add') return '追加しました';
    if (input.action === 'replace2') return '2枠目を置換しました';
    if (input.action === 'toggle') {
      return input.toggled === 'off' ? '削除しました' : '追加しました';
    }
    return '反映しました';
  };

  return (
    <>
      <button
        type="button"
        onClick={() => onSelectUser(isSelectedUser ? null : user.id)}
        data-user-row={user.id}
        data-testid={`user-row-${user.id}`}
        aria-current={isSelectedUser ? 'true' : undefined}
        className={`sticky left-0 z-10 border-b border-r border-zinc-200 bg-white px-2 py-2 text-left text-[13px] dark:border-zinc-800 dark:bg-black ${
          isSelectedUser ? 'bg-zinc-50 dark:bg-zinc-950' : ''
        }`}
      >
        <div className="truncate font-medium">{user.name ?? user.email ?? user.id}</div>
      </button>
      {dayLabels.map((d) => {
        const cell = grid[d.key];
        const slot1 = cell?.slot1 ?? null;
        const slot2 = cell?.slot2 ?? null;
        const c1 = cell?.color1 ?? 'default';
        const c2 = cell?.color2 ?? 'default';

        return (
          <button
            key={d.key}
            type="button"
            onClick={async () => {
              if (cellClickAction !== 'swap' && !selectedSite) {
                onNotify?.('現場を選択してください');
                return;
              }

              try {
                const snapshot = async (): Promise<CellSlots | null> => {
                  try {
                    const rs = await fetch(
                      `/api/schedule/cell/snapshot?userId=${encodeURIComponent(user.id)}&day=${encodeURIComponent(d.key)}`,
                    );
                    const js = (await rs.json().catch(() => null)) as
                      | { ok: true; slots: [string | null, string | null] }
                      | { ok: false; error?: string }
                      | null;
                    if (!rs.ok || !js || !('ok' in js) || js.ok !== true) return null;
                    return [js.slots?.[0] ?? null, js.slots?.[1] ?? null];
                  } catch {
                    return null;
                  }
                };

                const before = (await snapshot()) ?? [slot1, slot2];

                const r = await fetch('/api/schedule/cell', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    userId: user.id,
                    day: d.key,
                    action: cellClickAction,
                    siteId: selectedSite?.id ?? null,
                    siteName: selectedSite?.label ?? null,
                  }),
                });

                type CellApiOk = {
                  ok: true;
                  action: CellClickAction;
                  changed?: boolean;
                  reason?: unknown;
                  toggled?: unknown;
                  replaced?: unknown;
                };
                type CellApiErr = { ok: false; error?: string };
                const json = (await r.json().catch(() => null)) as CellApiOk | CellApiErr | null;

                if (!r.ok || !json || json.ok !== true) {
                  const error = json && json.ok === false ? json.error : undefined;
                  onNotify?.(
                    error ? `操作に失敗しました: ${error}` : `操作に失敗しました（HTTP ${r.status}）`,
                  );
                  return;
                }

                if (!json.changed) {
                  onNotify?.(formatCellActionReason(json.reason, cellClickAction) ?? '反映されませんでした');
                  return;
                }

                const after = await snapshot();
                if (after) {
                  onCellHistory?.({
                    kind: 'cell',
                    userId: user.id,
                    day: d.key,
                    before,
                    after,
                    at: Date.now(),
                  });
                }

                onNotify?.(
                  formatCellActionSuccess({
                    action: json.action ?? cellClickAction,
                    toggled: json.toggled,
                    replaced: json.replaced,
                  }),
                );
                await onAssigned();
              } catch {
                onNotify?.('通信に失敗しました');
              }
            }}
            className={`border-b border-l border-zinc-200 px-2 py-2 text-left text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900 ${
              rowCellClassName ?? ''
            }`}
          >
            <div className="min-h-12">
              {/* Two-slot compact layout (no extra controls yet) */}
              <div
                className={`whitespace-normal break-words text-[11px] leading-tight ${c1 === 'red' ? 'text-red-600 dark:text-red-400' : 'text-zinc-800 dark:text-zinc-200'}`}
              >
                {slot1 ?? ''}
              </div>
              <div
                className={`mt-0.5 whitespace-normal break-words text-[10px] leading-tight ${c2 === 'red' ? 'text-red-600 dark:text-red-400' : 'text-zinc-500 dark:text-zinc-400'}`}
              >
                {slot2 ?? ''}
              </div>
            </div>
          </button>
        );
      })}
    </>
  );
}
