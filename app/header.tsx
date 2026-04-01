"use client";

import { useOutsidePointerDown } from './use-outside-pointerdown';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHeaderActions } from './header-actions';
import { readColorEditMode, writeColorEditMode } from './color-edit';
import { normalizeThemeShade } from './color-ramp';
import {
  applyUiTheme,
  defaultUiTheme,
  normalizeUiTheme,
  readLocalUiTheme,
  UI_THEME_SETTING_KEY,
  type UiThemeColor,
  writeLocalUiTheme,
} from './ui-theme';

type JsonObject = Record<string, unknown>;

function asObject(v: unknown): JsonObject | null {
  return v && typeof v === 'object' ? (v as JsonObject) : null;
}

function toMonthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

type WeekGridPrefs = {
  gridLayout: 'compact' | 'comfortable';
  cellTextColor: UiThemeColor;
  cellTextShade: number;
  cellBgColor: UiThemeColor;
  cellBgShade: number;
  cellMinW: number;
  cellMinHCompact: number;
  cellMinHComfortable: number;
};

function clampInt(n: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeWeekGridPrefs(raw: unknown): WeekGridPrefs {
  const o = asObject(raw);
  const gridLayout = o?.gridLayout === 'comfortable' ? 'comfortable' : 'compact';
  const rawTextColor = typeof o?.cellTextColor === 'string' ? (o.cellTextColor as string) : '';
  const cellTextColor = (['default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const).includes(
    rawTextColor as UiThemeColor,
  )
    ? (rawTextColor as UiThemeColor)
    : 'default';
  const cellTextShade = normalizeThemeShade(o?.cellTextShade, 50);

  const rawBgColor = typeof o?.cellBgColor === 'string' ? (o.cellBgColor as string) : '';
  const cellBgColor = (['default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const).includes(
    rawBgColor as UiThemeColor,
  )
    ? (rawBgColor as UiThemeColor)
    : 'default';
  const cellBgShade = (() => {
    if (typeof o?.cellBgShade === 'number') return normalizeThemeShade(o.cellBgShade, 0);
    // v1 compatibility
    if (o?.cellBg === 'soft') return 25;
    return 0;
  })();
  const cellMinW = clampInt(typeof o?.cellMinW === 'number' ? (o.cellMinW as number) : NaN, 60, 240, 112);
  const cellMinHCompact = clampInt(
    typeof o?.cellMinHCompact === 'number' ? (o.cellMinHCompact as number) : NaN,
    32,
    120,
    48,
  );
  const cellMinHComfortable = clampInt(
    typeof o?.cellMinHComfortable === 'number' ? (o.cellMinHComfortable as number) : NaN,
    32,
    120,
    64,
  );
  return {
    gridLayout,
    cellTextColor,
    cellTextShade,
    cellBgColor,
    cellBgShade,
    cellMinW,
    cellMinHCompact,
    cellMinHComfortable,
  };
}

function defaultWeekGridPrefs(): WeekGridPrefs {
  return {
    gridLayout: 'compact',
    cellTextColor: 'default',
    cellTextShade: 50,
    cellBgColor: 'default',
    cellBgShade: 0,
    cellMinW: 112,
    cellMinHCompact: 48,
    cellMinHComfortable: 64,
  };
}

type MonthLegendState = {
  invoiceMissing: boolean;
  reportMissing: boolean;
  unassigned: boolean;
};

type AppVersionInfo = {
  name: string;
  version: string;
  gitSha: string | null;
  buildTime: string | null;
  nodeEnv: string;
};

function versionId(info: AppVersionInfo): string {
  return `${info.version}|${info.gitSha ?? ''}|${info.buildTime ?? ''}`;
}

function navLinkClass(active: boolean) {
  return `inline-flex min-w-24 items-center justify-center rounded-lg border px-6 py-2 text-xs ${
    active
      ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-black'
      : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
  }`;
}

export default function AppHeader() {
  const router = useRouter();
  const headerRef = useRef<HTMLElement | null>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode');
  const { actions } = useHeaderActions();

  // 現場リストの開閉状態
  const [isSiteListCollapsed, setIsSiteListCollapsed] = useState(false);

  const [headerUserId, setHeaderUserId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const [pageFontSize, setPageFontSize] = useState<number | null>(null);
  const [pageFontSizeDraft, setPageFontSizeDraft] = useState<string>('');
  const [uiTheme, setUiTheme] = useState(() => defaultUiTheme());

  const [monthLegend, setMonthLegend] = useState<MonthLegendState>({
    invoiceMissing: false,
    reportMissing: false,
    unassigned: false,
  });

  const [isMultiMenuOpen, setIsMultiMenuOpen] = useState(false);
  const multiMenuRef = useRef<HTMLDivElement | null>(null);

  const [appVersion, setAppVersion] = useState<AppVersionInfo | null>(null);
  const [, setAppVersionBase] = useState<string | null>(null);
  const [appVersionError, setAppVersionError] = useState<string | null>(null);
  const [isUpdateAvailableByVersion, setIsUpdateAvailableByVersion] = useState(false);
  const [isUpdateAvailableBySw, setIsUpdateAvailableBySw] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  const [alertCount, setAlertCount] = useState<number>(0);
  const [alertLoading, setAlertLoading] = useState(false);

  const isUpdateAvailable = isUpdateAvailableByVersion || isUpdateAvailableBySw;

  const isWeek = pathname === '/' && (!mode || mode === 'week');

  const weekModeKey = useMemo(() => {
    if (pathname !== '/') return null;
    const m = (mode ?? '').trim();
    if (m === 'month' || m === 'year' || m === 'week') return m;
    return 'week';
  }, [mode, pathname]);

  const weekScheduleKindKey = useMemo(() => {
    if (pathname !== '/') return null;
    const k = (searchParams.get('kind') ?? '').trim().toLowerCase();
    return k === 'daily' ? 'daily' : 'normal';
  }, [pathname, searchParams]);

  const weekGridPrefsKey = useMemo(() => {
    if (pathname !== '/' || !weekModeKey || !weekScheduleKindKey) return null;
    return `week-hub:${weekScheduleKindKey}:${weekModeKey}:gridPrefs`;
  }, [pathname, weekModeKey, weekScheduleKindKey]);

  const [weekGridPrefs, setWeekGridPrefs] = useState<WeekGridPrefs>(() => defaultWeekGridPrefs());
  const [weekColorPickMode, setWeekColorPickMode] = useState(false);

  const readWeekColorPickMode = useCallback(() => {
    return readColorEditMode();
  }, []);

  const writeWeekColorPickMode = useCallback(
    (next: boolean) => {
      writeColorEditMode(next);
      setWeekColorPickMode(next);
    },
    [],
  );

  useEffect(() => {
    // 通常時は必ずOFF（編集中のみONを維持したい）
    writeColorEditMode(false);
    setWeekColorPickMode(false);
  }, []);

  const fetchAppVersion = useCallback(async () => {
    try {
      setAppVersionError(null);
      const r = await fetch('/api/version', { cache: 'no-store' });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      const info = obj && typeof obj.info === 'object' ? (obj.info as Record<string, unknown>) : null;

      if (!r.ok || obj?.ok !== true || !info) throw new Error('bad_response');

      const parsed: AppVersionInfo = {
        name: typeof info.name === 'string' ? info.name : 'master-hub',
        version: typeof info.version === 'string' ? info.version : '0.0.0',
        gitSha: typeof info.gitSha === 'string' ? info.gitSha : null,
        buildTime: typeof info.buildTime === 'string' ? info.buildTime : null,
        nodeEnv: typeof info.nodeEnv === 'string' ? info.nodeEnv : 'unknown',
      };

      setAppVersion(parsed);

      const id = versionId(parsed);
      setAppVersionBase((base) => {
        // first fetch becomes the baseline for detecting updates.
        const nextBase = base ?? id;
        setIsUpdateAvailableByVersion(nextBase !== id);
        return nextBase;
      });
    } catch {
      setAppVersionError('取得に失敗しました');
    }
  }, []);

  useEffect(() => {
    if (!isSettingsOpen) return;
    void fetchAppVersion();
  }, [fetchAppVersion, isSettingsOpen]);

  useEffect(() => {
    if (!isSettingsOpen) return;
    if (!('serviceWorker' in navigator)) return;

    let cleanup: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (cancelled) return;
        if (reg?.waiting) setIsUpdateAvailableBySw(true);

        const onUpdateFound = () => {
          setIsUpdateAvailableBySw(true);
        };
        reg?.addEventListener('updatefound', onUpdateFound);
        cleanup = () => reg?.removeEventListener('updatefound', onUpdateFound);
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [isSettingsOpen]);

  const checkForUpdate = useCallback(async () => {
    setIsCheckingUpdate(true);
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        await reg?.update().catch(() => null);
        if (reg?.waiting) setIsUpdateAvailableBySw(true);
      }
      await fetchAppVersion();
    } finally {
      setIsCheckingUpdate(false);
    }
  }, [fetchAppVersion]);

  const applyUpdateAndReload = useCallback(async () => {
    try {
      if (!('serviceWorker' in navigator)) {
        window.location.reload();
        return;
      }

      const reg = await navigator.serviceWorker.getRegistration();
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        window.location.reload();
      });

      if (reg?.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        return;
      }

      // If there's no waiting worker, a reload still picks up latest assets/server.
      window.location.reload();
    } catch {
      window.location.reload();
    }
  }, []);

  useEffect(() => {
    const apply = () => {
      const v = readColorEditMode();
      setWeekColorPickMode(v);
    };
    window.addEventListener('masterHub:colorEditModeUpdated', apply as EventListener);
    window.addEventListener('storage', apply as EventListener);
    return () => {
      window.removeEventListener('masterHub:colorEditModeUpdated', apply as EventListener);
      window.removeEventListener('storage', apply as EventListener);
    };
  }, []);

  const readWeekGridPrefs = useCallback((key: string): WeekGridPrefs => {
    try {
      const localKey = `masterHub.ui:${key}`;
      const txt = window.localStorage.getItem(localKey);
      if (!txt) return defaultWeekGridPrefs();
      const parsed = JSON.parse(txt) as unknown;
      return normalizeWeekGridPrefs(parsed);
    } catch {
      return defaultWeekGridPrefs();
    }
  }, []);

  const writeWeekGridPrefsPatch = useCallback(
    (patch: Partial<WeekGridPrefs>) => {
      if (!weekGridPrefsKey) return;
      try {
        const localKey = `masterHub.ui:${weekGridPrefsKey}`;
        const current = readWeekGridPrefs(weekGridPrefsKey);
        const next = normalizeWeekGridPrefs({ ...current, ...patch });
        const payload = { v: 2, ...next };
        const nextTxt = JSON.stringify(payload);
        const prevTxt = window.localStorage.getItem(localKey);
        if (prevTxt !== nextTxt) {
          window.localStorage.setItem(localKey, nextTxt);
          window.dispatchEvent(new CustomEvent('masterHub:gridPrefsUpdated', { detail: { key: weekGridPrefsKey } }));
        }

        setWeekGridPrefs(next);

        if (headerUserId) {
          void fetch('/api/ui-settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ userId: headerUserId, key: weekGridPrefsKey, value: { v: 2, ...next } }),
          }).catch(() => null);
        }
      } catch {
        // ignore
      }
    },
    [headerUserId, readWeekGridPrefs, weekGridPrefsKey],
  );

  useEffect(() => {
    if (!isSettingsOpen) return;
    setWeekColorPickMode(readWeekColorPickMode());
    if (!weekGridPrefsKey) return;
    // Load (DB -> local fallback)
    if (!headerUserId) {
      setWeekGridPrefs(readWeekGridPrefs(weekGridPrefsKey));
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(
          `/api/ui-settings?userId=${encodeURIComponent(headerUserId)}&key=${encodeURIComponent(weekGridPrefsKey)}`,
        );
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        if (!r.ok || obj?.ok !== true) throw new Error('not ok');

        const raw = (obj as { value?: unknown }).value;
        const vObj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
        const next = normalizeWeekGridPrefs(vObj && typeof vObj.v === 'number' ? vObj : raw);
        if (cancelled) return;
        setWeekGridPrefs(next);

        try {
          const localKey = `masterHub.ui:${weekGridPrefsKey}`;
          window.localStorage.setItem(localKey, JSON.stringify({ v: 2, ...next }));
        } catch {
          // ignore
        }
      } catch {
        if (cancelled) return;
        setWeekGridPrefs(readWeekGridPrefs(weekGridPrefsKey));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [headerUserId, isSettingsOpen, pathname, readWeekColorPickMode, readWeekGridPrefs, weekGridPrefsKey]);
  const routeKey = useMemo(() => {
    const qs = searchParams.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }, [pathname, searchParams]);

  const navIntentRef = useRef<'push' | 'back' | 'forward' | null>(null);
  const didInitNavRef = useRef(false);
  const navStateRef = useRef<{ stack: string[]; index: number }>({ stack: [], index: 0 });
  const [navStack, setNavStack] = useState<string[]>([]);
  const [navIndex, setNavIndex] = useState(0);
  const [navLen, setNavLen] = useState(1);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  const historyMenuRef = useRef<HTMLDivElement | null>(null);

  const setNavState = useCallback((stack: string[], index: number) => {
    navStateRef.current = { stack, index };
    setNavStack(stack);
    setNavIndex(index);
    setNavLen(stack.length || 1);
    try {
      window.sessionStorage.setItem('masterHub.navStack', JSON.stringify(stack));
      window.sessionStorage.setItem('masterHub.navIndex', String(index));
    } catch {
      // ignore
    }
  }, []);

  const openUserGate = useCallback(() => {
    try {
      window.dispatchEvent(new Event('masterHub:openUserGate'));
      setIsSettingsOpen(false);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    setIsHistoryOpen(false);
  }, [routeKey]);

  useOutsidePointerDown({
    open: isHistoryOpen,
    refs: [historyButtonRef, historyMenuRef],
    onOutside: () => setIsHistoryOpen(false),
    capture: true,
  });

  useEffect(() => {
    setIsMultiMenuOpen(false);
  }, [routeKey]);

  useEffect(() => {
    if (!isSettingsOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const el = settingsRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setIsSettingsOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [isSettingsOpen]);

  useEffect(() => {
    if (!isMultiMenuOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const el = multiMenuRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setIsMultiMenuOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [isMultiMenuOpen]);

  // アラート数を取得
  useEffect(() => {
    let mounted = true;

    const fetchAlertCount = async () => {
      setAlertLoading(true);
      try {
        const res = await fetch('/api/alerts/count');
        const data = await res.json();
        if (mounted && data.ok && typeof data.total === 'number') {
          setAlertCount(data.total);
        }
      } catch (error) {
        console.error('Failed to fetch alert count:', error);
      } finally {
        if (mounted) {
          setAlertLoading(false);
        }
      }
    };

    void fetchAlertCount();

    // 5分ごとに更新
    const interval = setInterval(() => {
      void fetchAlertCount();
    }, 5 * 60 * 1000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    // Apply cached theme early (user switch triggers reload, so headerUserId changes are enough).
    const t = readLocalUiTheme(headerUserId);
    setUiTheme(t);
    try {
      applyUiTheme(t);
    } catch {
      // ignore
    }
  }, [headerUserId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch('/api/auth/me');
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        const user = obj?.user && typeof obj.user === 'object' ? (obj.user as Record<string, unknown>) : null;
        const id = typeof user?.id === 'string' ? (user.id as string) : null;
        if (cancelled) return;
        setHeaderUserId(id);
      } catch {
        if (cancelled) return;
        setHeaderUserId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (pathname !== '/') return;

    const now = new Date();
    const month = toMonthKey(now);

    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/sites?month=${encodeURIComponent(month)}`);
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = asObject(j);
        const rawSites = Array.isArray(obj?.sites) ? (obj?.sites as unknown[]) : [];

        const next: MonthLegendState = { invoiceMissing: false, reportMissing: false, unassigned: false };
        for (const raw of rawSites) {
          const s = asObject(raw);
          if (!s) continue;
          const alertsEnabled = typeof s.alertsEnabled === 'boolean' ? s.alertsEnabled : true;
          if (!alertsEnabled) continue;

          const invoiceIssued = typeof s.invoiceIssuedThisMonth === 'boolean' ? s.invoiceIssuedThisMonth : true;
          const reportIssued = typeof s.reportIssuedThisMonth === 'boolean' ? s.reportIssuedThisMonth : true;
          const unassigned = typeof s.unassignedThisMonth === 'boolean' ? s.unassignedThisMonth : false;

          if (!invoiceIssued) next.invoiceMissing = true;
          if (!reportIssued) next.reportMissing = true;
          if (unassigned) next.unassigned = true;
          if (next.invoiceMissing && next.reportMissing && next.unassigned) break;
        }

        if (cancelled) return;
        setMonthLegend(next);
      } catch {
        if (cancelled) return;
        setMonthLegend({ invoiceMissing: false, reportMissing: false, unassigned: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const pageFontKey = useMemo(() => {
    return `fontSize:${pathname}`;
  }, [pathname]);

  const localPageFontKey = useCallback(
    (userId: string | null) => {
      return `masterHub.ui:fontSize:${userId ?? 'anon'}:${pageFontKey}`;
    },
    [pageFontKey],
  );

  const readLocalPageFontSize = useCallback(
    (userId: string | null): number | null => {
      try {
        const raw = window.localStorage.getItem(localPageFontKey(userId));
        if (!raw) return null;
        const n = Number(raw);
        if (!Number.isFinite(n)) return null;
        return Math.max(10, Math.min(30, Math.round(n)));
      } catch {
        return null;
      }
    },
    [localPageFontKey],
  );

  const writeLocalPageFontSize = useCallback(
    (userId: string | null, px: number | null) => {
      try {
        const k = localPageFontKey(userId);
        if (px == null) {
          window.localStorage.removeItem(k);
          return;
        }
        const v = Math.max(10, Math.min(30, Math.round(px)));
        window.localStorage.setItem(k, String(v));
      } catch {
        // ignore
      }
    },
    [localPageFontKey],
  );

  const applyFontSize = useCallback(
    (px: number | null) => {
      // 予定セルのみ適用（全体のフォントサイズは変えない）
      if (pathname !== '/') {
        document.documentElement.style.removeProperty('--weekhub-cell-font-size');
        return;
      }
      const v = px && Number.isFinite(px) ? Math.max(10, Math.min(30, Math.round(px))) : 12;
      document.documentElement.style.setProperty('--weekhub-cell-font-size', `${v}px`);
    },
    [pathname],
  );

  useEffect(() => {
    // Apply on navigation (local first)
    const local = readLocalPageFontSize(headerUserId);
    setPageFontSize(local);
    setPageFontSizeDraft(local == null ? '' : String(local));
    applyFontSize(local);

    if (!headerUserId) return;

    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(
          `/api/ui-settings?userId=${encodeURIComponent(headerUserId)}&key=${encodeURIComponent(pageFontKey)}`,
        );
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        if (!r.ok || obj?.ok !== true) return;
        if (cancelled) return;

        const raw = obj.value;
        const n = typeof raw === 'number' ? raw : null;
        setPageFontSize(n);
        setPageFontSizeDraft(n == null ? '' : String(n));
        applyFontSize(n);
        writeLocalPageFontSize(headerUserId, n);
      } catch {
        if (cancelled) return;
        const fallback = readLocalPageFontSize(headerUserId);
        setPageFontSize(fallback);
        setPageFontSizeDraft(fallback == null ? '' : String(fallback));
        applyFontSize(fallback);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyFontSize, headerUserId, pageFontKey, readLocalPageFontSize, writeLocalPageFontSize]);

  const savePageFontSize = useCallback(
    async (px: number) => {
      const v = Math.max(10, Math.min(30, Math.round(px)));
      setPageFontSize(v);
      setPageFontSizeDraft(String(v));
      applyFontSize(v);
      writeLocalPageFontSize(headerUserId, v);

      if (!headerUserId) return;
      try {
        await fetch('/api/ui-settings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: headerUserId, key: pageFontKey, value: v }),
        });
      } catch {
        // ignore
      }
    },
    [applyFontSize, headerUserId, pageFontKey, writeLocalPageFontSize],
  );

  useEffect(() => {
    if (!isSettingsOpen) return;
    if (!headerUserId) return;

    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(
          `/api/ui-settings?userId=${encodeURIComponent(headerUserId)}&key=${encodeURIComponent(UI_THEME_SETTING_KEY)}`,
        );
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        if (!r.ok || obj?.ok !== true) return;

        const theme = normalizeUiTheme((obj as { value?: unknown }).value);
        if (cancelled) return;
        setUiTheme(theme);
        applyUiTheme(theme);
        writeLocalUiTheme(headerUserId, theme);
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [headerUserId, isSettingsOpen]);

  const saveUiTheme = useCallback(
    async (next: ReturnType<typeof defaultUiTheme>) => {
      setUiTheme(next);
      applyUiTheme(next);
      writeLocalUiTheme(headerUserId, next);

      if (!headerUserId) return;
      try {
        await fetch('/api/ui-settings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: headerUserId, key: UI_THEME_SETTING_KEY, value: next }),
        });
      } catch {
        // ignore
      }
    },
    [headerUserId],
  );

  useEffect(() => {
    try {
      const stackRaw = window.sessionStorage.getItem('masterHub.navStack');
      const indexRaw = window.sessionStorage.getItem('masterHub.navIndex');
      const parsed = stackRaw ? (JSON.parse(stackRaw) as unknown) : null;
      const stack = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
      const index = Math.max(0, Math.min(stack.length - 1, Number(indexRaw ?? '0') || 0));
      if (stack.length === 0) {
        setNavState([routeKey], 0);
      } else {
        setNavState(stack, index);
      }
    } catch {
      setNavState([routeKey], 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!didInitNavRef.current) {
      didInitNavRef.current = true;
      return;
    }

    navIntentRef.current = null;

    const cur = navStateRef.current;
    const stack = cur.stack.length ? cur.stack : [routeKey];
    const index = Math.max(0, Math.min(stack.length - 1, cur.index));
    const curKey = stack[index] ?? null;
    if (curKey === routeKey) return;

    // 1-step back/forward detection (covers Android hardware back/forward)
    if (index > 0 && stack[index - 1] === routeKey) {
      setNavState(stack, index - 1);
      return;
    }
    if (index < stack.length - 1 && stack[index + 1] === routeKey) {
      setNavState(stack, index + 1);
      return;
    }

    // intent-based or unknown navigation treated as push
    const trimmed = stack.slice(0, index + 1);
    trimmed.push(routeKey);
    setNavState(trimmed, trimmed.length - 1);
  }, [routeKey, setNavState]);

  const canBack = useMemo(() => {
    if (actions.undo) return !actions.undo.disabled;
    return navIndex > 0 || !isWeek;
  }, [actions.undo, isWeek, navIndex]);

  const canForward = useMemo(() => {
    if (actions.redo) return !actions.redo.disabled;
    return navIndex < navLen - 1;
  }, [actions.redo, navIndex, navLen]);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const apply = () => {
      const h = Math.max(0, el.offsetHeight);
      document.documentElement.style.setProperty('--app-header-h', `${h || 56}px`);
    };
    apply();
    const ro = new ResizeObserver(() => apply());
    ro.observe(el);
    window.addEventListener('resize', apply);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, []);

  const isAccounting = pathname === '/accounting';
  const isManagement = pathname === '/management';
  const isSiteLedger = pathname === '/site-ledger';
  const isPartners = pathname === '/partners';
  const isMulti = pathname === '/multi';
  const isReports = pathname === '/reports';
  const isInvoices = pathname === '/invoices';
  const isAlerts = pathname === '/alerts';

  return (
    <header
      ref={headerRef}
      data-color-edit-slot="panel"
      className="sticky top-0 z-50 border-b border-zinc-200 backdrop-blur dark:border-zinc-800"
    >
      <div className="bg-white/60 dark:bg-black/60">
        <div className="mx-auto flex w-full max-w-screen-2xl items-center justify-between gap-4 px-4 py-3 lg:px-6">

          <div className="hidden -ml-2 sm:flex items-center gap-3">
            {/* Left small banner area (future: settings/alerts/notifications) */}
            <Link href="/" className="text-sm font-medium tracking-tight">
              Master Hub
            </Link>

            {/* 現場リスト三角ボタン */}
            <button
              type="button"
              aria-label={isSiteListCollapsed ? '現場リストを広げる' : '現場リストを畳む'}
              className="ml-1 flex h-7 w-7 items-center justify-center rounded-full border bg-white shadow hover:bg-zinc-100 dark:bg-black dark:hover:bg-zinc-900"
              style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
              onClick={() => setIsSiteListCollapsed((v) => !v)}
            >
              {isSiteListCollapsed ? <span>&#9654;</span> : <span>&#9664;</span>}
            </button>

          <div className="flex items-center gap-2">
            <div ref={settingsRef} className="relative" data-color-edit-keep data-color-edit-ui>
              <button
                type="button"
                onClick={() => setIsSettingsOpen((v) => !v)}
                aria-expanded={isSettingsOpen}
                className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                title="設定"
              >
                設定
              </button>

              {isSettingsOpen ? (
                <div
                  data-color-edit-slot="border"
                  className="absolute left-0 top-full mt-1 w-[320px] overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-black"
                >
                  <div className="max-h-[70vh] overflow-auto overscroll-contain">
                    <div className="border-b border-zinc-200 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                      文字サイズ（予定セル）
                    </div>
                    <div className="p-2">
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => void savePageFontSize(14)}
                        className={`rounded-md border px-2 py-2 text-[11px] disabled:cursor-not-allowed disabled:opacity-60 ${
                          (pageFontSize ?? 16) === 14
                            ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-black'
                            : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
                        }`}
                      >
                        小
                      </button>
                      <button
                        type="button"
                        onClick={() => void savePageFontSize(16)}
                        className={`rounded-md border px-2 py-2 text-[11px] disabled:cursor-not-allowed disabled:opacity-60 ${
                          (pageFontSize ?? 16) === 16
                            ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-black'
                            : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
                        }`}
                      >
                        標準
                      </button>
                      <button
                        type="button"
                        onClick={() => void savePageFontSize(18)}
                        className={`rounded-md border px-2 py-2 text-[11px] disabled:cursor-not-allowed disabled:opacity-60 ${
                          (pageFontSize ?? 16) === 18
                            ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-black'
                            : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
                        }`}
                      >
                        大
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-[1fr_90px] items-center gap-2">
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        現在: {(pageFontSize ?? 12)}px
                      </div>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={10}
                        max={30}
                        value={pageFontSizeDraft}
                        onChange={(e) => setPageFontSizeDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return;
                          const n = Number(pageFontSizeDraft);
                          if (!Number.isFinite(n)) return;
                          void savePageFontSize(n);
                        }}
                        onBlur={() => {
                          const n = Number(pageFontSizeDraft);
                          if (!Number.isFinite(n)) {
                            setPageFontSizeDraft(pageFontSize == null ? '' : String(pageFontSize));
                            return;
                          }
                          void savePageFontSize(n);
                        }}
                        className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-[11px] dark:border-zinc-800 dark:bg-black"
                        aria-label="文字サイズ（px）"
                      />
                    </div>
                    {!headerUserId ? (
                      <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                        ユーザー未設定のため、この端末内のみ保存されます
                      </div>
                    ) : null}
                    </div>

                    <div className="border-t border-zinc-200 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                      ユーザー
                    </div>
                    <div className="p-2">
                    <button
                      type="button"
                      onClick={openUserGate}
                      className="w-full rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                    >
                      初回登録 / 切替
                    </button>
                    </div>

                    <div className="border-t border-zinc-200 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                      線（個人）
                    </div>
                    <div className="p-2 space-y-2">
                    <div className="grid grid-cols-[90px_1fr] items-center gap-2">
                      <div className="text-[11px] text-zinc-600 dark:text-zinc-400">グリッド線</div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => void saveUiTheme({ ...uiTheme, gridStrongLines: false })}
                          className={`rounded-md border px-2 py-2 text-[11px] ${
                            !uiTheme.gridStrongLines
                              ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-black'
                              : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
                          }`}
                        >
                          標準
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveUiTheme({ ...uiTheme, gridStrongLines: true })}
                          className={`rounded-md border px-2 py-2 text-[11px] ${
                            uiTheme.gridStrongLines
                              ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-black'
                              : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
                          }`}
                        >
                          強
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-[90px_1fr] items-center gap-2">
                      <div className="text-[11px] text-zinc-600 dark:text-zinc-400">枠線</div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => void saveUiTheme({ ...uiTheme, borderStrong: false })}
                          className={`rounded-md border px-2 py-2 text-[11px] ${
                            !uiTheme.borderStrong
                              ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-black'
                              : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
                          }`}
                        >
                          標準
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveUiTheme({ ...uiTheme, borderStrong: true })}
                          className={`rounded-md border px-2 py-2 text-[11px] ${
                            uiTheme.borderStrong
                              ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-black'
                              : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
                          }`}
                        >
                          強
                        </button>
                      </div>
                    </div>

                    {!headerUserId ? (
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        ユーザー未設定のため、この端末内のみ保存されます
                      </div>
                    ) : null}
                    </div>

                    <div className="border-t border-zinc-200 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                      カラー編集（全画面）
                    </div>
                    <div className="p-2 space-y-2">
                      <div className="grid grid-cols-[90px_1fr] items-center gap-2">
                        <div className="text-[11px] text-zinc-600 dark:text-zinc-400">編集モード</div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => writeWeekColorPickMode(false)}
                            className={`rounded-md border px-2 py-2 text-[11px] ${
                              !weekColorPickMode
                                ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-black'
                                : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
                            }`}
                          >
                            OFF
                          </button>
                          <button
                            type="button"
                            onClick={() => writeWeekColorPickMode(true)}
                            className={`rounded-md border px-2 py-2 text-[11px] ${
                              weekColorPickMode
                                ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-black'
                                : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
                            }`}
                          >
                            ON
                          </button>
                        </div>
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        ONの間、画面の任意箇所をクリックして色（＋濃淡）を編集します（このページごと・アカウント別に保存）。
                      </div>
                    </div>

                  {pathname === '/' && weekGridPrefsKey ? (
                    <>
                      <div className="border-t border-zinc-200 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                        セル（週予定）
                      </div>
                      <div className="p-2 space-y-2">
                        <div className="grid grid-cols-[90px_1fr] items-center gap-2">
                          <div className="text-[11px] text-zinc-600 dark:text-zinc-400">表示密度</div>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => writeWeekGridPrefsPatch({ gridLayout: 'compact' })}
                              className={`rounded-md border px-2 py-2 text-[11px] ${
                                weekGridPrefs.gridLayout === 'compact'
                                  ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-black'
                                  : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
                              }`}
                            >
                              コンパクト
                            </button>
                            <button
                              type="button"
                              onClick={() => writeWeekGridPrefsPatch({ gridLayout: 'comfortable' })}
                              className={`rounded-md border px-2 py-2 text-[11px] ${
                                weekGridPrefs.gridLayout === 'comfortable'
                                  ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-black'
                                  : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
                              }`}
                            >
                              ゆったり
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-[90px_1fr] items-center gap-2">
                          <div className="text-[11px] text-zinc-600 dark:text-zinc-400">セル幅</div>
                          <div className="grid grid-cols-3 gap-2">
                            {[84, 112, 140].map((w) => (
                              <button
                                key={w}
                                type="button"
                                onClick={() => writeWeekGridPrefsPatch({ cellMinW: w })}
                                className={`rounded-md border px-2 py-2 text-[11px] ${
                                  weekGridPrefs.cellMinW === w
                                    ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-black'
                                    : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
                                }`}
                              >
                                {w === 84 ? '狭' : w === 112 ? '標準' : '広'}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="grid grid-cols-[90px_1fr] items-center gap-2">
                          <div className="text-[11px] text-zinc-600 dark:text-zinc-400">高さ(狭)</div>
                          <div className="grid grid-cols-3 gap-2">
                            {[40, 48, 56].map((h) => (
                              <button
                                key={h}
                                type="button"
                                onClick={() => writeWeekGridPrefsPatch({ cellMinHCompact: h })}
                                className={`rounded-md border px-2 py-2 text-[11px] ${
                                  weekGridPrefs.cellMinHCompact === h
                                    ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-black'
                                    : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
                                }`}
                              >
                                {h === 40 ? '低' : h === 48 ? '標準' : '高'}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="grid grid-cols-[90px_1fr] items-center gap-2">
                          <div className="text-[11px] text-zinc-600 dark:text-zinc-400">高さ(広)</div>
                          <div className="grid grid-cols-3 gap-2">
                            {[56, 64, 72].map((h) => (
                              <button
                                key={h}
                                type="button"
                                onClick={() => writeWeekGridPrefsPatch({ cellMinHComfortable: h })}
                                className={`rounded-md border px-2 py-2 text-[11px] ${
                                  weekGridPrefs.cellMinHComfortable === h
                                    ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-black'
                                    : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
                                }`}
                              >
                                {h === 56 ? '低' : h === 64 ? '標準' : '高'}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </>
                  ) : null}

                    <div className="border-t border-zinc-200 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                      アプリ
                    </div>
                    <div className="p-2 space-y-2">
                      <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
                        {appVersion ? (
                          <>
                            <div>
                              {appVersion.name} v{appVersion.version}
                            </div>
                            {appVersion.gitSha ? <div className="break-all">{appVersion.gitSha}</div> : null}
                            {appVersion.buildTime ? <div className="break-all">{appVersion.buildTime}</div> : null}
                          </>
                        ) : appVersionError ? (
                          <div>{appVersionError}</div>
                        ) : (
                          <div>取得中…</div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => void checkForUpdate()}
                          disabled={isCheckingUpdate}
                          className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-[11px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                        >
                          更新確認
                        </button>
                        <button
                          type="button"
                          onClick={() => void applyUpdateAndReload()}
                          disabled={!isUpdateAvailable}
                          className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-[11px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                        >
                          更新して再読み込み
                        </button>
                      </div>

                      {isUpdateAvailable ? (
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">新しいバージョンがあります。</div>
                      ) : null}
                    </div>

                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-1">
            <button
              type="button"
              data-testid="header-action-back"
              onClick={() => {
                if (actions.undo && !actions.undo.disabled) {
                  void actions.undo.onClick();
                  return;
                }
                if (navIndex > 0) {
                  navIntentRef.current = 'back';
                  router.back();
                  return;
                }

                if (!isWeek) {
                  navIntentRef.current = 'push';
                  router.push('/?mode=week');
                }
              }}
              disabled={!canBack}
              title={actions.undo ? actions.undo.title ?? '入力を取り消し' : 'ロールバック'}
              className="mh-btn"
            >
              戻る
            </button>

            <button
              type="button"
              data-testid="header-action-save"
              onClick={() => {
                writeColorEditMode(false);
                setWeekColorPickMode(false);
                void actions.save?.onClick();
              }}
              disabled={!actions.save || actions.save.disabled}
              title={actions.save?.title ?? '作業や入力'}
              className="mh-btn-primary"
            >
              保存
            </button>

            <button
              type="button"
              data-testid="header-action-forward"
              onClick={() => {
                if (actions.redo && !actions.redo.disabled) {
                  void actions.redo.onClick();
                  return;
                }
                if (!canForward) return;
                navIntentRef.current = 'forward';
                router.forward();
              }}
              disabled={!canForward}
              title={actions.redo ? actions.redo.title ?? '入力をやり直し' : 'ロールフォワード'}
              className="mh-btn"
            >
              進む
            </button>

            <button
              type="button"
              data-testid="header-action-add"
              onClick={() => void actions.add?.onClick()}
              disabled={!actions.add || actions.add.disabled}
              title={actions.add?.title ?? '編集'}
              className="ml-1 mh-btn"
            >
              編集
            </button>

            <div className="relative">
              <button
                type="button"
                ref={historyButtonRef}
                data-testid="header-action-history"
                onClick={() => setIsHistoryOpen((v) => !v)}
                disabled={!(actions.historyMenu || actions.history || navStack.length > 0)}
                title="履歴"
                className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
              >
                履歴
              </button>

              {isHistoryOpen ? (
                <div
                  ref={historyMenuRef}
                  data-color-edit-slot="border"
                  className="absolute left-0 top-full mt-1 w-[480px] overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-black"
                >
                  {actions.history ? (
                    <button
                      type="button"
                      onClick={() => {
                        void actions.history?.onClick();
                        setIsHistoryOpen(false);
                      }}
                      disabled={actions.history.disabled}
                      className="block w-full border-b border-zinc-200 px-3 py-2 text-left text-[11px] hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:hover:bg-zinc-900"
                      title={actions.history.title ?? '編集履歴'}
                    >
                      {actions.history.title ?? '編集履歴'}
                    </button>
                  ) : null}

                  <div className="max-h-[32rem] overflow-auto py-1">
                    {actions.historyMenu ? (
                      <div className="flex flex-col gap-1 px-2 pb-1">
                        {actions.historyMenu.items.length === 0 ? (
                          <div className="px-2 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">編集履歴はありません。</div>
                        ) : null}
                        {actions.historyMenu.items.slice(0, 40).map((it) => (
                          <div
                            key={it.key}
                            data-color-edit-slot="border"
                            className="rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-black dark:text-zinc-300"
                            onPointerEnter={() => actions.historyMenu?.onHover?.(it.hover)}
                            onPointerLeave={() => actions.historyMenu?.onHover?.(null)}
                          >
                            <div className="flex flex-wrap items-center gap-2 text-[11px]">
                              <div className="text-zinc-500 dark:text-zinc-400">
                                {new Date(it.at).toLocaleString()}
                              </div>
                              <div
                                className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-200"
                                title={it.siteLabel}
                              >
                                {it.siteLabel}
                              </div>
                              <div className="text-zinc-500 dark:text-zinc-400">{it.editorLabel}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      navStack
                        .map((key, idx) => {
                          let label = key;
                          if (key.includes('mode=week')) {
                            label = '週予定';
                          } else if (key.includes('mode=month')) {
                            label = '月予定';
                          } else if (key.includes('mode=year')) {
                            label = '年予定';
                          } else if (key.startsWith('/site-ledger/')) {
                            label = '現場台帳';
                          } else if (key === '/management') {
                            label = '管理画面';
                          } else if (key === '/partners') {
                            label = '取引先管理';
                          } else if (key === '/reports') {
                            label = '報告書';
                          } else if (key === '/accounting') {
                            label = '会計連携';
                          } else if (key === '/invoices') {
                            label = '請求書';
                          } else if (key === '/alerts') {
                            label = 'アラート';
                          } else if (key === '/multi') {
                            label = '複数選択';
                          } else if (key === '/') {
                            label = 'ホーム';
                          }
                          return { key, idx, label };
                        })
                        .slice(-20)
                        .reverse()
                        .map((it) => (
                          <div
                            key={`${it.idx}-${it.key}`}
                            className="px-3 py-1 text-[11px] text-zinc-700 dark:text-zinc-300"
                          >
                            <span className="mr-2 text-zinc-400 dark:text-zinc-500">{it.idx === navIndex ? '●' : '○'}</span>
                            <span className="break-all">{it.label}</span>
                          </div>
                        ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            {pathname === '/' ? (
              <div className="ml-2 flex flex-wrap items-center gap-2 text-[11px]" aria-label="当月アラート凡例">
                <div className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300">
                  <span
                    className={`mh-alert-dot mh-alert-dot-invoice ${
                      monthLegend.invoiceMissing ? 'mh-alert-dot-active' : 'mh-alert-dot-inactive'
                    }`}
                    aria-hidden="true"
                  />
                  <span>請求未</span>
                </div>
                <div className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-orange-700 dark:border-orange-900/70 dark:bg-orange-950/40 dark:text-orange-300">
                  <span
                    className={`mh-alert-dot mh-alert-dot-report ${
                      monthLegend.reportMissing ? 'mh-alert-dot-active' : 'mh-alert-dot-inactive'
                    }`}
                    aria-hidden="true"
                  />
                  <span>報告未</span>
                </div>
                <div className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-green-700 dark:border-green-900/70 dark:bg-green-950/40 dark:text-green-300">
                  <span
                    className={`mh-alert-dot mh-alert-dot-unassigned ${
                      monthLegend.unassigned ? 'mh-alert-dot-active' : 'mh-alert-dot-inactive'
                    }`}
                    aria-hidden="true"
                  />
                  <span>未配置</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Right-side hub actions */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link
            href="/alerts"
            onClick={() => {
              navIntentRef.current = 'push';
            }}
            className={`hidden sm:inline-flex relative rounded-md border px-3 py-2 text-[11px] ${
              isAlerts
                ? 'border-red-500 bg-red-50 text-red-700 dark:border-red-500 dark:bg-red-950/60 dark:text-red-300'
                : 'border-red-300 bg-white/60 text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-black/60 dark:text-red-300 dark:hover:bg-red-950/60'
            }`}
            title="アラート（通知/現場単価/送信失敗）へ"
            aria-current={isAlerts ? 'page' : undefined}
          >
            アラート
            {!alertLoading && alertCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
                {alertCount > 99 ? '99+' : alertCount}
              </span>
            )}
          </Link>
          <Link
            href="/?mode=week"
            onClick={() => {
              navIntentRef.current = 'push';
            }}
            className={navLinkClass(isWeek)}
            title="週予定へ（週モードに戻す）"
            aria-current={isWeek ? 'page' : undefined}
          >
            週予定
          </Link>
          <Link
            href="/accounting"
            onClick={() => {
              navIntentRef.current = 'push';
            }}
            className={`hidden sm:inline-flex ${navLinkClass(isAccounting)}`}
            title="会計（PDF/CSV/テンプレ/一覧）へ"
            aria-current={isAccounting ? 'page' : undefined}
          >
            会計
          </Link>

          <Link
            href="/reports"
            onClick={() => {
              navIntentRef.current = 'push';
            }}
            className={`hidden sm:inline-flex ${navLinkClass(isReports)}`}
            title="報告書（送信/履歴/検索）へ"
            aria-current={isReports ? 'page' : undefined}
          >
            報告書
          </Link>

          <Link
            href="/invoices"
            onClick={() => {
              navIntentRef.current = 'push';
            }}
            className={`hidden sm:inline-flex ${navLinkClass(isInvoices)}`}
            title="請求書（送信/履歴/検索）へ"
            aria-current={isInvoices ? 'page' : undefined}
          >
            請求書
          </Link>
          <Link
            href="/management"
            onClick={() => {
              navIntentRef.current = 'push';
            }}
            className={`hidden sm:inline-flex ${navLinkClass(isManagement)}`}
            title="リピート/自動入力などの管理へ"
            aria-current={isManagement ? 'page' : undefined}
          >
            管理
          </Link>
          <Link
            href="/site-ledger"
            onClick={() => {
              navIntentRef.current = 'push';
            }}
            className={`hidden sm:inline-flex ${navLinkClass(isSiteLedger)}`}
            title="現場台帳（追加/詳細）へ"
            aria-current={isSiteLedger ? 'page' : undefined}
          >
            現場台帳
          </Link>
          <Link
            href="/partners"
            onClick={() => {
              navIntentRef.current = 'push';
            }}
            className={`hidden sm:inline-flex ${navLinkClass(isPartners)}`}
            title="関係会社へ"
            aria-current={isPartners ? 'page' : undefined}
          >
            関係会社
          </Link>

          <div ref={multiMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setIsMultiMenuOpen((v) => !v)}
              className={`hidden sm:inline-flex ${navLinkClass(isMulti)}`}
              aria-expanded={isMultiMenuOpen}
              title="週/月/年の切替"
            >
              マルチ
            </button>

            {isMultiMenuOpen ? (
              <div
                data-color-edit-slot="border"
                className="absolute right-0 top-full mt-1 w-[220px] overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-black"
              >
                <div className="py-1">
                  <button
                    type="button"
                    onClick={() => {
                      navIntentRef.current = 'push';
                      router.push('/multi?tab=graph');
                    }}
                    className="block w-full px-3 py-2 text-left text-[11px] hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    集計（グラフ）
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      navIntentRef.current = 'push';
                      router.push('/multi?tab=net');
                    }}
                    className="block w-full px-3 py-2 text-left text-[11px] hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    集計（収支）
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      navIntentRef.current = 'push';
                      router.push('/multi?tab=sales');
                    }}
                    className="block w-full px-3 py-2 text-left text-[11px] hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    集計（売上）
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          </div>
        </div>
      </div>
    </header>
  );
}
