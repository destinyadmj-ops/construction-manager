'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type WheelEvent } from 'react';
import { useHeaderActions } from './header-actions';

type ViewMode = 'week' | 'month' | 'year';

type ScheduleKind = 'normal' | 'daily';

type GridLayout = 'compact' | 'comfortable';
type CellClickAction = 'toggle' | 'add' | 'remove' | 'replace2' | 'swap' | 'recolor';
type CellTextColor = 'default' | 'red';
type CellBg = 'default' | 'soft';

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
  invoiceIssuedThisMonth?: boolean;
  reportIssuedThisMonth?: boolean;
  paceNotConsumedAlert?: boolean;
  unassignedThisMonth?: boolean;
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

function arrayEqual(a: string[], b: string[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function orderUsers(users: ApiUser[], order: string[]) {
  const filteredUsers = users.filter((u) => {
    const name = (u.name ?? '').trim();
    const email = (u.email ?? '').trim();
    return !(name === 'E2E Cell User' && email.endsWith('@example.test'));
  });

  if (!order || order.length === 0) return filteredUsers;
  const byId = new Map(filteredUsers.map((u) => [u.id, u] as const));
  const used = new Set<string>();
  const next: ApiUser[] = [];
  for (const id of order) {
    const u = byId.get(id);
    if (!u) continue;
    next.push(u);
    used.add(id);
  }
  for (const u of filteredUsers) {
    if (used.has(u.id)) continue;
    next.push(u);
  }
  return next;
}

function normalizeUserOrder(order: string[], users: ApiUser[]) {
  const set = new Set(users.map((u) => u.id));
  const filtered = order.filter((id) => set.has(id));
  const used = new Set(filtered);
  const appended = users.filter((u) => !used.has(u.id)).map((u) => u.id);
  return [...filtered, ...appended];
}

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
  return (
    <Suspense fallback={null}>
      <WeekHubInner />
    </Suspense>
  );
}

function WeekHubInner() {
  const { setAddAction, setHistoryMenu, setSaveAction, setUndoAction, setRedoAction } = useHeaderActions();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qsUserId = searchParams.get('userId');
  const [mode, setMode] = useState<ViewMode>('week');
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>('normal');
  const [gridLayout, setGridLayout] = useState<GridLayout>('compact');
  const [cursorDate, setCursorDate] = useState<Date>(() => new Date());
  const [data, setData] = useState<ApiResponse | null>(null);
  const [monthData, setMonthData] = useState<MonthApiResponse | null>(null);
  const [yearData, setYearData] = useState<YearSummaryApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [editConfigured, setEditConfigured] = useState(false);
  const [editEnabled, setEditEnabled] = useState(true);
  const [editActive, setEditActive] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [editPassword, setEditPassword] = useState('');
  const [editPasswordMsg, setEditPasswordMsg] = useState<string | null>(null);
  const [historyHover, setHistoryHover] = useState<{ userId: string; day: string } | null>(null);
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [selectedSite, setSelectedSite] = useState<SiteItem | null>(null);
  const [siteQuery, setSiteQuery] = useState('');
  const [siteQuickInput, setSiteQuickInput] = useState('');
  const [siteQuickMsg, setSiteQuickMsg] = useState<string | null>(null);
  const siteQuickInputRef = useRef<HTMLInputElement | null>(null);
  const pinSiteLabelRef = useRef<string | null>(null);
  const sitePaneScrollRef = useRef<HTMLDivElement | null>(null);
  const onSiteBannerWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    const el = sitePaneScrollRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight) return;
    e.preventDefault();
    el.scrollTop += e.deltaY;
  }, []);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  // 現場リストたたみ状態
  const [isSiteListCollapsed] = useState(false);
  // たたみ時のセル幅
  const COLLAPSED_CELL_MIN_W = 140;
  const [cellMinW, setCellMinW] = useState<number>(112);
    // 現場リストたたみ/広げ時にセル幅を自動調整
    useEffect(() => {
      if (isSiteListCollapsed) {
        setCellMinW(COLLAPSED_CELL_MIN_W);
      } else {
        setCellMinW(112);
      }
    }, [isSiteListCollapsed]);
  const [cellMinHCompact, setCellMinHCompact] = useState<number>(48);
  const [cellMinHComfortable, setCellMinHComfortable] = useState<number>(64);
  const [cellBg, setCellBg] = useState<CellBg>('default');
  const [cellClickAction, setCellClickAction] = useState<CellClickAction>('toggle');
  const [cellTextColor, setCellTextColor] = useState<CellTextColor>('default');
  const [cellActionMsg, setCellActionMsg] = useState<string | null>(null);
  const cellActionMsgTimer = useRef<number | null>(null);
  const [isCellSettingsOpen, setIsCellSettingsOpen] = useState(false);
  const cellSettingsRef = useRef<HTMLDivElement | null>(null);

  const [effectiveUserId, setEffectiveUserId] = useState<string | null>(null);
  const [userOrder, setUserOrder] = useState<string[]>([]);
  const userOrderLoadedRef = useRef(false);
  const userOrderSavingRef = useRef(false);
  const pendingUserOrderRef = useRef<string[] | null>(null);
  const [reorderMode, setReorderMode] = useState(false);

  const [undoStack, setUndoStack] = useState<CellHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<CellHistoryEntry[]>([]);
  const [isUndoRedoBusy, setIsUndoRedoBusy] = useState(false);

  const [selectedCell, setSelectedCell] = useState<{ userId: string; day: string } | null>(null);
  const [draggedSite, setDraggedSite] = useState<SiteItem | null>(null);
  const [draggedCell, setDraggedCell] = useState<{ userId: string; day: string; slots: CellSlots } | null>(null);
  const [editingCell, setEditingCell] = useState<{ userId: string; day: string; slotIndex: number } | null>(null);
  const [editingInput, setEditingInput] = useState('');
  const [siteSuggestions, setSiteSuggestions] = useState<SiteItem[]>([]);
  const [suggestionLoading, setSuggestionLoading] = useState(false);

  useEffect(() => {
    const m = searchParams.get('mode');
    if (m === 'week' || m === 'month' || m === 'year') {
      setMode(m);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!isCellSettingsOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const el = cellSettingsRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setIsCellSettingsOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [isCellSettingsOpen]);

  useEffect(() => {
    const k = (searchParams.get('kind') ?? '').toLowerCase();
    if (k === 'daily') setScheduleKind('daily');
    if (k === 'normal') setScheduleKind('normal');
  }, [searchParams]);

  useEffect(() => {
    const l = (searchParams.get('layout') ?? '').toLowerCase();
    setGridLayout(l === 'comfortable' ? 'comfortable' : 'compact');
  }, [searchParams]);

  const apiKind = useMemo(() => (scheduleKind === 'daily' ? 'DAILY' : 'NORMAL'), [scheduleKind]);
  const kindQuery = useMemo(() => `kind=${encodeURIComponent(scheduleKind)}`, [scheduleKind]);

  const gridPrefsKey = useMemo(() => {
    return `week-hub:${scheduleKind}:${mode}:gridPrefs`;
  }, [mode, scheduleKind]);

  const userOrderKey = useMemo(() => {
    return `week-hub:${scheduleKind}:userOrder`;
  }, [scheduleKind]);

  const resolveEffectiveUserId = useCallback(async () => {
    const q = (qsUserId ?? '').trim();
    if (q) {
      setEffectiveUserId(q);
      return q;
    }

    try {
      const kind = scheduleKind === 'daily' ? 'daily' : 'normal';
      const r = await fetch(`/api/users?kind=${encodeURIComponent(kind)}`);
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      const users = Array.isArray(obj?.users) ? (obj!.users as unknown[]) : [];
      const first = users[0] && typeof users[0] === 'object' ? (users[0] as Record<string, unknown>) : null;
      const id = typeof first?.id === 'string' ? first.id : null;
      setEffectiveUserId(id);
      return id;
    } catch {
      setEffectiveUserId(null);
      return null;
    }
  }, [qsUserId, scheduleKind]);

  const loadUserOrder = useCallback(
    async (userId: string | null) => {
      if (!userId) return;
      try {
        const r = await fetch(
          `/api/ui-settings?userId=${encodeURIComponent(userId)}&key=${encodeURIComponent(userOrderKey)}`,
        );
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        if (!r.ok || obj?.ok !== true) return;

        const raw = obj.value;
        const arr = Array.isArray(raw) ? (raw as unknown[]) : [];
        const parsed = arr
          .map((x) => (typeof x === 'string' ? x.trim() : ''))
          .filter((x) => x.length > 0)
          .slice(0, 1000);
        userOrderLoadedRef.current = true;
        setUserOrder(parsed);
      } catch {
        // ignore
      }
    },
    [userOrderKey],
  );

  const gridPrefsLoadedRef = useRef<Record<string, true>>({});
  const gridPrefsSaveTimerRef = useRef<number | null>(null);

  const loadGridPrefs = useCallback(async (userId: string | null, key: string) => {
    if (!userId) return;
    if (gridPrefsLoadedRef.current[key]) return;
    gridPrefsLoadedRef.current[key] = true;

    try {
      const r = await fetch(`/api/ui-settings?userId=${encodeURIComponent(userId)}&key=${encodeURIComponent(key)}`);
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) return;

      const raw = obj.value;
      const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
      if (!o) return;

      const nextLayout =
        o.gridLayout === 'comfortable' ? 'comfortable' : o.gridLayout === 'compact' ? 'compact' : null;
      if (nextLayout) setGridLayout(nextLayout);

      const nextAction =
        o.cellClickAction === 'toggle' ||
        o.cellClickAction === 'add' ||
        o.cellClickAction === 'remove' ||
        o.cellClickAction === 'replace2' ||
        o.cellClickAction === 'swap' ||
        o.cellClickAction === 'recolor'
          ? (o.cellClickAction as CellClickAction)
          : null;
      if (nextAction) setCellClickAction(nextAction);

      const nextTextColor = o.cellTextColor === 'red' ? 'red' : o.cellTextColor === 'default' ? 'default' : null;
      if (nextTextColor) setCellTextColor(nextTextColor);

      const nextBg = o.cellBg === 'soft' ? 'soft' : o.cellBg === 'default' ? 'default' : null;
      if (nextBg) setCellBg(nextBg);

      const w = typeof o.cellMinW === 'number' ? o.cellMinW : null;
      if (w && Number.isFinite(w)) {
        const clamped = Math.max(60, Math.min(240, Math.round(w)));
        setCellMinW(clamped);
      }

      const hc = typeof o.cellMinHCompact === 'number' ? o.cellMinHCompact : null;
      if (hc && Number.isFinite(hc)) {
        const clamped = Math.max(32, Math.min(120, Math.round(hc)));
        setCellMinHCompact(clamped);
      }

      const hh = typeof o.cellMinHComfortable === 'number' ? o.cellMinHComfortable : null;
      if (hh && Number.isFinite(hh)) {
        const clamped = Math.max(40, Math.min(180, Math.round(hh)));
        setCellMinHComfortable(clamped);
      }
    } catch {
      // ignore
    }
  }, []);

  const saveGridPrefs = useCallback(async (userId: string | null, key: string, value: unknown) => {
    if (!userId) return;
    try {
      await fetch('/api/ui-settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, key, value }),
      });
    } catch {
      // ignore
    }
  }, []);

  const saveUserOrder = useCallback(
    async (userId: string | null, next: string[]) => {
      if (!userId) return;
      pendingUserOrderRef.current = next;
      if (userOrderSavingRef.current) return;

      userOrderSavingRef.current = true;
      try {
        while (pendingUserOrderRef.current) {
          const v = pendingUserOrderRef.current;
          pendingUserOrderRef.current = null;
          await fetch('/api/ui-settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ userId, key: userOrderKey, value: v }),
          });
        }
      } finally {
        userOrderSavingRef.current = false;
      }
    },
    [userOrderKey],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof navigator === 'undefined') return;

    const update = () => setIsOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    fetch('/api/auth/edit-mode')
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as unknown;
        const o = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        if (!mounted) return;
        if (o?.ok !== true) return;
        setEditConfigured(o?.configured === true);
        setEditEnabled(o?.enabled === true);
      })
      .catch(() => {
        // ignore
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const uid = await resolveEffectiveUserId();
      if (!mounted) return;
      await loadUserOrder(uid);
      await loadGridPrefs(uid, gridPrefsKey);
    })();
    return () => {
      mounted = false;
    };
  }, [gridPrefsKey, loadGridPrefs, loadUserOrder, resolveEffectiveUserId]);

  useEffect(() => {
    if (!effectiveUserId) return;
    if (!gridPrefsLoadedRef.current[gridPrefsKey]) return;
    if (typeof window === 'undefined') return;

    if (gridPrefsSaveTimerRef.current) {
      window.clearTimeout(gridPrefsSaveTimerRef.current);
      gridPrefsSaveTimerRef.current = null;
    }

    const payload = {
        v: 1,
      gridLayout,
      cellClickAction,
      cellTextColor,
      cellBg,
      cellMinW,
      cellMinHCompact,
      cellMinHComfortable,
    };

    gridPrefsSaveTimerRef.current = window.setTimeout(() => {
      gridPrefsSaveTimerRef.current = null;
      void saveGridPrefs(effectiveUserId, gridPrefsKey, payload);
    }, 350);

    return () => {
      if (gridPrefsSaveTimerRef.current) {
        window.clearTimeout(gridPrefsSaveTimerRef.current);
        gridPrefsSaveTimerRef.current = null;
      }
    };
  }, [
    cellBg,
    cellClickAction,
    cellMinHCompact,
    cellMinHComfortable,
    cellMinW,
    cellTextColor,
    effectiveUserId,
    gridLayout,
    gridPrefsKey,
    saveGridPrefs,
  ]);

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

  useEffect(() => {
    if (!selectedSite?.label) return;
    setSiteQuickInput((cur) => (cur.trim() ? cur : selectedSite.label));
  }, [selectedSite?.label]);

  const normalizeSiteInputToName = useCallback((raw: string) => {
    const s = raw.trim();
    if (!s) return '';
    return s.includes(' / ') ? s.split(' / ').slice(-1)[0]!.trim() : s;
  }, []);

  const resolveSiteFromText = useCallback(
    (raw: string): SiteItem | null => {
      const s = raw.trim();
      if (!s) return null;

      const exact = sites.find((x) => x.label.trim() === s);
      if (exact) return exact;

      const suffix = ` / ${s}`;
      const bySuffix = sites.find((x) => x.label.trim().endsWith(suffix));
      if (bySuffix) return bySuffix;

      const name = normalizeSiteInputToName(s);
      if (!name) return null;

      const byName = sites.find((x) => x.label.trim() === name || x.label.trim().endsWith(` / ${name}`));
      if (byName) return byName;

      return { id: null, label: name };
    },
    [normalizeSiteInputToName, sites],
  );

  const pinSiteToTop = useCallback(
    (site: SiteItem) => {
    const label = (site?.label ?? '').trim();
    if (!label) return;

    // Keep the last pinned label so refreshSites() (which replaces sites) can re-pin.
    pinSiteLabelRef.current = label;

    setSites((cur) => {
      const idx = cur.findIndex((x) => x.label.trim() === label);
      const hit = idx >= 0 ? cur[idx]! : site;
      return idx >= 0 ? [hit, ...cur.slice(0, idx), ...cur.slice(idx + 1)] : [hit, ...cur];
    });
    setSelectedSite((cur) => {
      if (!cur) return cur;
      if (cur.label.trim() !== label) return cur;
      const upgraded = sites.find((x) => x.label.trim() === label);
      return upgraded?.id ? upgraded : cur;
    });
    },
    [sites],
  );

  const pickSiteFromInput = useCallback(async () => {
    setSiteQuickMsg(null);
    const item = resolveSiteFromText(siteQuickInput);
    if (!item) {
      setSiteQuickMsg('現場名を入力してください');
      return null;
    }
    setSelectedSite(item);
    setSiteQuickInput(item.label);
    setSiteQuery('');
    pinSiteLabelRef.current = item.label;
    pinSiteToTop(item);
    return item;
  }, [pinSiteToTop, resolveSiteFromText, siteQuickInput]);

  useEffect(() => {
    const label = pinSiteLabelRef.current;
    if (!label) return;
    // If refreshSites() replaced the list, keep the pinned item at the top.
    if (sites.length > 0 && sites[0]?.label?.trim() === label.trim()) return;
    pinSiteToTop({ id: null, label });
  }, [pinSiteToTop, sites]);

  const visibleSites = useMemo(() => {
    const q = siteQuery.trim().toLowerCase();
    if (!q) return sites;
    return sites.filter((s) => s.label.toLowerCase().includes(q));
  }, [siteQuery, sites]);

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

  const ensureSelectedSite = useCallback(async (): Promise<SiteItem | null> => {
    if (selectedSite) return selectedSite;
    const picked = await pickSiteFromInput();
    if (picked) return picked;

    try {
      siteQuickInputRef.current?.focus();
      siteQuickInputRef.current?.select();
    } catch {
      // ignore
    }
    showCellActionMsg('現場を選択するか、左の入力欄に現場名を入れて「選択」してください');
    return null;
  }, [pickSiteFromInput, selectedSite, showCellActionMsg]);

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
            { value: 'recolor' as const, label: '色', title: '選択現場の文字色を変更（追加/削除なし）' },
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

      <div className="ml-2 flex items-center gap-1">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">文字色</span>
        <select
          value={cellTextColor}
          onChange={(e) => setCellTextColor((e.target.value === 'red' ? 'red' : 'default') satisfies CellTextColor)}
          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 dark:border-zinc-800 dark:bg-black dark:text-zinc-200"
          aria-label="文字色"
        >
          <option value="default">通常</option>
          <option value="red">赤</option>
        </select>
      </div>

      <div ref={cellSettingsRef} className="relative ml-2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setIsCellSettingsOpen((v) => !v)}
          aria-expanded={isCellSettingsOpen}
          className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] text-zinc-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:text-zinc-200 dark:hover:bg-black"
        >
          設定
        </button>

        {isCellSettingsOpen ? (
          <div className="absolute left-0 top-full z-50 mt-1 w-[360px] overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-black">
            <div className="border-b border-zinc-200 px-3 py-2 text-[11px] font-medium text-zinc-800 dark:border-zinc-800 dark:text-zinc-200">
              表示（セル）
            </div>

            <div className="space-y-2 px-3 py-2 text-[11px] text-zinc-700 dark:text-zinc-200">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 whitespace-nowrap text-zinc-500 dark:text-zinc-400">├ 背景</div>
                <select
                  value={cellBg}
                  onChange={(e) => setCellBg((e.target.value === 'soft' ? 'soft' : 'default') satisfies CellBg)}
                  className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 dark:border-zinc-800 dark:bg-black dark:text-zinc-200"
                  aria-label="背景"
                >
                  <option value="default">白</option>
                  <option value="soft">薄</option>
                </select>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 whitespace-nowrap text-zinc-500 dark:text-zinc-400">├ 高さ</div>
                <select
                  value={gridLayout}
                  onChange={(e) =>
                    setGridLayout((e.target.value === 'comfortable' ? 'comfortable' : 'compact') satisfies GridLayout)
                  }
                  className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 dark:border-zinc-800 dark:bg-black dark:text-zinc-200"
                  aria-label="高さ"
                >
                  <option value="compact">低</option>
                  <option value="comfortable">高</option>
                </select>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 whitespace-nowrap text-zinc-500 dark:text-zinc-400">├ 低(px)</div>
                <select
                  value={String(cellMinHCompact)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setCellMinHCompact(Number.isFinite(n) ? n : 48);
                  }}
                  className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 dark:border-zinc-800 dark:bg-black dark:text-zinc-200"
                  aria-label="低(px)"
                >
                  <option value="40">40</option>
                  <option value="48">48</option>
                  <option value="56">56</option>
                </select>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 whitespace-nowrap text-zinc-500 dark:text-zinc-400">├ 高(px)</div>
                <select
                  value={String(cellMinHComfortable)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setCellMinHComfortable(Number.isFinite(n) ? n : 64);
                  }}
                  className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 dark:border-zinc-800 dark:bg-black dark:text-zinc-200"
                  aria-label="高(px)"
                >
                  <option value="56">56</option>
                  <option value="64">64</option>
                  <option value="80">80</option>
                </select>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 whitespace-nowrap text-zinc-500 dark:text-zinc-400">└ 幅</div>
                <select
                  value={String(cellMinW)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setCellMinW(Number.isFinite(n) ? n : 112);
                  }}
                  className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] text-zinc-700 dark:border-zinc-800 dark:bg-black dark:text-zinc-200"
                  aria-label="幅"
                >
                  <option value="84">狭</option>
                  <option value="112">標準</option>
                  <option value="140">広</option>
                </select>
              </div>
            </div>
          </div>
        ) : null}
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
  const [contactNameInput, setContactNameInput] = useState('');
  const [contactSaveMsg, setContactSaveMsg] = useState<string | null>(null);
  const [isSavingContact, setIsSavingContact] = useState(false);

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

  const userLabelById = useMemo(() => {
    const pools: ApiUser[] = [
      ...(data?.users ?? []),
      ...(monthData?.users ?? []),
      ...(yearData?.users ?? []),
    ];
    const map = new Map<string, string>();
    for (const u of pools) {
      map.set(u.id, u.name ?? u.email ?? u.id);
    }
    return map;
  }, [data?.users, monthData?.users, yearData?.users]);

  const currentUsersForOrder = useMemo(() => {
    if (mode === 'week') return data?.users ?? [];
    if (mode === 'month') return monthData?.users ?? [];
    return yearData?.users ?? [];
  }, [data?.users, mode, monthData?.users, yearData?.users]);

  useEffect(() => {
    if (!userOrderLoadedRef.current) return;
    if (!effectiveUserId) return;
    const next = normalizeUserOrder(userOrder, currentUsersForOrder);
    if (arrayEqual(next, userOrder)) return;
    setUserOrder(next);
    void saveUserOrder(effectiveUserId, next);
  }, [currentUsersForOrder, effectiveUserId, saveUserOrder, userOrder]);

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  useEffect(() => {
    if (mode !== 'week') return;

    const controller = new AbortController();
    queueMicrotask(() => setIsLoading(true));

    fetch(`/api/schedule/week?weekStart=${encodeURIComponent(toYmd(weekStart))}&${kindQuery}`, {
      signal: controller.signal,
    })
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
  }, [kindQuery, mode, weekStart]);

  const viewMonth = useMemo(() => {
    return `${cursorDate.getFullYear()}-${pad2(cursorDate.getMonth() + 1)}`;
  }, [cursorDate]);

  const viewYear = useMemo(() => cursorDate.getFullYear(), [cursorDate]);

  const refreshCurrentView = useCallback(async () => {
    try {
      if (mode === 'week') {
        const res = await fetch(`/api/schedule/week?weekStart=${encodeURIComponent(toYmd(weekStart))}&${kindQuery}`);
        if (res.ok) setData((await res.json()) as ApiResponse);
        return;
      }
      if (mode === 'month') {
        const res = await fetch(`/api/schedule/month?month=${encodeURIComponent(viewMonth)}&${kindQuery}`);
        if (res.ok) setMonthData((await res.json()) as MonthApiResponse);
        return;
      }
      if (mode === 'year') {
        const res = await fetch(
          `/api/schedule/year/summary?year=${encodeURIComponent(String(viewYear))}&${kindQuery}`,
        );
        if (res.ok) setYearData((await res.json()) as YearSummaryApiResponse);
      }
    } catch {
      // ignore
    }
  }, [kindQuery, mode, viewMonth, viewYear, weekStart]);

  const createUser = useCallback(
    async (input: { name: string; email: string }) => {
      const name = input.name.trim();
      const email = input.email.trim();
      if (!name && !email) return { ok: false as const, error: '名前 または メールが必要です' };

      try {
        const r = await fetch('/api/users', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: name || null,
            email: email || null,
            kind: apiKind,
          }),
        });
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        if (!r.ok || obj?.ok !== true) {
          const msg = typeof obj?.error === 'string' ? (obj.error as string) : `HTTP ${r.status}`;
          return { ok: false as const, error: msg };
        }

        const user = obj.user && typeof obj.user === 'object' ? (obj.user as Record<string, unknown>) : null;
        const userId = typeof user?.id === 'string' ? user.id : null;
        if (!userId) return { ok: false as const, error: 'Invalid response' };

        setUserOrder((cur) => {
          const next = cur.includes(userId) ? cur : [...cur, userId];
          queueMicrotask(() => void saveUserOrder(effectiveUserId, next));
          return next;
        });

        try {
          window.dispatchEvent(
            new CustomEvent('masterHub:dataChanged', {
              detail: { kind: 'user', action: 'created', targetKind: scheduleKind },
            }),
          );
        } catch {
          // ignore
        }

        await refreshCurrentView();
        return { ok: true as const, userId };
      } catch {
        return { ok: false as const, error: '作成に失敗しました' };
      }
    },
    [apiKind, effectiveUserId, refreshCurrentView, saveUserOrder, scheduleKind],
  );

  const deleteUser = useCallback(
    async (userId: string) => {
      const label = userLabelById.get(userId) ?? userId;
      if (!window.confirm(`「${label}」を削除しますか？`)) return;

      try {
        const r = await fetch(`/api/users?id=${encodeURIComponent(userId)}`, {
          method: 'DELETE',
        });
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        if (!r.ok || obj?.ok !== true) {
          const msg = typeof obj?.error === 'string' ? (obj.error as string) : `HTTP ${r.status}`;
          showCellActionMsg(`削除に失敗しました: ${msg}`);
          return;
        }

        if (selectedUserId === userId) {
          setSelectedUserId(null);
        }

        setUserOrder((cur) => {
          const next = cur.filter((id) => id !== userId);
          if (effectiveUserId && effectiveUserId !== userId) {
            queueMicrotask(() => void saveUserOrder(effectiveUserId, next));
          }
          return next;
        });

        await refreshCurrentView();
        showCellActionMsg('削除しました');
      } catch {
        showCellActionMsg('削除に失敗しました');
      }
    },
    [effectiveUserId, refreshCurrentView, saveUserOrder, selectedUserId, showCellActionMsg, userLabelById],
  );

  const refreshSites = useCallback(async () => {
    try {
      const r = await fetch(`/api/sites?month=${encodeURIComponent(deprMonth)}&kind=${scheduleKind}`);
      if (!r.ok) return;
      const json = (await r.json()) as {
        ok: true;
        sites: Array<{
          id: string;
          companyName?: string | null;
          name: string;
          invoiceIssuedThisMonth?: boolean;
          reportIssuedThisMonth?: boolean;
          paceNotConsumedAlert?: boolean;
          unassignedThisMonth?: boolean;
        }>;
      };
      if (!json?.ok) return;
      setSites(json.sites.map((s) => {
        const label = s.companyName ? `${s.companyName} / ${s.name}` : s.name;
        return {
          id: s.id,
          label,
          invoiceIssuedThisMonth: s.invoiceIssuedThisMonth,
          reportIssuedThisMonth: s.reportIssuedThisMonth,
          paceNotConsumedAlert: s.paceNotConsumedAlert,
          unassignedThisMonth: s.unassignedThisMonth,
        };
      }));
    } catch {
      // ignore
    }
  }, [deprMonth, scheduleKind]);

  useEffect(() => {
    void refreshSites();
  }, [refreshSites]);

  useEffect(() => {
    const onChanged = (ev: Event) => {
      const e = ev as CustomEvent<
        | { kind: 'user' | 'site'; action: 'created'; targetKind: 'normal' | 'daily' }
        | undefined
      >;
      const d = e.detail;
      if (!d || d.action !== 'created') return;
      if (d.targetKind !== scheduleKind) return;

      if (d.kind === 'user') {
        void refreshCurrentView();
        return;
      }
      if (d.kind === 'site') {
        void refreshSites();
        return;
      }
    };

    window.addEventListener('masterHub:dataChanged', onChanged as EventListener);
    return () => window.removeEventListener('masterHub:dataChanged', onChanged as EventListener);
  }, [refreshCurrentView, refreshSites, scheduleKind]);

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
          kind: apiKind,
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
  }, [apiKind, refreshCurrentView, showCellActionMsg]);

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

  const searchSites = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSiteSuggestions([]);
      return;
    }
    setSuggestionLoading(true);
    try {
      const r = await fetch(`/api/sites?search=${encodeURIComponent(query)}`);
      const json = (await r.json().catch(() => null)) as unknown;
      const obj = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) {
        setSiteSuggestions([]);
        return;
      }
      const raw = Array.isArray(obj.sites) ? obj.sites : [];
      const parsed = raw
        .map((x) => {
          const o = x && typeof x === 'object' ? (x as Record<string, unknown>) : null;
          const id = typeof o?.id === 'string' ? o.id : null;
          const name = typeof o?.name === 'string' ? o.name : null;
          if (!id || !name) return null;
          return { id, label: name } as SiteItem;
        })
        .filter((x): x is SiteItem => !!x);
      setSiteSuggestions(parsed.slice(0, 10));
    } catch {
      setSiteSuggestions([]);
    } finally {
      setSuggestionLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void searchSites(editingInput);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [editingInput, searchSites]);

  useEffect(() => {
    if (!editingCell) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // 入力フィールドまたは候補リスト内のクリックは無視
      if (target.closest('input') || target.closest('[data-suggestion-list]')) return;
      setEditingCell(null);
      setEditingInput('');
      setSiteSuggestions([]);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [editingCell]);

  useEffect(() => {
    if (mode !== 'month') return;

    const controller = new AbortController();
    queueMicrotask(() => setIsLoading(true));

    fetch(`/api/schedule/month?month=${encodeURIComponent(viewMonth)}&${kindQuery}`, { signal: controller.signal })
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
  }, [kindQuery, mode, viewMonth]);

  useEffect(() => {
    if (mode !== 'year') return;

    const controller = new AbortController();
    queueMicrotask(() => setIsLoading(true));

    fetch(`/api/schedule/year/summary?year=${encodeURIComponent(String(viewYear))}&${kindQuery}`, {
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
  }, [kindQuery, mode, viewYear]);

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
      `/api/sites/depreciation-count?siteId=${encodeURIComponent(selectedSite.id)}&month=${encodeURIComponent(deprMonth)}&${kindQuery}`,
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
  }, [deprMonth, kindQuery, selectedSite?.id, siteDetailOpen]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/schedule/sites?${kindQuery}`, { signal: controller.signal })
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
  }, [kindQuery]);

  useEffect(() => {
    const ids = sites.map((s) => s.id).filter((x): x is string => Boolean(x));
    if (ids.length === 0) {
      setSiteDeprMap({});
      return;
    }

    const controller = new AbortController();
    fetch(`/api/sites/depreciation-counts?month=${encodeURIComponent(deprMonth)}&${kindQuery}`, {
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
  }, [deprMonth, kindQuery, sites]);

  useEffect(() => {
    if (!selectedSite?.id) return;
    const controller = new AbortController();
    fetch('/api/sites', { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) return null;
        return (await r.json()) as {
          ok: true;
          sites: Array<{ id: string; repeatRule: unknown; createdAt: string | Date; contactName?: string | null }>;
        };
      })
      .then((json) => {
        if (!json?.ok) return;
        const found = json.sites.find((s) => s.id === selectedSite.id);
        setSelectedSiteCreatedAt(found?.createdAt ? String(found.createdAt) : null);
        setContactNameInput(typeof found?.contactName === 'string' ? found.contactName : '');
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

  const autoFillUserIdByContact = useMemo(() => {
    const contact = contactNameInput.trim();
    if (!contact) return null;

    const users = data?.users ?? monthData?.users ?? yearData?.users ?? [];
    if (users.length === 0) return null;

    const hitByName = users.find((u) => (u.name ?? '').trim() === contact);
    if (hitByName) return hitByName.id;

    const lower = contact.toLowerCase();
    const hitByEmail = users.find((u) => (u.email ?? '').trim().toLowerCase() === lower);
    return hitByEmail?.id ?? null;
  }, [contactNameInput, data?.users, monthData?.users, yearData?.users]);

  const effectiveAutoFillUserId = selectedUserId ?? autoFillUserIdByContact;

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
          {/* タブ切替UI: 週/月/年 */}
          {[
            { key: 'week', label: '週予定' },
            { key: 'month', label: '月予定' },
            { key: 'year', label: '年予定' },
          ].map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setMode(tab.key as ViewMode)}
              className={`rounded-md border px-2 py-1 text-xs ${
                mode === tab.key
                  ? 'border-blue-500 bg-blue-600 text-white dark:border-blue-400 dark:bg-blue-800'
                  : 'border-zinc-200 bg-white/60 text-zinc-700 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:text-zinc-200 dark:hover:bg-black'
              }`}
            >
              {tab.label}
            </button>
          ))}

          <div className="ml-2 flex min-w-0 flex-1 items-center gap-2 text-xs">
            <span className="text-zinc-500 dark:text-zinc-400">従業員:</span>
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

            <button
              type="button"
              onClick={() => setReorderMode((v) => !v)}
              className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
              aria-pressed={reorderMode}
            >
              {reorderMode ? '並べ替え: ON' : '並べ替え'}
            </button>

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
              <div className="px-1 text-xs tabular-nums text-zinc-600 dark:text-zinc-300" data-testid="modebar-month">
                {viewMonth}
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

  const beginEdit = useCallback(() => {
    setEditPasswordMsg(null);
    if (editEnabled) {
      setEditActive(true);
      return;
    }
    setShowEditPassword(true);
  }, [editEnabled]);

  const submitEditPassword = useCallback(async () => {
    setEditPasswordMsg(null);
    try {
      const r = await fetch('/api/auth/edit-mode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: editPassword }),
      });
      const j = (await r.json().catch(() => null)) as unknown;
      const o = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || o?.ok !== true) {
        const msg = typeof o?.error === 'string' ? (o.error as string) : `HTTP ${r.status}`;
        setEditPasswordMsg(msg);
        return;
      }
      setEditEnabled(true);
      setShowEditPassword(false);
      setEditPassword('');
      setEditActive(true);
    } catch {
      setEditPasswordMsg('通信に失敗しました');
    }
  }, [editPassword]);

  useEffect(() => {
    setAddAction({
      onClick: beginEdit,
      disabled: editActive,
      title: editEnabled ? '編集を開始' : editConfigured ? '編集（パスワード）' : '編集',
    });

    setSaveAction(
      editActive
        ? {
            onClick: () => setEditActive(false),
            disabled: false,
            title: '編集を終了',
          }
        : undefined,
    );

    setHistoryMenu(
      undoStack.length > 0
        ? {
            items: [...undoStack]
              .slice(-40)
              .reverse()
              .map((h) => ({
                key: `${h.at}:${h.userId}:${h.day}`,
                at: h.at,
                editorLabel: userLabelById.get(h.userId) ?? h.userId,
                siteLabel: `${(h.after[0] ?? h.before[0] ?? '').trim() || '（空）'} (${h.day})`,
                hover: { userId: h.userId, day: h.day },
              })),
            onHover: (hover) => setHistoryHover(hover),
          }
        : undefined,
    );

    return () => {
      setAddAction(undefined);
      setSaveAction(undefined);
      setHistoryMenu(undefined);
    };
  }, [beginEdit, editActive, editConfigured, editEnabled, setAddAction, setHistoryMenu, setSaveAction, undoStack, userLabelById]);

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
  }, [isUndoRedoBusy, redo, redoStack.length, setRedoAction, setUndoAction, undo, undoStack.length]);

  return (
    <div className="min-h-[calc(100vh-56px)] bg-zinc-50 text-zinc-900 dark:bg-black dark:text-zinc-50">
      <div className="w-full px-4 py-4 lg:px-6">
        {isOffline ? (
          <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-black dark:text-zinc-400">
            オフラインのため、表示が古い可能性があります。
          </div>
        ) : null}

        {showEditPassword ? (
          <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-black">
            <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200">編集パスワード</div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">この端末で編集を有効にします。</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                className="w-64 rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                placeholder="パスワード"
              />
              <button
                type="button"
                onClick={() => void submitEditPassword()}
                className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
              >
                OK
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowEditPassword(false);
                  setEditPassword('');
                  setEditPasswordMsg(null);
                }}
                className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
              >
                キャンセル
              </button>
            </div>
            {editPasswordMsg ? (
              <div className="mt-2 text-xs text-red-700 dark:text-red-300">{editPasswordMsg}</div>
            ) : null}
          </div>
        ) : null}
        {/* Main content */}
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[360px_1fr]">
          {mode === 'week' ? (
            <>
              <div className="hidden lg:block rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-black lg:sticky lg:top-[calc(var(--app-header-h)+var(--mode-tabs-h,0px))] lg:max-h-[calc(100vh-var(--app-header-h)-var(--mode-tabs-h,0px))] lg:self-start lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden">
                <div onWheel={onSiteBannerWheel}>
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">現場リスト</div>
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    現場を選択 → 週表のセルをクリックで入力
                  </div>

                  <div className="mt-3 rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black">
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">検索</div>
                    <input
                      value={siteQuery}
                      onChange={(e) => setSiteQuery(e.target.value)}
                      placeholder="現場名で絞り込み"
                      className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                    />

                    <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">現場（既存/新規）</div>
                    <div className="mt-1 flex gap-2">
                      <input
                        ref={siteQuickInputRef}
                        value={siteQuickInput}
                        onChange={(e) => setSiteQuickInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          void pickSiteFromInput();
                        }}
                        placeholder="例: ○○現場  または  会社 / ○○現場"
                        className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                      />
                      <button
                        type="button"
                        onClick={() => void pickSiteFromInput()}
                        className="shrink-0 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                      >
                        選択
                      </button>
                    </div>
                    {siteQuickMsg ? (
                      <div className="mt-2 text-[11px] text-red-700 dark:text-red-300">{siteQuickMsg}</div>
                    ) : null}
                  </div>
                </div>

                <div
                  ref={sitePaneScrollRef}
                  className="mt-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] text-zinc-600 dark:text-zinc-400">バッジ月（償却）</div>
                    <input
                      type="month"
                      value={deprMonth}
                      onChange={(e) => setDeprMonth(e.target.value)}
                      className="w-36 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-800 dark:bg-black"
                    />
                  </div>

                  <div
                    className="mt-2 max-h-96 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-black"
                  >
                    {sites.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                        まだ候補がありません（過去データから自動で出ます）。
                      </div>
                    ) : visibleSites.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-zinc-500 dark:text-zinc-400">該当する現場がありません。</div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {visibleSites.map((s) => {
                          const active = selectedSite?.label === s.label;
                          const badge = s.id ? siteDeprMap[s.id] : undefined;
                          return (
                            <button
                              key={s.id ?? s.label}
                              type="button"
                              draggable={editConfigured}
                              onDragStart={(e) => {
                                if (!editConfigured) return;
                                setDraggedSite(s);
                                e.dataTransfer.effectAllowed = 'copy';
                              }}
                              onDragEnd={() => setDraggedSite(null)}
                              onClick={() => {
                                if (active && s.id) {
                                  const sp = new URLSearchParams({ kind: scheduleKind });
                                  if (selectedUserId) sp.set('userId', selectedUserId);
                                  router.push(`/site-ledger/${encodeURIComponent(s.id)}?${sp.toString()}`);
                                  return;
                                }
                                setSelectedSite(s);
                              }}
                              className={`w-full rounded-md border px-2 py-2 text-left text-xs ${
                                active
                                  ? 'border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950'
                                  : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900'
                              } ${editConfigured ? 'cursor-move' : ''}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 flex-1 truncate">
                                  {s.label.includes(' / ') ? s.label.split(' / ').slice(1).join(' / ') : s.label}
                                  {s.label.includes('!') ? (
                                    <span className="ml-2 text-red-600 dark:text-red-400">!</span>
                                  ) : null}
                                </div>
                                <div className="flex items-center gap-1">
                                  {s.invoiceIssuedThisMonth === false ? (
                                    <span
                                      className="h-2.5 w-2.5 rounded-full bg-red-500 dark:bg-red-600"
                                      title="請求未発行"
                                    />
                                  ) : null}
                                  {s.reportIssuedThisMonth === false ? (
                                    <span
                                      className="h-2.5 w-2.5 rounded-full bg-yellow-500 dark:bg-yellow-600"
                                      title="報告未発行"
                                    />
                                  ) : null}
                                  {s.unassignedThisMonth ? (
                                    <span
                                      className="h-2.5 w-2.5 rounded-full bg-green-500 dark:bg-green-600"
                                      title="未配置"
                                    />
                                  ) : null}
                                  {badge ? (
                                    <span
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (!s.id) return;
                                        setSelectedSite(s);
                                        setSiteDetailOpen(true);
                                      }}
                                      className={`rounded-md border px-1.5 py-0.5 text-[10px] tabular-nums ${
                                        badge.alert
                                          ? 'border-red-200 text-red-700 dark:border-red-900 dark:text-red-300'
                                          : 'border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300'
                                      }`}
                                      title={`今月(${deprMonth}): ${badge.count}件 / 月回数 ${badge.threshold}`}
                                    >
                                      {badge.count}
                                    </span>
                                  ) : null}
                                </div>
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

                  {selectedSite?.id ? (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const siteId = selectedSite.id;
                          if (!siteId) return;
                          const sp = new URLSearchParams({ kind: scheduleKind });
                          if (selectedUserId) sp.set('userId', selectedUserId);
                          router.push(`/site-ledger/${encodeURIComponent(siteId)}?${sp.toString()}#punch`);
                        }}
                        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                      >
                        打刻
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const siteId = selectedSite.id;
                          if (!siteId) return;
                          const sp = new URLSearchParams({ kind: scheduleKind });
                          if (selectedUserId) sp.set('userId', selectedUserId);
                          router.push(`/site-ledger/${encodeURIComponent(siteId)}?${sp.toString()}#photos`);
                        }}
                        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                      >
                        写真
                      </button>
                    </div>
                  ) : null}

                  <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                    選択中の現場をもう一度クリックで詳細へ
                  </div>

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
                            body: JSON.stringify({ name, kind: apiKind }),
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
                    ペース
                  </div>
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    選択した現場のペース条件（ツリー）を設定します。
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
                        {isSavingRule ? '保存中…' : 'ペースを保存'}
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
                        <span>プレビュー: ペース条件が未設定です</span>
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
                      disabled={!selectedSite?.id || !effectiveAutoFillUserId || isAutoFilling}
                      onClick={async () => {
                        if (!selectedSite?.id || !effectiveAutoFillUserId) return;
                        setIsAutoFilling(true);
                        setAutoFillResult(null);
                        try {
                          const r = await fetch('/api/schedule/auto-fill', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({
                              userId: effectiveAutoFillUserId,
                              siteId: selectedSite.id,
                              month: autoFillMonth,
                              kind: apiKind,
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
                            `/api/schedule/week?weekStart=${encodeURIComponent(toYmd(weekStart))}&${kindQuery}`,
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
                      disabled={!selectedSite?.id || !effectiveAutoFillUserId || isAutoFilling}
                      onClick={async () => {
                        if (!selectedSite?.id || !effectiveAutoFillUserId) return;
                        setIsAutoFilling(true);
                        setAutoFillResult(null);
                        try {
                          const weekDays = Array.from({ length: 7 }, (_, i) => toYmd(addDays(weekStart, i)));
                          const r = await fetch('/api/schedule/auto-fill', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({
                              userId: effectiveAutoFillUserId,
                              siteId: selectedSite.id,
                              month: autoFillMonth,
                              days: weekDays,
                              kind: apiKind,
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
                            `/api/schedule/week?weekStart=${encodeURIComponent(toYmd(weekStart))}&${kindQuery}`,
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
                                kind: apiKind,
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
                            `/api/schedule/week?weekStart=${encodeURIComponent(toYmd(weekStart))}&${kindQuery}`,
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
              </div>

              <div className="space-y-3">
                {modeTabs}
                <WeekGrid
                  dayLabels={dayLabels}
                  data={data}
                  weekStart={weekStart}
                  monthWeekTabs={monthWeekTabs}
                  apiKind={apiKind}
                  scheduleKind={scheduleKind}
                  gridLayout={gridLayout}
                  cellMinW={cellMinW}
                  cellMinHCompact={cellMinHCompact}
                  cellMinHComfortable={cellMinHComfortable}
                  cellBg={cellBg}
                  onSelectWeekStart={setWeekStartByDate}
                  onPrevMonth={goPrevMonth}
                  onNextMonth={goNextMonth}
                  onToday={() => setCursorDate(new Date())}
                  selectedSite={selectedSite}
                  onEnsureSite={ensureSelectedSite}
                  cellClickAction={cellClickAction}
                  cellTextColor={cellTextColor}
                  isEditable={editActive}
                  selectedUserId={selectedUserId}
                  onSelectUser={setSelectedUserId}
                  onNotify={showCellActionMsg}
                  onCellHistory={pushHistory}
                  historyHover={historyHover}
                  onAssigned={async () => {
                    if (selectedSite?.label) {
                      pinSiteLabelRef.current = selectedSite.label;
                      pinSiteToTop(selectedSite);
                    }
                    // Refresh week after an assignment
                    try {
                      const res = await fetch(
                        `/api/schedule/week?weekStart=${encodeURIComponent(toYmd(weekStart))}&${kindQuery}`,
                      );
                      if (res.ok) setData((await res.json()) as ApiResponse);
                    } catch {
                      // ignore
                    }
                  }}
                  userOrder={userOrder}
                  reorderMode={reorderMode}
                  onMoveUser={(userId, dir) => {
                    setUserOrder((cur) => {
                      const i = cur.indexOf(userId);
                      if (i < 0) return cur;
                      const j = i + dir;
                      if (j < 0 || j >= cur.length) return cur;
                      const next = [...cur];
                      const tmp = next[i];
                      next[i] = next[j];
                      next[j] = tmp;
                      queueMicrotask(() => void saveUserOrder(effectiveUserId, next));
                      return next;
                    });
                  }}
                  onDeleteUser={deleteUser}
                  onCreateUser={createUser}
                  draggedSite={draggedSite}
                  selectedCell={selectedCell}
                  onSetSelectedCell={setSelectedCell}
                  draggedCell={draggedCell}
                  onSetDraggedCell={setDraggedCell}
                  editingCell={editingCell}
                  setEditingCell={setEditingCell}
                  editingInput={editingInput}
                  setEditingInput={setEditingInput}
                  siteSuggestions={siteSuggestions}
                  setSiteSuggestions={setSiteSuggestions}
                  suggestionLoading={suggestionLoading}
                />
              </div>
            </>
          ) : mode === 'month' ? (
            <>
              <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-black lg:sticky lg:top-[calc(var(--app-header-h)+var(--mode-tabs-h,0px))] lg:max-h-[calc(100vh-var(--app-header-h)-var(--mode-tabs-h,0px))] lg:self-start lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden">
                <div onWheel={onSiteBannerWheel}>
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">現場リスト</div>
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    現場を選択 → 月表のセルをクリックで入力
                  </div>

                  <div className="mt-3 rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black">
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">検索</div>
                    <input
                      value={siteQuery}
                      onChange={(e) => setSiteQuery(e.target.value)}
                      placeholder="現場名で絞り込み"
                      className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                    />

                    <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">現場（既存/新規）</div>
                    <div className="mt-1 flex gap-2">
                      <input
                        ref={siteQuickInputRef}
                        value={siteQuickInput}
                        onChange={(e) => setSiteQuickInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          void pickSiteFromInput();
                        }}
                        placeholder="例: ○○現場  または  会社 / ○○現場"
                        className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                      />
                      <button
                        type="button"
                        onClick={() => void pickSiteFromInput()}
                        className="shrink-0 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                      >
                        選択
                      </button>
                    </div>
                    {siteQuickMsg ? (
                      <div className="mt-2 text-[11px] text-red-700 dark:text-red-300">{siteQuickMsg}</div>
                    ) : null}
                  </div>
                </div>

                <div
                  ref={sitePaneScrollRef}
                  className="mt-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] text-zinc-600 dark:text-zinc-400">バッジ月（償却）</div>
                    <input
                      type="month"
                      value={deprMonth}
                      onChange={(e) => setDeprMonth(e.target.value)}
                      className="w-36 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-800 dark:bg-black"
                    />
                  </div>

                  <div
                    className="mt-2 max-h-96 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-black"
                  >
                    {sites.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                        まだ候補がありません（過去データから自動で出ます）。
                      </div>
                    ) : visibleSites.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-zinc-500 dark:text-zinc-400">該当する現場がありません。</div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {visibleSites.map((s) => {
                          const active = selectedSite?.label === s.label;
                          const badge = s.id ? siteDeprMap[s.id] : undefined;
                          return (
                            <button
                              key={s.id ?? s.label}
                              type="button"
                              draggable={editConfigured}
                              onDragStart={(e) => {
                                if (!editConfigured) return;
                                setDraggedSite(s);
                                e.dataTransfer.effectAllowed = 'copy';
                              }}
                              onDragEnd={() => setDraggedSite(null)}
                              onClick={() => {
                                if (active && s.id) {
                                  const sp = new URLSearchParams({ kind: scheduleKind });
                                  if (selectedUserId) sp.set('userId', selectedUserId);
                                  router.push(`/site-ledger/${encodeURIComponent(s.id)}?${sp.toString()}`);
                                  return;
                                }
                                setSelectedSite(s);
                              }}
                              className={`w-full rounded-md border px-2 py-2 text-left text-xs ${
                                active
                                  ? 'border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950'
                                  : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900'
                              } ${editConfigured ? 'cursor-move' : ''}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 flex-1 truncate">
                                  {s.label.includes(' / ') ? s.label.split(' / ').slice(1).join(' / ') : s.label}
                                </div>
                                <div className="flex items-center gap-1">
                                  {s.invoiceIssuedThisMonth === false ? (
                                    <span
                                      className="h-2.5 w-2.5 rounded-full bg-red-500 dark:bg-red-600"
                                      title="請求未発行"
                                    />
                                  ) : null}
                                  {s.reportIssuedThisMonth === false ? (
                                    <span
                                      className="h-2.5 w-2.5 rounded-full bg-yellow-500 dark:bg-yellow-600"
                                      title="報告未発行"
                                    />
                                  ) : null}
                                  {s.unassignedThisMonth ? (
                                    <span
                                      className="h-2.5 w-2.5 rounded-full bg-green-500 dark:bg-green-600"
                                      title="未配置"
                                    />
                                  ) : null}
                                  {badge ? (
                                    <span
                                      className={`rounded-md border px-1.5 py-0.5 text-[10px] tabular-nums ${
                                        badge.alert
                                          ? 'border-red-200 text-red-700 dark:border-red-900 dark:text-red-300'
                                          : 'border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300'
                                      }`}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (!s.id) return;
                                        setSelectedSite(s);
                                        setSiteDetailOpen(true);
                                      }}
                                      title={`今月(${deprMonth}): ${badge.count}件 / 月回数 ${badge.threshold}`}
                                    >
                                      {badge.count}
                                    </span>
                                  ) : null}
                                  {s.label.includes('!') ? (
                                    <span className="ml-2 text-red-600 dark:text-red-400">!</span>
                                  ) : null}
                                </div>
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

                  {selectedSite?.id ? (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const siteId = selectedSite.id;
                          if (!siteId) return;
                          const sp = new URLSearchParams({ kind: scheduleKind });
                          if (selectedUserId) sp.set('userId', selectedUserId);
                          router.push(`/site-ledger/${encodeURIComponent(siteId)}?${sp.toString()}#punch`);
                        }}
                        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                      >
                        打刻
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const siteId = selectedSite.id;
                          if (!siteId) return;
                          const sp = new URLSearchParams({ kind: scheduleKind });
                          if (selectedUserId) sp.set('userId', selectedUserId);
                          router.push(`/site-ledger/${encodeURIComponent(siteId)}?${sp.toString()}#photos`);
                        }}
                        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                      >
                        写真
                      </button>
                    </div>
                  ) : null}

                  <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                    選択中の現場をもう一度クリックで詳細へ
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {modeTabs}
                <MonthGrid
                  monthKey={viewMonth}
                  onPrevMonth={goPrevMonth}
                  onNextMonth={goNextMonth}
                  onToday={() => setWeekStartByDate(new Date())}
                  dayLabels={monthDayLabels}
                  data={monthData}
                  apiKind={apiKind}
                  scheduleKind={scheduleKind}
                  gridLayout={gridLayout}
                  cellMinW={cellMinW}
                  cellMinHCompact={cellMinHCompact}
                  cellMinHComfortable={cellMinHComfortable}
                  cellBg={cellBg}
                  selectedSite={selectedSite}
                  onEnsureSite={ensureSelectedSite}
                  cellClickAction={cellClickAction}
                  cellTextColor={cellTextColor}
                  isEditable={editActive}
                  selectedUserId={selectedUserId}
                  onSelectUser={setSelectedUserId}
                  onNotify={showCellActionMsg}
                  onCellHistory={pushHistory}
                  historyHover={historyHover}
                  onAssigned={async () => {
                    if (selectedSite?.label) {
                      pinSiteLabelRef.current = selectedSite.label;
                      pinSiteToTop(selectedSite);
                    }
                    try {
                      const res = await fetch(
                        `/api/schedule/month?month=${encodeURIComponent(viewMonth)}&${kindQuery}`,
                      );
                      if (res.ok) setMonthData((await res.json()) as MonthApiResponse);
                    } catch {
                      // ignore
                    }
                  }}
                  userOrder={userOrder}
                  reorderMode={reorderMode}
                  onMoveUser={(userId, dir) => {
                    setUserOrder((cur) => {
                      const i = cur.indexOf(userId);
                      if (i < 0) return cur;
                      const j = i + dir;
                      if (j < 0 || j >= cur.length) return cur;
                      const next = [...cur];
                      const tmp = next[i];
                      next[i] = next[j];
                      next[j] = tmp;
                      queueMicrotask(() => void saveUserOrder(effectiveUserId, next));
                      return next;
                    });
                  }}
                  onDeleteUser={deleteUser}
                  onCreateUser={createUser}
                />
              </div>
            </>
          ) : mode === 'year' ? (
            <>
              <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-black lg:sticky lg:top-[calc(var(--app-header-h)+var(--mode-tabs-h,0px))] lg:max-h-[calc(100vh-var(--app-header-h)-var(--mode-tabs-h,0px))] lg:self-start lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden">
                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">年予定（サマリ）</div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">{viewYear}年</div>
                  </div>
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    従業員×12ヶ月。各セルは「日数 / 件数」です（セルクリックで月予定へ）。
                  </div>
                </div>

                <div
                  ref={sitePaneScrollRef}
                  className="mt-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] text-zinc-600 dark:text-zinc-400">バッジ月（償却）</div>
                    <input
                      type="month"
                      value={deprMonth}
                      onChange={(e) => setDeprMonth(e.target.value)}
                      className="w-36 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-800 dark:bg-black"
                    />
                  </div>

                  <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">現場リスト</div>
                  <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">現場を選択 → 同じ現場を再クリックで詳細へ</div>

                  <div className="mt-3 rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black">
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">検索</div>
                    <input
                      value={siteQuery}
                      onChange={(e) => setSiteQuery(e.target.value)}
                      placeholder="現場名で絞り込み"
                      className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                    />

                    <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">現場（既存/新規）</div>
                    <div className="mt-1 flex gap-2">
                      <input
                        ref={siteQuickInputRef}
                        value={siteQuickInput}
                        onChange={(e) => setSiteQuickInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          void pickSiteFromInput();
                        }}
                        placeholder="例: ○○現場  または  会社 / ○○現場"
                        className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                      />
                      <button
                        type="button"
                        onClick={() => void pickSiteFromInput()}
                        className="shrink-0 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                      >
                        選択
                      </button>
                    </div>
                    {siteQuickMsg ? (
                      <div className="mt-2 text-[11px] text-red-700 dark:text-red-300">{siteQuickMsg}</div>
                    ) : null}
                  </div>

                  <div className="mt-3 max-h-96 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-black">
                    {sites.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                        まだ候補がありません（過去データから自動で出ます）。
                      </div>
                    ) : visibleSites.length === 0 ? (
                      <div className="px-2 py-3 text-xs text-zinc-500 dark:text-zinc-400">該当する現場がありません。</div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {visibleSites.map((s) => {
                          const active = selectedSite?.label === s.label;
                          const badge = s.id ? siteDeprMap[s.id] : undefined;
                          return (
                            <button
                              key={s.id ?? s.label}
                              type="button"
                              draggable={editConfigured}
                              onDragStart={(e) => {
                                if (!editConfigured) return;
                                setDraggedSite(s);
                                e.dataTransfer.effectAllowed = 'copy';
                              }}
                              onDragEnd={() => setDraggedSite(null)}
                              onClick={() => {
                                if (active && s.id) {
                                  const sp = new URLSearchParams({ kind: scheduleKind });
                                  if (selectedUserId) sp.set('userId', selectedUserId);
                                  router.push(`/site-ledger/${encodeURIComponent(s.id)}?${sp.toString()}`);
                                  return;
                                }
                                setSelectedSite(s);
                              }}
                              className={`w-full rounded-md border px-2 py-2 text-left text-xs ${
                                active
                                  ? 'border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950'
                                  : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900'
                              } ${editConfigured ? 'cursor-move' : ''}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 flex-1 truncate">
                                  {s.label.includes(' / ') ? s.label.split(' / ').slice(1).join(' / ') : s.label}
                                </div>
                                <div className="flex items-center gap-1">
                                  {s.invoiceIssuedThisMonth === false ? (
                                    <span className="h-2.5 w-2.5 rounded-full bg-red-500 dark:bg-red-600" title="請求未発行" />
                                  ) : null}
                                  {s.reportIssuedThisMonth === false ? (
                                    <span className="h-2.5 w-2.5 rounded-full bg-yellow-500 dark:bg-yellow-600" title="報告未発行" />
                                  ) : null}
                                  {s.unassignedThisMonth ? (
                                    <span className="h-2.5 w-2.5 rounded-full bg-green-500 dark:bg-green-600" title="未配置" />
                                  ) : null}
                                  {badge ? (
                                    <span
                                      className={`rounded-md border px-1.5 py-0.5 text-[10px] tabular-nums ${
                                        badge.alert
                                          ? 'border-red-200 text-red-700 dark:border-red-900 dark:text-red-300'
                                          : 'border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300'
                                      }`}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (!s.id) return;
                                        setSelectedSite(s);
                                        setSiteDetailOpen(true);
                                      }}
                                      title={`今月(${deprMonth}): ${badge.count}件 / 月回数 ${badge.threshold}`}
                                    >
                                      {badge.count}
                                    </span>
                                  ) : null}
                                </div>
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
                </div>

                  {selectedSite?.id ? (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const siteId = selectedSite.id;
                          if (!siteId) return;
                          const sp = new URLSearchParams({ kind: scheduleKind });
                          if (selectedUserId) sp.set('userId', selectedUserId);
                          router.push(`/site-ledger/${encodeURIComponent(siteId)}?${sp.toString()}#punch`);
                        }}
                        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                      >
                        打刻
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const siteId = selectedSite.id;
                          if (!siteId) return;
                          const sp = new URLSearchParams({ kind: scheduleKind });
                          if (selectedUserId) sp.set('userId', selectedUserId);
                          router.push(`/site-ledger/${encodeURIComponent(siteId)}?${sp.toString()}#photos`);
                        }}
                        className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                      >
                        写真
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="space-y-3">
                {modeTabs}
                <YearGrid
                  data={yearData}
                  selectedUserId={selectedUserId}
                  onSelectUser={setSelectedUserId}
                  onOpenMonth={openMonthFromYear}
                  userOrder={userOrder}
                  reorderMode={reorderMode}
                  gridLayout={gridLayout}
                  cellMinW={cellMinW}
                  cellMinHCompact={cellMinHCompact}
                  cellMinHComfortable={cellMinHComfortable}
                  cellBg={cellBg}
                  onMoveUser={(userId, dir) => {
                    setUserOrder((cur) => {
                      const i = cur.indexOf(userId);
                      if (i < 0) return cur;
                      const j = i + dir;
                      if (j < 0 || j >= cur.length) return cur;
                      const next = [...cur];
                      const tmp = next[i];
                      next[i] = next[j];
                      next[j] = tmp;
                      queueMicrotask(() => void saveUserOrder(effectiveUserId, next));
                      return next;
                    });
                  }}
                  onDeleteUser={deleteUser}
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
                <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">担当者</div>
                <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  自動入力の対象にも使います（従業員名/メールに一致した場合）。
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <input
                    value={contactNameInput}
                    onChange={(e) => {
                      setContactSaveMsg(null);
                      setContactNameInput(e.target.value);
                    }}
                    placeholder="例: 山田太郎"
                    className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                  />
                  <button
                    type="button"
                    disabled={!selectedSite?.id || isSavingContact}
                    onClick={async () => {
                      if (!selectedSite?.id) return;
                      setContactSaveMsg(null);

                      const v = contactNameInput.trim();
                      setIsSavingContact(true);
                      try {
                        const r = await fetch('/api/sites', {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ id: selectedSite.id, contactName: v || null }),
                        });

                        const json = (await r.json().catch(() => null)) as
                          | { ok: true }
                          | { ok: false; error?: string }
                          | null;

                        if (!r.ok || !json || !json.ok) {
                          setContactSaveMsg((json && !json.ok ? json.error : undefined) || `HTTP ${r.status}`);
                          return;
                        }

                        setContactSaveMsg('保存しました');
                      } catch {
                        setContactSaveMsg('保存に失敗しました');
                      } finally {
                        setIsSavingContact(false);
                      }
                    }}
                    className="shrink-0 rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                  >
                    {isSavingContact ? '保存中…' : '保存'}
                  </button>
                </div>

                {contactSaveMsg ? (
                  <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{contactSaveMsg}</div>
                ) : null}
              </div>

              <div className="mt-4 rounded-md border border-zinc-200 bg-white px-3 py-3 text-xs dark:border-zinc-800 dark:bg-black">
                <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">償却カウント</div>
                <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  指定月に、この現場の入力件数を集計します（月回数以上でアラート）。
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
                    アラート月回数（現場ごと）
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
  apiKind,
  scheduleKind,
  gridLayout,
  cellMinW,
  cellMinHCompact,
  cellMinHComfortable,
  cellBg,
  onSelectWeekStart,
  onPrevMonth,
  onNextMonth,
  onToday,
  selectedSite,
  onEnsureSite,
  cellClickAction,
  cellTextColor,
  isEditable,
  selectedUserId,
  onSelectUser,
  onNotify,
  onCellHistory,
  onAssigned,
  historyHover,
  userOrder,
  reorderMode,
  onMoveUser,
  onDeleteUser,
  onCreateUser,
  draggedSite,
  selectedCell,
  onSetSelectedCell,
  draggedCell,
  onSetDraggedCell,
  editingCell,
  setEditingCell,
  editingInput,
  setEditingInput,
  siteSuggestions,
  setSiteSuggestions,
  suggestionLoading,
}: {
  dayLabels: Array<{ key: string; dow: string; dayNum: number; isSat: boolean; isSun: boolean }>;
  data: ApiResponse | null;
  weekStart: Date;
  monthWeekTabs: { monthKey: string; tabs: Date[] };
  apiKind: 'NORMAL' | 'DAILY';
  scheduleKind: ScheduleKind;
  gridLayout: GridLayout;
  cellMinW: number;
  cellMinHCompact: number;
  cellMinHComfortable: number;
  cellBg: CellBg;
  onSelectWeekStart: (d: Date) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  selectedSite: SiteItem | null;
  onEnsureSite: () => Promise<SiteItem | null>;
  cellClickAction: CellClickAction;
  cellTextColor: CellTextColor;
  isEditable: boolean;
  selectedUserId: string | null;
  onSelectUser: (userId: string | null) => void;
  onNotify?: (msg: string | null) => void;
  onCellHistory?: (entry: CellHistoryEntry) => void;
  onAssigned: () => void | Promise<void>;
  historyHover: { userId: string; day: string } | null;
  userOrder: string[];
  reorderMode: boolean;
  onMoveUser: (userId: string, dir: -1 | 1) => void;
  onDeleteUser: (userId: string) => void | Promise<void>;
  onCreateUser: (
    input: { name: string; email: string },
  ) => Promise<{ ok: true; userId: string } | { ok: false; error: string }>;
  draggedSite: SiteItem | null;
  selectedCell: { userId: string; day: string } | null;
  onSetSelectedCell: (cell: { userId: string; day: string } | null) => void;
  draggedCell: { userId: string; day: string; slots: CellSlots } | null;
  onSetDraggedCell: (cell: { userId: string; day: string; slots: CellSlots } | null) => void;
  editingCell: { userId: string; day: string; slotIndex: number } | null;
  setEditingCell: (cell: { userId: string; day: string; slotIndex: number } | null) => void;
  editingInput: string;
  setEditingInput: (value: string) => void;
  siteSuggestions: SiteItem[];
  setSiteSuggestions: (suggestions: SiteItem[]) => void;
  suggestionLoading: boolean;
}) {
  const users = useMemo(() => orderUsers(data?.users ?? [], userOrder), [data?.users, userOrder]);
  const grid = data?.grid ?? {};
  const activeWeekKey = toYmd(weekStart);
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef<0 | 1>(0);

  const weekTabsRef = useRef<HTMLDivElement | null>(null);
  const [weekTabsH, setWeekTabsH] = useState(0);

  useEffect(() => {
    const el = weekTabsRef.current;
    if (!el) return;

    const apply = () => {
      const h = Math.max(0, Math.round(el.getBoundingClientRect().height));
      setWeekTabsH((prev) => (prev === h ? prev : h));
    };

    const raf = window.requestAnimationFrame(apply);
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    window.addEventListener('resize', apply);
    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, [monthWeekTabs.monthKey]);

  const headerTop = useMemo(() => {
    return `calc(var(--app-header-h) + var(--mode-tabs-h) + ${weekTabsH}px)`;
  }, [weekTabsH]);

  const cellMinH = useMemo(() => {
    return gridLayout === 'comfortable' ? cellMinHComfortable : cellMinHCompact;
  }, [cellMinHCompact, cellMinHComfortable, gridLayout]);

  useEffect(() => {
    if (!selectedUserId) return;
    const root = scrollRootRef.current;
    if (!root) return;

    const candidates = Array.from(root.querySelectorAll<HTMLElement>('[data-user-row]'));
    const hit = candidates.find((el) => el.dataset.userRow === selectedUserId);
    if (!hit) return;
    hit.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [selectedUserId, users.length]);

  const syncScrollLeft = useCallback((from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to) return;
    const left = from.scrollLeft;
    if (to.scrollLeft !== left) to.scrollLeft = left;
  }, []);

  const onHeaderScroll = useCallback(() => {
    if (syncingRef.current) return;
    syncingRef.current = 1;
    syncScrollLeft(headerScrollRef.current, scrollRootRef.current);
    window.requestAnimationFrame(() => {
      syncingRef.current = 0;
    });
  }, [syncScrollLeft]);

  const onBodyScroll = useCallback(() => {
    if (syncingRef.current) return;
    syncingRef.current = 1;
    syncScrollLeft(scrollRootRef.current, headerScrollRef.current);
    window.requestAnimationFrame(() => {
      syncingRef.current = 0;
    });
  }, [syncScrollLeft]);

  return (
    <div
      className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black"
      data-testid="week-grid"
    >
      {/* Week switch tabs: sticky at the top (viewport) */}
      <div
        ref={weekTabsRef}
        className="sticky top-[calc(var(--app-header-h)+var(--mode-tabs-h))] z-40 border-b border-zinc-400 bg-white/90 px-2 py-2 text-xs backdrop-blur dark:border-zinc-600 dark:bg-black/90"
      >
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

      {/* Date header row: sticky (viewport) + horizontal-scroll synced */}
      <div className="sticky z-30 border-b border-zinc-400 dark:border-zinc-600" style={{ top: headerTop }}>
        <div
          ref={headerScrollRef}
          className="overflow-x-auto"
          onScroll={onHeaderScroll}
          data-testid="week-grid-header-scroll"
        >
          <div
            className="grid"
            style={{
              gridTemplateColumns: `minmax(120px, 180px) repeat(7, minmax(${Math.max(60, Math.round(cellMinW))}px, 1fr))`,
            }}
          >
            <div className="pointer-events-none sticky left-0 z-40 border-r border-zinc-400 bg-white px-3 py-2 text-xs font-medium text-zinc-600 dark:border-zinc-600 dark:bg-black dark:text-zinc-300" />
            {dayLabels.map((d) => (
              <div
                key={d.key}
                className={`pointer-events-none border-l border-zinc-400 bg-white px-2 py-2 text-xs font-medium dark:border-zinc-600 dark:bg-black ${
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
          </div>
        </div>
      </div>

      {/* Body: horizontal scroll */}
      <div
        ref={scrollRootRef}
        className="overflow-x-auto"
        onScroll={onBodyScroll}
        data-testid="week-grid-body-scroll"
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `minmax(120px, 180px) repeat(7, minmax(${Math.max(60, Math.round(cellMinW))}px, 1fr))`,
          }}
        >
          {users.length === 0 ? (
            <div className="col-span-8 px-3 py-6 text-sm text-zinc-500 dark:text-zinc-400">
              従業員が未登録、またはデータ取得に失敗しました。
            </div>
          ) : (
            users.map((u, idx) => {
              const isSelectedUser = selectedUserId === u.id;
              const baseBg = cellBg === 'soft' ? 'bg-zinc-50 dark:bg-zinc-950' : 'bg-white dark:bg-black';
              const selectedBg = 'bg-zinc-50 dark:bg-zinc-950';
              return (
                <Row
                  key={u.id}
                  user={u}
                  dayLabels={dayLabels}
                  grid={grid[u.id] ?? {}}
                  apiKind={apiKind}
                  scheduleKind={scheduleKind}
                  selectedSite={selectedSite}
                  onEnsureSite={onEnsureSite}
                  selectedUserId={selectedUserId}
                  cellClickAction={cellClickAction}
                  cellTextColor={cellTextColor}
                  gridLayout={gridLayout}
                  cellMinH={cellMinH}
                  isEditable={isEditable}
                  onSelectUser={onSelectUser}
                  onNotify={onNotify}
                  onCellHistory={onCellHistory}
                  onAssigned={onAssigned}
                  historyHover={historyHover}
                  reorderMode={reorderMode}
                  moveUpDisabled={idx === 0}
                  moveDownDisabled={idx === users.length - 1}
                  onMoveUp={() => onMoveUser(u.id, -1)}
                  onMoveDown={() => onMoveUser(u.id, 1)}
                  onDeleteUser={() => onDeleteUser(u.id)}
                  rowCellClassName={isSelectedUser ? selectedBg : baseBg}
                  draggedSite={draggedSite}
                  selectedCell={selectedCell}
                  onSetSelectedCell={onSetSelectedCell}
                  draggedCell={draggedCell}
                  onSetDraggedCell={onSetDraggedCell}
                  editingCell={editingCell}
                  setEditingCell={setEditingCell}
                  editingInput={editingInput}
                  setEditingInput={setEditingInput}
                  siteSuggestions={siteSuggestions}
                  setSiteSuggestions={setSiteSuggestions}
                  suggestionLoading={suggestionLoading}
                />
              );
            })
          )}

          <AddUserRow dayLabels={dayLabels} cellMinH={cellMinH} onCreateUser={onCreateUser} />
        </div>
      </div>
    </div>
  );
}

function MonthGrid({
  monthKey,
  onPrevMonth,
  onNextMonth,
  onToday,
  dayLabels,
  data,
  apiKind,
  scheduleKind,
  gridLayout,
  cellMinW,
  cellMinHCompact,
  cellMinHComfortable,
  cellBg,
  selectedSite,
  onEnsureSite,
  cellClickAction,
  cellTextColor,
  isEditable,
  selectedUserId,
  onSelectUser,
  onNotify,
  onCellHistory,
  onAssigned,
  historyHover,
  userOrder,
  reorderMode,
  onMoveUser,
  onDeleteUser,
  onCreateUser,
}: {
  monthKey: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  dayLabels: Array<{ key: string; dow: string; dayNum: number; isSat: boolean; isSun: boolean }>;
  data: MonthApiResponse | null;
  apiKind: 'NORMAL' | 'DAILY';
  scheduleKind: ScheduleKind;
  gridLayout: GridLayout;
  cellMinW: number;
  cellMinHCompact: number;
  cellMinHComfortable: number;
  cellBg: CellBg;
  selectedSite: SiteItem | null;
  onEnsureSite: () => Promise<SiteItem | null>;
  cellClickAction: CellClickAction;
  cellTextColor: CellTextColor;
  isEditable: boolean;
  selectedUserId: string | null;
  onSelectUser: (userId: string | null) => void;
  onNotify?: (msg: string | null) => void;
  onCellHistory?: (entry: CellHistoryEntry) => void;
  onAssigned: () => void | Promise<void>;
  historyHover: { userId: string; day: string } | null;
  userOrder: string[];
  reorderMode: boolean;
  onMoveUser: (userId: string, dir: -1 | 1) => void;
  onDeleteUser: (userId: string) => void | Promise<void>;
  onCreateUser: (
    input: { name: string; email: string },
  ) => Promise<{ ok: true; userId: string } | { ok: false; error: string }>;
}) {
  const users = useMemo(() => orderUsers(data?.users ?? [], userOrder), [data?.users, userOrder]);
  const grid = data?.grid ?? {};
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef<0 | 1>(0);

  const monthTabsRef = useRef<HTMLDivElement | null>(null);
  const [monthTabsH, setMonthTabsH] = useState(0);

  useEffect(() => {
    const el = monthTabsRef.current;
    if (!el) return;

    const apply = () => {
      const h = Math.max(0, Math.round(el.getBoundingClientRect().height));
      setMonthTabsH((prev) => (prev === h ? prev : h));
    };

    const raf = window.requestAnimationFrame(apply);
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    window.addEventListener('resize', apply);
    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, [monthKey]);

  const headerTop = useMemo(() => {
    return `calc(var(--app-header-h) + var(--mode-tabs-h) + ${monthTabsH}px)`;
  }, [monthTabsH]);

  const cellMinH = useMemo(() => {
    return gridLayout === 'comfortable' ? cellMinHComfortable : cellMinHCompact;
  }, [cellMinHCompact, cellMinHComfortable, gridLayout]);

  useEffect(() => {
    if (!selectedUserId) return;
    const root = scrollRootRef.current;
    if (!root) return;

    const candidates = Array.from(root.querySelectorAll<HTMLElement>('[data-user-row]'));
    const hit = candidates.find((el) => el.dataset.userRow === selectedUserId);
    if (!hit) return;
    hit.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [selectedUserId, users.length]);

  const syncScrollLeft = useCallback((from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to) return;
    const left = from.scrollLeft;
    if (to.scrollLeft !== left) to.scrollLeft = left;
  }, []);

  const onHeaderScroll = useCallback(() => {
    if (syncingRef.current) return;
    syncingRef.current = 1;
    syncScrollLeft(headerScrollRef.current, scrollRootRef.current);
    window.requestAnimationFrame(() => {
      syncingRef.current = 0;
    });
  }, [syncScrollLeft]);

  const onBodyScroll = useCallback(() => {
    if (syncingRef.current) return;
    syncingRef.current = 1;
    syncScrollLeft(scrollRootRef.current, headerScrollRef.current);
    window.requestAnimationFrame(() => {
      syncingRef.current = 0;
    });
  }, [syncScrollLeft]);

  return (
    <div
      className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black"
      data-testid="month-grid"
    >
      {/* Month switch: sticky at the top (viewport) */}
      <div
        ref={monthTabsRef}
        className="sticky top-[calc(var(--app-header-h)+var(--mode-tabs-h))] z-40 border-b border-zinc-400 bg-white/90 px-2 py-2 text-xs backdrop-blur dark:border-zinc-600 dark:bg-black/90"
      >
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
            <div className="px-1 text-xs tabular-nums text-zinc-600 dark:text-zinc-300">{monthKey}</div>
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
            今月
          </button>
        </div>
      </div>

      {/* Date header row: sticky (viewport) + horizontal-scroll synced */}
      <div className="sticky z-30 border-b border-zinc-400 dark:border-zinc-600" style={{ top: headerTop }}>
        <div
          ref={headerScrollRef}
          className="overflow-x-auto"
          onScroll={onHeaderScroll}
          data-testid="month-grid-header-scroll"
        >
          <div
            className="grid"
            style={{
              gridTemplateColumns: `minmax(120px, 180px) repeat(${Math.max(dayLabels.length, 1)}, minmax(${Math.max(60, Math.round(cellMinW))}px, 1fr))`,
            }}
          >
            <div className="pointer-events-none sticky left-0 z-40 border-r border-zinc-400 bg-white px-3 py-2 text-xs font-medium text-zinc-600 dark:border-zinc-600 dark:bg-black dark:text-zinc-300" />
            {dayLabels.map((d) => (
              <div
                key={d.key}
                className={`pointer-events-none border-l border-zinc-400 bg-white px-2 py-2 text-xs font-medium dark:border-zinc-600 dark:bg-black ${
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
          </div>
        </div>
      </div>

      {/* Body: horizontal scroll */}
      <div
        ref={scrollRootRef}
        className="overflow-x-auto"
        onScroll={onBodyScroll}
        data-testid="month-grid-body-scroll"
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `minmax(120px, 180px) repeat(${Math.max(dayLabels.length, 1)}, minmax(${Math.max(60, Math.round(cellMinW))}px, 1fr))`,
          }}
        >
          {users.length === 0 ? (
            <div
              className="px-3 py-6 text-sm text-zinc-500 dark:text-zinc-400"
              style={{ gridColumn: `span ${Math.max(dayLabels.length + 1, 2)}` }}
            >
              従業員が未登録、またはデータ取得に失敗しました。
            </div>
          ) : (
            users.map((u, idx) => {
              const isSelectedUser = selectedUserId === u.id;
              const baseBg = cellBg === 'soft' ? 'bg-zinc-50 dark:bg-zinc-950' : 'bg-white dark:bg-black';
              const selectedBg = 'bg-zinc-50 dark:bg-zinc-950';
              return (
                <Row
                  key={u.id}
                  user={u}
                  dayLabels={dayLabels}
                  grid={grid[u.id] ?? {}}
                  apiKind={apiKind}
                  scheduleKind={scheduleKind}
                  selectedSite={selectedSite}
                  onEnsureSite={onEnsureSite}
                  selectedUserId={selectedUserId}
                  cellClickAction={cellClickAction}
                  cellTextColor={cellTextColor}
                  gridLayout={gridLayout}
                  cellMinH={cellMinH}
                  isEditable={isEditable}
                  onSelectUser={onSelectUser}
                  onNotify={onNotify}
                  onCellHistory={onCellHistory}
                  onAssigned={onAssigned}
                  historyHover={historyHover}
                  reorderMode={reorderMode}
                  moveUpDisabled={idx === 0}
                  moveDownDisabled={idx === users.length - 1}
                  onMoveUp={() => onMoveUser(u.id, -1)}
                  onMoveDown={() => onMoveUser(u.id, 1)}
                  onDeleteUser={() => onDeleteUser(u.id)}
                  rowCellClassName={isSelectedUser ? selectedBg : baseBg}
                  draggedSite={null}
                />
              );
            })
          )}

          <AddUserRow dayLabels={dayLabels} cellMinH={cellMinH} onCreateUser={onCreateUser} />
        </div>
      </div>
    </div>
  );
}

function AddUserRow({
  dayLabels,
  cellMinH,
  onCreateUser,
}: {
  dayLabels: Array<{ key: string; dow: string; dayNum: number; isSat: boolean; isSun: boolean }>;
  cellMinH: number;
  onCreateUser: (
    input: { name: string; email: string },
  ) => Promise<{ ok: true; userId: string } | { ok: false; error: string }>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <div
        className="sticky left-0 z-10 border-b border-r border-zinc-400 bg-white px-2 py-2 text-left text-[12px] dark:border-zinc-600 dark:bg-black"
        style={{ minHeight: Math.max(32, Math.round(cellMinH || 0)) }}
      >
        <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">従業員追加</div>
        <div className="mt-1 flex flex-col gap-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="名前"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] dark:border-zinc-800 dark:bg-black"
            disabled={busy}
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="メール（任意）"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] dark:border-zinc-800 dark:bg-black"
            disabled={busy}
          />
          <button
            type="button"
            onClick={async () => {
              setMsg(null);
              if (busy) return;
              setBusy(true);
              try {
                const r = await onCreateUser({ name, email });
                if (!r.ok) {
                  setMsg(r.error);
                  return;
                }
                setName('');
                setEmail('');
                setMsg('追加しました');
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy || (!name.trim() && !email.trim())}
            className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
          >
            {busy ? '追加中…' : '追加'}
          </button>
          {msg ? <div className="text-[10px] text-zinc-500 dark:text-zinc-400">{msg}</div> : null}
        </div>
      </div>
      {dayLabels.map((d) => (
        <div
          key={`add-user-${d.key}`}
          className="border-b border-l border-zinc-200 bg-white px-2 py-2 text-left text-xs dark:border-zinc-800 dark:bg-black"
          style={{ minHeight: Math.max(32, Math.round(cellMinH || 0)) }}
        />
      ))}
    </>
  );
}

function YearGrid({
  data,
  selectedUserId,
  onSelectUser,
  onOpenMonth,
  userOrder,
  reorderMode,
  gridLayout,
  cellMinW,
  cellMinHCompact,
  cellMinHComfortable,
  cellBg,
  onMoveUser,
  onDeleteUser,
}: {
  data: YearSummaryApiResponse | null;
  selectedUserId: string | null;
  onSelectUser: (userId: string | null) => void;
  onOpenMonth: (month: string, userId: string) => void;
  userOrder: string[];
  reorderMode: boolean;
  gridLayout: GridLayout;
  cellMinW: number;
  cellMinHCompact: number;
  cellMinHComfortable: number;
  cellBg: CellBg;
  onMoveUser: (userId: string, dir: -1 | 1) => void;
  onDeleteUser: (userId: string) => void | Promise<void>;
}) {
  const users = useMemo(() => orderUsers(data?.users ?? [], userOrder), [data?.users, userOrder]);
  const months = data?.months ?? [];
  const grid = data?.grid ?? {};
    const cellMinH = useMemo(() => {
      return gridLayout === 'comfortable' ? cellMinHComfortable : cellMinHCompact;
    }, [cellMinHCompact, cellMinHComfortable, gridLayout]);
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef<0 | 1>(0);

  useEffect(() => {
    if (!selectedUserId) return;
    const root = scrollRootRef.current;
    if (!root) return;

    const candidates = Array.from(root.querySelectorAll<HTMLElement>('[data-user-row]'));
    const hit = candidates.find((el) => el.dataset.userRow === selectedUserId);
    if (!hit) return;
    hit.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [selectedUserId, users.length]);

  const syncScrollLeft = useCallback((from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to) return;
    const left = from.scrollLeft;
    if (to.scrollLeft !== left) to.scrollLeft = left;
  }, []);

  const onHeaderScroll = useCallback(() => {
    if (syncingRef.current) return;
    syncingRef.current = 1;
    syncScrollLeft(headerScrollRef.current, scrollRootRef.current);
    window.requestAnimationFrame(() => {
      syncingRef.current = 0;
    });
  }, [syncScrollLeft]);

  const onBodyScroll = useCallback(() => {
    if (syncingRef.current) return;
    syncingRef.current = 1;
    syncScrollLeft(scrollRootRef.current, headerScrollRef.current);
    window.requestAnimationFrame(() => {
      syncingRef.current = 0;
    });
  }, [syncScrollLeft]);

  return (
    <div
      className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black"
      data-testid="year-grid"
    >
      {/* Month header row: sticky (viewport) + horizontal-scroll synced */}
      <div
        className="sticky z-30 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black"
        style={{ top: `calc(var(--app-header-h) + var(--mode-tabs-h))` }}
      >
        <div
          ref={headerScrollRef}
          className="overflow-x-auto"
          onScroll={onHeaderScroll}
          data-testid="year-grid-header-scroll"
        >
          <div
            className="grid"
            style={{
              gridTemplateColumns: `minmax(120px, 180px) repeat(${Math.max(months.length, 1)}, minmax(${Math.max(60, Math.round(cellMinW))}px, 1fr))`,
            }}
          >
            <div className="pointer-events-none sticky left-0 z-40 border-r border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-black dark:text-zinc-300" />

            {months.map((m) => {
              const mm = Number(m.slice(-2));
              return (
                <div
                  key={m}
                  className="pointer-events-none border-l border-zinc-200 bg-white px-2 py-2 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-black dark:text-zinc-300"
                >
                  <div className="flex items-center gap-1">
                    <span className="tabular-nums">{mm}</span>
                    <span>月</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Body: horizontal scroll */}
      <div
        ref={scrollRootRef}
        className="overflow-x-auto"
        onScroll={onBodyScroll}
        data-testid="year-grid-body-scroll"
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `minmax(120px, 180px) repeat(${Math.max(months.length, 1)}, minmax(${Math.max(60, Math.round(cellMinW))}px, 1fr))`,
          }}
        >
          {users.length === 0 ? (
            <div
              className="px-3 py-6 text-sm text-zinc-500 dark:text-zinc-400"
              style={{ gridColumn: `span ${Math.max(months.length + 1, 2)}` }}
            >
              従業員が未登録、またはデータ取得に失敗しました。
            </div>
          ) : (
            users.map((u, idx) => {
              const isSelectedUser = selectedUserId === u.id;
              const baseBg = cellBg === 'soft' ? 'bg-zinc-50 dark:bg-zinc-950' : 'bg-white dark:bg-black';
              const selectedBg = 'bg-zinc-50 dark:bg-zinc-950';
              const sum = months.reduce(
                (acc, m) => {
                  const cell = grid[u.id]?.[m];
                  acc.days += cell?.days ?? 0;
                  acc.entries += cell?.entries ?? 0;
                  return acc;
                },
                { days: 0, entries: 0 },
              );
              return (
                <Fragment key={u.id}>
                  <div
                    key={`${u.id}-name`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectUser(isSelectedUser ? null : u.id)}
                    onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      onSelectUser(isSelectedUser ? null : u.id);
                    }}
                    aria-current={isSelectedUser ? 'true' : undefined}
                    data-user-row={u.id}
                    data-testid={`user-row-${u.id}`}
                    className={`sticky left-0 z-10 border-b border-r border-zinc-200 px-2 py-2 text-left text-[13px] dark:border-zinc-800 ${
                      isSelectedUser ? selectedBg : baseBg
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2" style={{ minHeight: Math.max(32, Math.round(cellMinH || 0)) }}>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{u.name ?? u.email ?? u.id}</div>
                        <div className="mt-0.5 text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">
                          合計: {sum.days}日 / {sum.entries}件
                        </div>
                      </div>
                      {reorderMode ? (
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onMoveUser(u.id, -1);
                              }}
                              className="rounded-md border border-zinc-200 bg-white/60 px-1.5 py-0.5 text-[10px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                              aria-label="上へ"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              disabled={idx === users.length - 1}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onMoveUser(u.id, 1);
                              }}
                              className="rounded-md border border-zinc-200 bg-white/60 px-1.5 py-0.5 text-[10px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                              aria-label="下へ"
                            >
                              ▼
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void onDeleteUser(u.id);
                            }}
                            className="rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
                            aria-label="削除"
                          >
                            削除
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

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
                        <div style={{ minHeight: Math.max(32, Math.round(cellMinH || 0)) }}>
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
  apiKind,
  scheduleKind,
  selectedSite,
  onEnsureSite,
  selectedUserId,
  cellClickAction,
  cellTextColor,
  gridLayout,
  cellMinH,
  isEditable,
  onSelectUser,
  onNotify,
  onCellHistory,
  onAssigned,
  historyHover,
  reorderMode,
  moveUpDisabled,
  moveDownDisabled,
  onMoveUp,
  onMoveDown,
  onDeleteUser,
  rowCellClassName,
  draggedSite,
  selectedCell,
  onSetSelectedCell,
  draggedCell,
  onSetDraggedCell,
  editingCell,
  setEditingCell,
  editingInput,
  setEditingInput,
  siteSuggestions,
  setSiteSuggestions,
  suggestionLoading,
}: {
  user: ApiUser;
  dayLabels: Array<{ key: string; dow: string; dayNum: number; isSat: boolean; isSun: boolean }>;
  grid: Record<string, ApiCell>;
  apiKind: 'NORMAL' | 'DAILY';
  scheduleKind: ScheduleKind;
  selectedSite: SiteItem | null;
  onEnsureSite?: () => Promise<SiteItem | null>;
  selectedUserId: string | null;
  cellClickAction: CellClickAction;
  cellTextColor: CellTextColor;
  gridLayout: GridLayout;
  cellMinH: number;
  isEditable: boolean;
  onSelectUser: (userId: string | null) => void;
  onNotify?: (msg: string | null) => void;
  onCellHistory?: (entry: CellHistoryEntry) => void;
  onAssigned: () => void | Promise<void>;
  historyHover: { userId: string; day: string } | null;
  reorderMode?: boolean;
  moveUpDisabled?: boolean;
  moveDownDisabled?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDeleteUser?: () => void | Promise<void>;
  rowCellClassName?: string;
  draggedSite: SiteItem | null;
  selectedCell?: { userId: string; day: string } | null;
  onSetSelectedCell?: (cell: { userId: string; day: string } | null) => void;
  draggedCell?: { userId: string; day: string; slots: CellSlots } | null;
  onSetDraggedCell?: (cell: { userId: string; day: string; slots: CellSlots } | null) => void;
  editingCell?: { userId: string; day: string; slotIndex: number } | null;
  setEditingCell?: (cell: { userId: string; day: string; slotIndex: number } | null) => void;
  editingInput?: string;
  setEditingInput?: (value: string) => void;
  siteSuggestions?: SiteItem[];
  setSiteSuggestions?: (suggestions: SiteItem[]) => void;
  suggestionLoading?: boolean;
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
    if (input.action === 'recolor') return '色を変更しました';
    if (input.replaced === 'slot2') return '2枠目を置換しました';
    if (input.action === 'remove') return '削除しました';
    if (input.action === 'add') return '追加しました';
    if (input.action === 'replace2') return '2枠目を置換しました';
    if (input.action === 'toggle') {
      return input.toggled === 'off' ? '削除しました' : '追加しました';
    }
    return '反映しました';
  };

  const runCellAction = async (input: {
    day: string;
    action: CellClickAction;
    color: CellTextColor;
    siteId?: string | null;
    siteName?: string | null;
    beforeFallback: CellSlots;
  }) => {
    let resolvedSite = selectedSite;
    if (input.action !== 'swap' && !input.siteName && !resolvedSite) {
      resolvedSite = (await onEnsureSite?.()) ?? null;
      if (!resolvedSite) {
        onNotify?.('現場名を入力してください');
        return;
      }
    }

    try {
      const snapshot = async (): Promise<CellSlots | null> => {
        try {
          const rs = await fetch(
            `/api/schedule/cell/snapshot?userId=${encodeURIComponent(user.id)}&day=${encodeURIComponent(input.day)}&kind=${encodeURIComponent(scheduleKind)}`,
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

      const before = (await snapshot()) ?? input.beforeFallback;

      const r = await fetch('/api/schedule/cell', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          day: input.day,
          kind: apiKind,
          action: input.action,
          siteId: input.siteName ? null : (input.siteId ?? resolvedSite?.id ?? null),
          siteName: input.siteName ?? resolvedSite?.label ?? null,
          color: input.color,
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
        onNotify?.(error ? `操作に失敗しました: ${error}` : `操作に失敗しました（HTTP ${r.status}）`);
        return;
      }

      if (!json.changed) {
        onNotify?.(formatCellActionReason(json.reason, input.action) ?? '反映されませんでした');
        return;
      }

      const after = await snapshot();
      if (after) {
        onCellHistory?.({
          kind: 'cell',
          userId: user.id,
          day: input.day,
          before,
          after,
          // eslint-disable-next-line react-hooks/purity -- executed from an event-triggered async action
          at: Date.now(),
        });
      }

      onNotify?.(
        formatCellActionSuccess({
          action: json.action ?? input.action,
          toggled: json.toggled,
          replaced: json.replaced,
        }),
      );
      await onAssigned();
    } catch {
      onNotify?.('通信に失敗しました');
    }
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelectUser(isSelectedUser ? null : user.id)}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onSelectUser(isSelectedUser ? null : user.id);
        }}
        data-user-row={user.id}
        data-testid={`user-row-${user.id}`}
        aria-current={isSelectedUser ? 'true' : undefined}
        className={`sticky left-0 z-10 border-b border-r border-zinc-400 bg-white px-2 py-2 text-left text-[13px] dark:border-zinc-600 dark:bg-black ${
          isSelectedUser ? 'bg-zinc-50 dark:bg-zinc-950' : ''
        }`}
      >
        <div
          className="flex items-start justify-between gap-2"
          style={{ minHeight: Math.max(32, Math.round(cellMinH || 0)) }}
        >
          <div className="min-w-0 truncate font-medium">{user.name ?? user.email ?? user.id}</div>
          {reorderMode ? (
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={moveUpDisabled}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onMoveUp?.();
                  }}
                  className="rounded-md border border-zinc-200 bg-white/60 px-1.5 py-0.5 text-[10px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                  aria-label="上へ"
                >
                  ▲
                </button>
                <button
                  type="button"
                  disabled={moveDownDisabled}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onMoveDown?.();
                  }}
                  className="rounded-md border border-zinc-200 bg-white/60 px-1.5 py-0.5 text-[10px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                  aria-label="下へ"
                >
                  ▼
                </button>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void onDeleteUser?.();
                }}
                className="rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
                aria-label="削除"
              >
                削除
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {dayLabels.map((d) => {
        const cell = grid[d.key];
        const slot1 = cell?.slot1 ?? null;
        const slot2 = cell?.slot2 ?? null;
        const c1 = cell?.color1 ?? 'default';
        const c2 = cell?.color2 ?? 'default';
        const isHighlight = historyHover && historyHover.userId === user.id && historyHover.day === d.key;

        return (
          <button
            key={d.key}
            type="button"
            draggable={isEditable && Boolean(slot1 || slot2)}
            onDragStart={(e) => {
              if (!isEditable || (!slot1 && !slot2)) return;
              onSetDraggedCell?.({ userId: user.id, day: d.key, slots: [slot1, slot2] });
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onDragEnd={() => onSetDraggedCell?.(null)}
            onDragOver={(e) => {
              if (!isEditable || (!draggedSite && !draggedCell)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={(e) => {
              if (!isEditable) return;
              e.preventDefault();
              const beforeFallback: CellSlots = [slot1, slot2];
              
              if (draggedSite) {
                // 現場リストからドラッグされた現場をセルに入力
                void runCellAction({
                  day: d.key,
                  action: 'toggle',
                  color: cellTextColor,
                  siteId: draggedSite.id,
                  siteName: draggedSite.label,
                  beforeFallback,
                });
              } else if (draggedCell && (draggedCell.userId !== user.id || draggedCell.day !== d.key)) {
                // 別のセルからドラッグされた現場をコピー
                const siteName = draggedCell.slots.find(Boolean);
                if (siteName) {
                  void runCellAction({
                    day: d.key,
                    action: 'toggle',
                    color: cellTextColor,
                    siteName,
                    beforeFallback,
                  });
                }
              }
            }}
            onClick={(e) => {
              if (!isEditable) {
                onNotify?.('編集するには、ヘッダーの「編集」から開始してください');
                return;
              }

              e.preventDefault();
              
              // セルが選択されている場合は入力モードを開始、そうでなければセルを選択
              if (selectedCell && selectedCell.userId === user.id && selectedCell.day === d.key) {
                // 同じセルを再度クリック -> 入力モードを開始
                setEditingCell?.({ userId: user.id, day: d.key, slotIndex: 0 });
                setEditingInput?.(slot1 ?? '');
                setSiteSuggestions?.([]);
                onSetSelectedCell?.(null);
              } else if (selectedSite) {
                // 現場が選択されている場合は通常のアクション
                const beforeFallback: CellSlots = [slot1, slot2];
                void runCellAction({
                  day: d.key,
                  action: cellClickAction,
                  color: cellTextColor,
                  beforeFallback,
                });
              } else {
                // セルを選択状態にする（もう一度クリックすると入力モードになる）
                onSetSelectedCell?.({ userId: user.id, day: d.key });
              }
            }}
            onDoubleClick={(e) => {
              if (!isEditable) return;
              e.preventDefault();
              e.stopPropagation();
              // ダブルクリックで入力モードを開始
              setEditingCell?.({ userId: user.id, day: d.key, slotIndex: 0 });
              setEditingInput?.(slot1 ?? '');
              setSiteSuggestions?.([]);
            }}
            className={`border-b border-l border-zinc-400 px-2 py-2 text-left text-xs hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-900 ${
              isHighlight ? 'ring-2 ring-red-500 ring-inset' : ''
            } ${selectedCell?.userId === user.id && selectedCell?.day === d.key ? 'ring-2 ring-blue-500 ring-inset' : ''} ${
              rowCellClassName ?? ''
            } ${isEditable && (slot1 || slot2) ? 'cursor-move' : ''}`}
          >
            <div style={{ minHeight: Math.max(32, Math.round(cellMinH || 0)) }}>
              {editingCell?.userId === user.id && editingCell?.day === d.key ? (
                // 入力モード
                <div className="relative" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={editingInput ?? ''}
                    onChange={(e) => setEditingInput?.(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setEditingCell?.(null);
                        setEditingInput?.('');
                        setSiteSuggestions?.([]);
                      } else if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (siteSuggestions && siteSuggestions.length > 0) {
                          // 最初の候補を選択
                          const site = siteSuggestions[0];
                          const beforeFallback: CellSlots = [slot1, slot2];
                          void runCellAction({
                            day: d.key,
                            action: 'toggle',
                            color: cellTextColor,
                            siteId: site.id,
                            siteName: site.label,
                            beforeFallback,
                          }).then(() => {
                            setEditingCell?.(null);
                            setEditingInput?.('');
                            setSiteSuggestions?.([]);
                          });
                        } else if (editingInput?.trim()) {
                          // 直接入力
                          const beforeFallback: CellSlots = [slot1, slot2];
                          void runCellAction({
                            day: d.key,
                            action: 'toggle',
                            color: cellTextColor,
                            siteName: editingInput.trim(),
                            beforeFallback,
                          }).then(() => {
                            setEditingCell?.(null);
                            setEditingInput?.('');
                            setSiteSuggestions?.([]);
                          });
                        }
                      }
                    }}
                    autoFocus
                    className="w-full rounded border border-blue-500 bg-white px-1 py-0.5 text-xs dark:bg-black"
                    placeholder="現場名を入力..."
                  />
                  {siteSuggestions && siteSuggestions.length > 0 ? (
                    <div 
                      data-suggestion-list
                      className="absolute left-0 top-full z-50 mt-1 max-h-48 w-full min-w-[200px] overflow-auto rounded border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      {siteSuggestions.map((site: SiteItem) => (
                        <button
                          key={site.id}
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const beforeFallback: CellSlots = [slot1, slot2];
                            void runCellAction({
                              day: d.key,
                              action: 'toggle',
                              color: cellTextColor,
                              siteId: site.id,
                              siteName: site.label,
                              beforeFallback,
                            }).then(() => {
                              setEditingCell?.(null);
                              setEditingInput?.('');
                              setSiteSuggestions?.([]);
                            });
                          }}
                          className="w-full px-2 py-1 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          {site.label}
                        </button>
                      ))}
                    </div>
                  ) : suggestionLoading ? (
                    <div className="absolute left-0 top-full z-50 mt-1 w-full rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-500 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
                      検索中...
                    </div>
                  ) : null}
                </div>
              ) : (
                // 通常表示
                <>
                  <div
                    className={`whitespace-normal break-words ${gridLayout === 'comfortable' ? 'leading-snug' : 'leading-tight'} ${
                      c1 === 'red' ? 'text-red-600 dark:text-red-400' : 'text-zinc-800 dark:text-zinc-200'
                    }`}
                    style={{ fontSize: 'var(--weekhub-cell-font-size, 12px)' }}
                  >
                    {slot1 ?? ''}
                  </div>
                  <div
                    className={`mt-0.5 whitespace-normal break-words ${gridLayout === 'comfortable' ? 'leading-snug' : 'leading-tight'} ${
                      c2 === 'red' ? 'text-red-600 dark:text-red-400' : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                    style={{ fontSize: 'calc(var(--weekhub-cell-font-size, 12px) * 0.9)' }}
                  >
                    {slot2 ?? ''}
                  </div>
                </>
              )}
            </div>
          </button>
        );
      })}
    </>
  );
}
