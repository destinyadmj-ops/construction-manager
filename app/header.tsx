"use client";

import { useOutsidePointerDown } from './use-outside-pointerdown';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  WEEK_GRID_BG_OPTIONS,
  WEEK_GRID_COMFORTABLE_HEIGHT_OPTIONS,
  WEEK_GRID_COMPACT_HEIGHT_OPTIONS,
  WEEK_GRID_DAY_WIDTH_OPTIONS,
  WEEK_GRID_NAME_WIDTH_OPTIONS,
  WEEK_GRID_PREFS_VERSION,
  WEEK_GRID_TEXT_COLOR_OPTIONS,
  defaultWeekGridPrefs,
  isWeekGridCellBg,
  isWeekGridTextColor,
  normalizeWeekGridPrefs,
  type WeekGridPrefs,
} from '@/shared/week-grid-prefs';
import { useHeaderActions } from './header-actions';
import { readColorEditMode, writeColorEditMode } from './color-edit';
import {
  applyUiTheme,
  defaultUiTheme,
  normalizeUiTheme,
  readLocalUiTheme,
  UI_THEME_SETTING_KEY,
  writeLocalUiTheme,
} from './ui-theme';
import { markForceDesktopWeekHomeOnce, readStoredScheduleReturn } from '@/shared/schedule-return';

type JsonObject = Record<string, unknown>;

function asObject(v: unknown): JsonObject | null {
  return v && typeof v === 'object' ? (v as JsonObject) : null;
}

function toMonthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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

type DesktopReleaseInfo = {
  version: string;
  downloadUrl: string | null;
  notes: string | null;
  publishedAt: string | null;
  channel: string;
};

type PersonalNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
};

function formatNotificationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function versionId(info: AppVersionInfo): string {
  return `${info.version}|${info.gitSha ?? ''}|${info.buildTime ?? ''}`;
}

function navLinkClass(active: boolean, displayClass = 'inline-flex') {
  return `${displayClass} min-w-[4.5rem] shrink-0 items-center justify-center rounded-lg border px-3 py-2 text-[11px] sm:min-w-20 sm:px-4 ${
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
  const scheduleKind = useMemo(() => {
    const kindParam = (searchParams.get('kind') ?? '').trim().toLowerCase();
    return kindParam === 'daily' ? 'daily' : 'normal';
  }, [searchParams]);
  const { actions } = useHeaderActions();

  const managementHref = useMemo(() => `/management?kind=${scheduleKind}`, [scheduleKind]);
  const siteLedgerHref = useMemo(() => `/site-ledger?kind=${scheduleKind}`, [scheduleKind]);

  // 現場リストの開閉状態
  const [isSiteListCollapsed, setIsSiteListCollapsed] = useState(false);

  const [headerUserId, setHeaderUserId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const [pageFontSize, setPageFontSize] = useState<number | null>(null);
  const [pageFontSizeDraft, setPageFontSizeDraft] = useState<string>('');
  const [uiTheme, setUiTheme] = useState(() => defaultUiTheme());
  const [isElectronShell, setIsElectronShell] = useState(false);
  const [isMobileBrowser, setIsMobileBrowser] = useState(false);

  const [, setMonthLegend] = useState<MonthLegendState>({
    invoiceMissing: false,
    reportMissing: false,
    unassigned: false,
  });

  const [isMultiMenuOpen, setIsMultiMenuOpen] = useState(false);
  const multiMenuRef = useRef<HTMLDivElement | null>(null);

  const [appVersion, setAppVersion] = useState<AppVersionInfo | null>(null);
  const [, setAppVersionBase] = useState<string | null>(null);
  const [appVersionError, setAppVersionError] = useState<string | null>(null);
  const [desktopRelease, setDesktopRelease] = useState<DesktopReleaseInfo | null>(null);
  const [desktopReleaseError, setDesktopReleaseError] = useState<string | null>(null);
  const [isUpdateAvailableByVersion, setIsUpdateAvailableByVersion] = useState(false);
  const [isUpdateAvailableBySw, setIsUpdateAvailableBySw] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  const [alertCount, setAlertCount] = useState<number>(0);
  const [alertLoading, setAlertLoading] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const [notifications, setNotifications] = useState<PersonalNotification[]>([]);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);

  const isUpdateAvailable = isUpdateAvailableByVersion || isUpdateAvailableBySw;

  const isWeekHubRoot = pathname === '/';
  const isMobileWeekHub = pathname === '/mobile/week-hub';
  const isWeekHubPage = isWeekHubRoot || isMobileWeekHub;
  const isWeek = isWeekHubRoot && (!mode || mode === 'week');

  const weekModeKey = useMemo(() => {
    if (isMobileWeekHub) return 'week';
    if (pathname !== '/') return null;
    const m = (mode ?? '').trim();
    if (m === 'month' || m === 'year' || m === 'week') return m;
    return 'week';
  }, [isMobileWeekHub, mode, pathname]);

  const weekScheduleKindKey = useMemo(() => {
    if (!isWeekHubPage) return null;
    const k = (searchParams.get('kind') ?? '').trim().toLowerCase();
    return k === 'daily' ? 'daily' : 'normal';
  }, [isWeekHubPage, searchParams]);

  const isDailyWeek = isWeek && weekScheduleKindKey === 'daily';
  const isNormalWeek = isWeek && weekScheduleKindKey !== 'daily';

  const weekGridPrefsKey = useMemo(() => {
    if (!isWeekHubPage || !weekModeKey || !weekScheduleKindKey) return null;
    return `week-hub:${weekScheduleKindKey}:${weekModeKey}:gridPrefs`;
  }, [isWeekHubPage, weekModeKey, weekScheduleKindKey]);

  const defaultWeekGridPrefsForPage = useMemo(
    () => defaultWeekGridPrefs(isMobileWeekHub ? 'mobile' : 'desktop'),
    [isMobileWeekHub],
  );
  const defaultWeekHubCellFontSize = isMobileWeekHub ? 10 : 12;

  const [weekGridPrefs, setWeekGridPrefs] = useState<WeekGridPrefs>(() =>
    defaultWeekGridPrefs(isMobileWeekHub ? 'mobile' : 'desktop'),
  );
  const [weekColorPickMode, setWeekColorPickMode] = useState(false);
  const [isOverflowMenuOpen, setIsOverflowMenuOpen] = useState(false);
  const overflowMenuRef = useRef<HTMLDivElement | null>(null);

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

  const exitColorEditMode = useCallback(() => {
    writeWeekColorPickMode(false);
  }, [writeWeekColorPickMode]);

  useEffect(() => {
    // 通常時は必ずOFF（編集中のみONを維持したい）
    exitColorEditMode();
  }, [exitColorEditMode]);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;

    const userAgent = navigator.userAgent;
    const isWorkbenchShell = /\bCode\/\d+/i.test(userAgent);
    const nextIsElectronShell = /\bElectron\/\d+/i.test(userAgent) && !isWorkbenchShell;
    const isMobileUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);

    setIsElectronShell(nextIsElectronShell);
    setIsMobileBrowser(isMobileUa && !nextIsElectronShell);
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

  const fetchDesktopRelease = useCallback(async () => {
    try {
      setDesktopReleaseError(null);
      const r = await fetch('/api/desktop-release', { cache: 'no-store' });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      const release = obj?.release && typeof obj.release === 'object' ? (obj.release as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true || !release) throw new Error('bad_response');

      setDesktopRelease({
        version: typeof release.version === 'string' ? release.version : '0.0.0',
        downloadUrl: typeof release.downloadUrl === 'string' ? release.downloadUrl : null,
        notes: typeof release.notes === 'string' ? release.notes : null,
        publishedAt: typeof release.publishedAt === 'string' ? release.publishedAt : null,
        channel: typeof release.channel === 'string' ? release.channel : 'stable',
      });
    } catch {
      setDesktopRelease(null);
      setDesktopReleaseError('取得に失敗しました');
    }
  }, []);

  useEffect(() => {
    if (!isSettingsOpen) return;
    void fetchAppVersion();
    void fetchDesktopRelease();
  }, [fetchAppVersion, fetchDesktopRelease, isSettingsOpen]);

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
      await fetchDesktopRelease();
    } finally {
      setIsCheckingUpdate(false);
    }
  }, [fetchAppVersion, fetchDesktopRelease]);

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
      if (!txt) return defaultWeekGridPrefsForPage;
      const parsed = JSON.parse(txt) as unknown;
      return normalizeWeekGridPrefs(parsed, defaultWeekGridPrefsForPage);
    } catch {
      return defaultWeekGridPrefsForPage;
    }
  }, [defaultWeekGridPrefsForPage]);

  const readWeekGridPrefsRaw = useCallback((key: string): JsonObject => {
    try {
      const localKey = `masterHub.ui:${key}`;
      const txt = window.localStorage.getItem(localKey);
      if (!txt) return {};
      return asObject(JSON.parse(txt) as unknown) ?? {};
    } catch {
      return {};
    }
  }, []);

  const writeWeekGridPrefsPatch = useCallback(
    (patch: Partial<WeekGridPrefs>) => {
      if (!weekGridPrefsKey) return;
      try {
        const localKey = `masterHub.ui:${weekGridPrefsKey}`;
        const current = readWeekGridPrefs(weekGridPrefsKey);
        const currentRaw = readWeekGridPrefsRaw(weekGridPrefsKey);
        const next = normalizeWeekGridPrefs({ ...currentRaw, ...current, ...patch }, defaultWeekGridPrefsForPage);
        const payload = { ...currentRaw, ...next, v: WEEK_GRID_PREFS_VERSION };
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
            body: JSON.stringify({ userId: headerUserId, key: weekGridPrefsKey, value: payload }),
          }).catch(() => null);
        }
      } catch {
        // ignore
      }
    },
    [defaultWeekGridPrefsForPage, headerUserId, readWeekGridPrefs, readWeekGridPrefsRaw, weekGridPrefsKey],
  );

  useEffect(() => {
    if (!weekGridPrefsKey) return;

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
        const next = normalizeWeekGridPrefs(vObj && typeof vObj.v === 'number' ? vObj : raw, defaultWeekGridPrefsForPage);
        if (cancelled) return;
        setWeekGridPrefs(next);

        try {
          const localKey = `masterHub.ui:${weekGridPrefsKey}`;
          window.localStorage.setItem(
            localKey,
            JSON.stringify({ ...(vObj ?? {}), ...next, v: WEEK_GRID_PREFS_VERSION }),
          );
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
  }, [defaultWeekGridPrefsForPage, headerUserId, isSettingsOpen, pathname, readWeekColorPickMode, readWeekGridPrefs, weekGridPrefsKey]);
  const routeKey = useMemo(() => {
    const qs = searchParams.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }, [pathname, searchParams]);
  const [storedScheduleBackHref, setStoredScheduleBackHref] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = readStoredScheduleReturn();
    setStoredScheduleBackHref(stored?.href && stored.href !== routeKey ? stored.href : null);
  }, [routeKey]);

  const navIntentRef = useRef<'push' | 'back' | 'forward' | null>(null);
  const didInitNavRef = useRef(false);
  const navStateRef = useRef<{ stack: string[]; index: number }>({ stack: [], index: 0 });
  const [navStack, setNavStack] = useState<string[]>([]);
  const [navIndex, setNavIndex] = useState(0);
  const [navLen, setNavLen] = useState(1);
  const [historyOpenMode, setHistoryOpenMode] = useState<'preview' | 'panel' | null>(null);
  const [historyPreviewPosition, setHistoryPreviewPosition] = useState<{ left: number; top: number } | null>(null);
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
      setIsNotificationsOpen(false);
      setIsSettingsOpen(false);
    } catch {
      // ignore
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    if (!headerUserId || isMobileBrowser) {
      setNotifications([]);
      setNotificationUnreadCount(0);
      return;
    }

    setNotificationLoading(true);
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' });
      const json = (await res.json().catch(() => null)) as unknown;
      const obj = asObject(json);
      if (!res.ok || obj?.ok !== true) return;

      const items = Array.isArray(obj.notifications) ? obj.notifications : [];
      const parsed: PersonalNotification[] = items
        .map((item) => asObject(item))
        .map((item) => {
          const id = typeof item?.id === 'string' ? item.id : null;
          const title = typeof item?.title === 'string' ? item.title : null;
          const createdAt = typeof item?.createdAt === 'string' ? item.createdAt : null;
          if (!id || !title || !createdAt) return null;
          return {
            id,
            kind: typeof item?.kind === 'string' ? item.kind : 'LOGIN',
            title,
            body: typeof item?.body === 'string' ? item.body : null,
            isRead: item?.isRead === true,
            readAt: typeof item?.readAt === 'string' ? item.readAt : null,
            createdAt,
          } satisfies PersonalNotification;
        })
        .filter((item): item is PersonalNotification => !!item);

      setNotifications(parsed);
      setNotificationUnreadCount(typeof obj.unreadCount === 'number' ? obj.unreadCount : 0);
    } finally {
      setNotificationLoading(false);
    }
  }, [headerUserId, isMobileBrowser]);

  const markAllNotificationsRead = useCallback(async () => {
    if (!headerUserId) return;
    try {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ markAllRead: true }),
      });
      const json = (await res.json().catch(() => null)) as unknown;
      const obj = asObject(json);
      if (!res.ok || obj?.ok !== true) return;

      const readAt = new Date().toISOString();
      setNotifications((current) => current.map((item) => ({ ...item, isRead: true, readAt })));
      setNotificationUnreadCount(typeof obj.unreadCount === 'number' ? obj.unreadCount : 0);
    } catch {
      // ignore
    }
  }, [headerUserId]);

  const isHistoryOpen = historyOpenMode !== null;
  const isHistoryPanelOpen = historyOpenMode === 'panel';

  const updateHistoryPreviewPosition = useCallback(() => {
    const headerRect = headerRef.current?.getBoundingClientRect();
    const buttonRect = historyButtonRef.current?.getBoundingClientRect();
    if (!headerRect || !buttonRect) return;
    setHistoryPreviewPosition({
      left: Math.max(8, Math.round(headerRect.left + 8)),
      top: Math.round(buttonRect.bottom + 6),
    });
  }, []);

  const closeHistoryPopover = useCallback(() => {
    actions.historyMenu?.onHover?.(null);
    setHistoryOpenMode(null);
    setHistoryPreviewPosition(null);
  }, [actions.historyMenu]);

  const openHistoryPreview = useCallback(() => {
    if (!actions.historyMenu || historyOpenMode === 'panel') return;
    if (!actions.historyMenu.loaded && !actions.historyMenu.loading) {
      void actions.history?.onClick();
    }
    updateHistoryPreviewPosition();
    setHistoryOpenMode('preview');
  }, [actions.history, actions.historyMenu, historyOpenMode, updateHistoryPreviewPosition]);

  useEffect(() => {
    if (historyOpenMode !== 'preview') return;

    const update = () => updateHistoryPreviewPosition();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [historyOpenMode, updateHistoryPreviewPosition]);

  useEffect(() => {
    setHistoryOpenMode(null);
  }, [routeKey]);

  useEffect(() => {
    setIsOverflowMenuOpen(false);
  }, [routeKey]);

  useEffect(() => {
    setIsNotificationsOpen(false);
  }, [routeKey]);

  useOutsidePointerDown({
    open: isHistoryOpen,
    refs: [historyButtonRef, historyMenuRef],
    onOutside: closeHistoryPopover,
    capture: true,
  });

  useEffect(() => {
    setIsMultiMenuOpen(false);
  }, [routeKey]);

  useEffect(() => {
    if (!isOverflowMenuOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const el = overflowMenuRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setIsOverflowMenuOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [isOverflowMenuOpen]);

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
    if (!isNotificationsOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const el = notificationsRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setIsNotificationsOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [isNotificationsOpen]);

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
    let initialTimer: number | null = null;

    const fetchAlertCount = async () => {
      setAlertLoading(true);
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await fetch('/api/alerts/count', { cache: 'no-store' });
            if (!res.ok) {
              if (attempt === 0 && (res.status === 500 || res.status === 503)) {
                await new Promise((resolve) => window.setTimeout(resolve, 350));
                continue;
              }
              return;
            }

            const data = await res.json();
            if (mounted && data.ok && typeof data.total === 'number') {
              setAlertCount(data.total);
            }
            return;
          } catch (error) {
            if (attempt === 0) {
              await new Promise((resolve) => window.setTimeout(resolve, 350));
              continue;
            }
            console.error('Failed to fetch alert count:', error);
          }
        }
      } finally {
        if (mounted) {
          setAlertLoading(false);
        }
      }
    };

    initialTimer = window.setTimeout(() => {
      void fetchAlertCount();
    }, 350);

    // 5分ごとに更新
    const interval = setInterval(() => {
      void fetchAlertCount();
    }, 5 * 60 * 1000);

    return () => {
      mounted = false;
      if (initialTimer !== null) {
        window.clearTimeout(initialTimer);
      }
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
    if (!headerUserId || isMobileBrowser) {
      setNotifications([]);
      setNotificationUnreadCount(0);
      return;
    }

    void fetchNotifications();
    const interval = window.setInterval(() => {
      void fetchNotifications();
    }, 60 * 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [fetchNotifications, headerUserId, isMobileBrowser]);

  useEffect(() => {
    if (pathname !== '/') return;

    const now = new Date();
    const month = toMonthKey(now);

    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/sites?month=${encodeURIComponent(month)}&kind=${encodeURIComponent(scheduleKind)}`);
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
  }, [pathname, scheduleKind]);

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
      if (!isWeekHubPage) {
        document.documentElement.style.removeProperty('--weekhub-cell-font-size');
        return;
      }
      const v = px && Number.isFinite(px) ? Math.max(10, Math.min(30, Math.round(px))) : defaultWeekHubCellFontSize;
      document.documentElement.style.setProperty('--weekhub-cell-font-size', `${v}px`);
    },
    [defaultWeekHubCellFontSize, isWeekHubPage],
  );

  useEffect(() => {
    // Apply on navigation (local first)
    const local = readLocalPageFontSize(headerUserId) ?? (isWeekHubPage ? defaultWeekHubCellFontSize : null);
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
        const n = typeof raw === 'number' ? raw : isWeekHubPage ? defaultWeekHubCellFontSize : null;
        setPageFontSize(n);
        setPageFontSizeDraft(n == null ? '' : String(n));
        applyFontSize(n);
        writeLocalPageFontSize(headerUserId, n);
      } catch {
        if (cancelled) return;
        const fallback = readLocalPageFontSize(headerUserId) ?? (isWeekHubPage ? defaultWeekHubCellFontSize : null);
        setPageFontSize(fallback);
        setPageFontSizeDraft(fallback == null ? '' : String(fallback));
        applyFontSize(fallback);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyFontSize, defaultWeekHubCellFontSize, headerUserId, isWeekHubPage, pageFontKey, readLocalPageFontSize, writeLocalPageFontSize]);

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
    return navIndex > 0 || pathname !== '/' || Boolean(storedScheduleBackHref);
  }, [actions.undo, navIndex, pathname, storedScheduleBackHref]);

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
  const isHistoryButtonEnabled = Boolean(actions.historyPanel || actions.historyMenu || actions.history || navStack.length > 0);
  const scheduleEditButtonLabel = actions.save ? '編集終了' : actions.add ? '編集開始' : '編集準備中';
  const scheduleEditButtonDisabled = actions.save ? Boolean(actions.save.disabled) : actions.add ? Boolean(actions.add.disabled) : true;
  const scheduleEditHelpText = actions.save
    ? actions.save.title ?? '編集モード中です。右クリックメニューとセル操作を使えます。'
    : actions.add?.title ?? '予定編集の準備中です。';

  return (
    <header
      ref={headerRef}
      data-color-edit-slot="panel"
      className="sticky top-0 z-50 border-b border-zinc-200 backdrop-blur dark:border-zinc-800"
    >
      <div className="bg-white/60 dark:bg-black/60">
        <div className="mx-auto flex w-full max-w-screen-2xl min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-4 sm:py-3 lg:flex-nowrap lg:px-6">

          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:-ml-2">
            {/* Left small banner area (future: settings/alerts/notifications) */}
            <Link
              href="/"
              data-color-edit-slot="button"
              data-color-edit-id="header:home-title"
              className="text-sm font-medium tracking-tight"
            >
              Master Hub
            </Link>

            {/* 現場リスト三角ボタン */}
            <button
              type="button"
              data-color-edit-slot="button"
              data-color-edit-id="header:site-list-toggle"
              aria-label={isSiteListCollapsed ? '現場リストを広げる' : '現場リストを畳む'}
              className="ml-1 flex h-7 w-7 items-center justify-center rounded-full border bg-white shadow hover:bg-zinc-100 dark:bg-black dark:hover:bg-zinc-900"
              style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
              onClick={() => setIsSiteListCollapsed((v) => !v)}
            >
              {isSiteListCollapsed ? <span>&#9654;</span> : <span>&#9664;</span>}
            </button>

          <div className="flex min-w-0 items-center gap-2">
            {!isMobileBrowser ? (
              <div ref={notificationsRef} className="relative">
                <button
                  type="button"
                  data-color-edit-slot="button"
                  data-color-edit-id="header:notifications-toggle"
                  onClick={() => {
                    setIsSettingsOpen(false);
                    setIsNotificationsOpen((current) => {
                      const next = !current;
                      if (next) {
                        void fetchNotifications();
                      }
                      return next;
                    });
                  }}
                  aria-expanded={isNotificationsOpen}
                  className="relative rounded-md border border-zinc-200 bg-white/60 px-2.5 py-2 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                  title="個人通知"
                >
                  <span className="flex items-center justify-center">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M12 4a4 4 0 0 0-4 4v2.4c0 .6-.2 1.1-.6 1.5L6 13.3V15h12v-1.7l-1.4-1.4c-.4-.4-.6-.9-.6-1.5V8a4 4 0 0 0-4-4Z" />
                      <path d="M10 18a2 2 0 0 0 4 0" />
                    </svg>
                  </span>
                  {notificationUnreadCount > 0 ? (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
                      {notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}
                    </span>
                  ) : null}
                </button>

                {isNotificationsOpen ? (
                  <div
                    data-color-edit-id="header:notifications-panel"
                    data-color-edit-slot="border"
                    className="absolute left-0 top-full z-50 mt-1 w-[320px] overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-black"
                  >
                    <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                      <span>個人通知</span>
                      <button
                        type="button"
                        data-color-edit-id="header:notifications-mark-all-read"
                        onClick={() => void markAllNotificationsRead()}
                        className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[10px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                      >
                        すべて既読
                      </button>
                    </div>
                    <div className="max-h-[320px] overflow-auto overscroll-contain">
                      {notificationLoading ? (
                        <div className="px-3 py-3 text-[11px] text-zinc-500 dark:text-zinc-400">読み込み中…</div>
                      ) : notifications.length === 0 ? (
                        <div className="px-3 py-3 text-[11px] text-zinc-500 dark:text-zinc-400">通知はありません</div>
                      ) : (
                        notifications.map((notification) => (
                          <div
                            key={notification.id}
                            className={`border-b border-zinc-200 px-3 py-3 text-[11px] last:border-b-0 dark:border-zinc-800 ${
                              notification.isRead ? 'bg-transparent' : 'bg-red-50/50 dark:bg-red-950/20'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="font-medium text-zinc-800 dark:text-zinc-100">{notification.title}</div>
                              {!notification.isRead ? (
                                <span className="mt-1 inline-block h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
                              ) : null}
                            </div>
                            {notification.body ? (
                              <div className="mt-1 break-words text-zinc-600 dark:text-zinc-300">{notification.body}</div>
                            ) : null}
                            <div className="mt-1 text-zinc-400 dark:text-zinc-500">
                              {formatNotificationTime(notification.createdAt)}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div ref={settingsRef} className="relative" data-color-edit-keep>
              <button
                type="button"
                data-color-edit-slot="button"
                data-color-edit-id="header:settings-toggle"
                onClick={() => setIsSettingsOpen((v) => !v)}
                aria-expanded={isSettingsOpen}
                className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                title="設定"
              >
                設定
              </button>

              {isSettingsOpen ? (
                <div
                  data-color-edit-id="header:settings-panel"
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
                        data-color-edit-id="header:settings-font-size-14"
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
                        data-color-edit-id="header:settings-font-size-16"
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
                        data-color-edit-id="header:settings-font-size-18"
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

                    {pathname === '/' ? (
                      <>
                        <div className="border-t border-zinc-200 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                          予定編集
                        </div>
                        <div className="p-2 space-y-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (actions.save) {
                                void actions.save.onClick();
                                return;
                              }
                              void actions.add?.onClick();
                            }}
                            disabled={scheduleEditButtonDisabled}
                            className="w-full rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-[11px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                            title={scheduleEditHelpText}
                          >
                            {scheduleEditButtonLabel}
                          </button>
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            {actions.save
                              ? '右クリックで予定セルの従来メニューを開けます。色変更はセル操作の「色」を使います。終了すると通常表示へ戻ります。'
                              : '編集を開始すると、右クリックメニューとセル操作が使えます。色変更はセル操作の「色」を使います。'}
                          </div>
                        </div>
                      </>
                    ) : null}

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
                        ONの間、各ボタンや枠、背景を右クリックして色（＋濃淡）を編集します。右クリックした要素ごとに保存でき、必要なら共通設定へ戻せます。
                      </div>
                    </div>

                  {isWeekHubPage && weekGridPrefsKey ? (
                    <>
                      <div className="border-t border-zinc-200 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                        表示（セル）
                      </div>
                      <div className="p-2 space-y-2">
                        <div className="grid grid-cols-[90px_1fr] items-center gap-2">
                          <div className="text-[11px] text-zinc-600 dark:text-zinc-400">背景</div>
                          <select
                            value={weekGridPrefs.cellBg}
                            onChange={(e) =>
                              writeWeekGridPrefsPatch({
                                cellBg: isWeekGridCellBg(e.target.value) ? e.target.value : 'default',
                              })
                            }
                            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-[11px] dark:border-zinc-800 dark:bg-black"
                            aria-label="背景"
                          >
                            {WEEK_GRID_BG_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="grid grid-cols-[90px_1fr] items-center gap-2">
                          <div className="text-[11px] text-zinc-600 dark:text-zinc-400">文字色</div>
                          <select
                            value={weekGridPrefs.cellTextColor}
                            onChange={(e) =>
                              writeWeekGridPrefsPatch({
                                cellTextColor: isWeekGridTextColor(e.target.value) ? e.target.value : 'default',
                              })
                            }
                            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-[11px] dark:border-zinc-800 dark:bg-black"
                            aria-label="文字色"
                          >
                            {WEEK_GRID_TEXT_COLOR_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

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
                          <div className="text-[11px] text-zinc-600 dark:text-zinc-400">名前幅(px)</div>
                          <select
                            value={String(weekGridPrefs.nameColW)}
                            onChange={(e) => writeWeekGridPrefsPatch({ nameColW: Number(e.target.value) })}
                            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-[11px] dark:border-zinc-800 dark:bg-black"
                            aria-label="名前幅(px)"
                          >
                            {WEEK_GRID_NAME_WIDTH_OPTIONS.map((width) => (
                              <option key={width} value={width}>
                                {width}px
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="grid grid-cols-[90px_1fr] items-center gap-2">
                          <div className="text-[11px] text-zinc-600 dark:text-zinc-400">日幅(px)</div>
                          <select
                            value={String(weekGridPrefs.cellMinW)}
                            onChange={(e) => writeWeekGridPrefsPatch({ cellMinW: Number(e.target.value) })}
                            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-[11px] dark:border-zinc-800 dark:bg-black"
                            aria-label="日幅(px)"
                          >
                            {WEEK_GRID_DAY_WIDTH_OPTIONS.map((width) => (
                              <option key={width} value={width}>
                                {width}px
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="grid grid-cols-[90px_1fr] items-center gap-2">
                          <div className="text-[11px] text-zinc-600 dark:text-zinc-400">低(px)</div>
                          <select
                            value={String(weekGridPrefs.cellMinHCompact)}
                            onChange={(e) => writeWeekGridPrefsPatch({ cellMinHCompact: Number(e.target.value) })}
                            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-[11px] dark:border-zinc-800 dark:bg-black"
                            aria-label="低(px)"
                          >
                            {WEEK_GRID_COMPACT_HEIGHT_OPTIONS.map((height) => (
                              <option key={height} value={height}>
                                {height}px
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="grid grid-cols-[90px_1fr] items-center gap-2">
                          <div className="text-[11px] text-zinc-600 dark:text-zinc-400">高(px)</div>
                          <select
                            value={String(weekGridPrefs.cellMinHComfortable)}
                            onChange={(e) => writeWeekGridPrefsPatch({ cellMinHComfortable: Number(e.target.value) })}
                            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-[11px] dark:border-zinc-800 dark:bg-black"
                            aria-label="高(px)"
                          >
                            {WEEK_GRID_COMFORTABLE_HEIGHT_OPTIONS.map((height) => (
                              <option key={height} value={height}>
                                {height}px
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          現在: 名前 {weekGridPrefs.nameColW}px / 日幅 {weekGridPrefs.cellMinW}px / 低 {weekGridPrefs.cellMinHCompact}px / 高 {weekGridPrefs.cellMinHComfortable}px
                        </div>
                      </div>
                    </>
                  ) : null}

                    <div className="border-t border-zinc-200 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                      更新（アプデ）
                    </div>
                    <div className="p-2 space-y-2">
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

                      <div className="rounded-md border border-zinc-200 bg-white/50 p-2 text-[11px] dark:border-zinc-800 dark:bg-black/40">
                        <div className="font-medium text-zinc-700 dark:text-zinc-200">PCパッケージアプリ</div>
                        <div className="mt-1 text-zinc-600 dark:text-zinc-400">
                          {desktopRelease ? (
                            <>
                              <div>
                                配布版 v{desktopRelease.version}
                                {desktopRelease.channel ? ` / ${desktopRelease.channel}` : ''}
                              </div>
                              {desktopRelease.publishedAt ? <div>{desktopRelease.publishedAt}</div> : null}
                              {desktopRelease.notes ? <div className="mt-1 break-words">{desktopRelease.notes}</div> : null}
                              {desktopRelease.downloadUrl ? (
                                <>
                                  <a
                                    href={desktopRelease.downloadUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-2 inline-flex rounded-md border border-zinc-200 bg-white px-3 py-2 text-[11px] hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                                  >
                                    PCアプリをダウンロード
                                  </a>
                                  <div className="mt-2 break-all">{desktopRelease.downloadUrl}</div>
                                </>
                              ) : (
                                <div className="mt-2">ダウンロードリンク未設定</div>
                              )}
                            </>
                          ) : desktopReleaseError ? (
                            <div>{desktopReleaseError}</div>
                          ) : (
                            <div>取得中…</div>
                          )}
                        </div>
                      </div>
                    </div>

                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className={`${isElectronShell ? 'flex' : 'hidden'} min-w-0 flex-wrap items-center gap-1`}>
            <button
              type="button"
              data-color-edit-id="header-action-back"
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

                if (storedScheduleBackHref) {
                  navIntentRef.current = 'push';
                  router.push(storedScheduleBackHref);
                  return;
                }

                if (pathname !== '/') {
                  navIntentRef.current = 'back';
                  router.back();
                }
              }}
              disabled={!canBack}
              title={actions.undo ? actions.undo.title ?? '入力を取り消し' : 'ロールバック'}
              className={`${canBack ? '' : 'hidden xl:inline-flex'} mh-btn`}
            >
              戻る
            </button>

            <button
              type="button"
              data-color-edit-id="header-action-add"
              data-testid="header-action-save"
              onClick={() => {
                void actions.save?.onClick();
              }}
              disabled={!actions.save || actions.save.disabled}
              title={actions.save?.title ?? '作業や入力'}
              className={`${actions.save && !actions.save.disabled ? '' : 'hidden xl:inline-flex'} mh-btn-primary`}
            >
              保存
            </button>

            <button
              type="button"
              data-color-edit-id="header-action-forward"
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
              className={`${canForward ? '' : 'hidden xl:inline-flex'} mh-btn`}
            >
              進む
            </button>

            <button
              type="button"
              data-color-edit-id="header-action-add"
              data-testid="header-action-add"
              onClick={() => {
                void actions.add?.onClick();
              }}
              disabled={!actions.add || actions.add.disabled}
              title={actions.add?.title ?? '編集'}
              className={`${actions.add && !actions.add.disabled ? 'ml-1' : 'hidden xl:ml-1 xl:inline-flex'} mh-btn`}
            >
              編集
            </button>

            <div
              className={`${isHistoryButtonEnabled ? '' : 'hidden xl:block'} relative`}
              onPointerEnter={() => {
                if (!isHistoryButtonEnabled) return;
                openHistoryPreview();
              }}
            >
              <button
                type="button"
                ref={historyButtonRef}
                data-color-edit-id="header-action-history"
                data-testid="header-action-history"
                onClick={() => {
                  if (actions.historyPanel) {
                    void actions.history?.onClick();
                    if (isHistoryPanelOpen) {
                      closeHistoryPopover();
                      return;
                    }
                    setHistoryOpenMode('panel');
                    return;
                  }

                  const nextOpen = !isHistoryOpen;
                  if (nextOpen && actions.historyMenu && !actions.historyMenu.loaded && !actions.historyMenu.loading) {
                    void actions.history?.onClick();
                  }
                  if (!nextOpen) {
                    closeHistoryPopover();
                    return;
                  }
                  updateHistoryPreviewPosition();
                  setHistoryOpenMode('preview');
                }}
                disabled={!isHistoryButtonEnabled}
                title="履歴"
                className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
              >
                履歴
              </button>

              {isHistoryOpen ? (
                <div
                  ref={historyMenuRef}
                  data-color-edit-slot="border"
                  className={`${isHistoryPanelOpen ? 'absolute left-0 top-full mt-1' : 'fixed z-[90]'} overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-black ${
                    isHistoryPanelOpen ? (actions.historyPanel?.widthClassName ?? 'w-[480px]') : 'w-[560px] max-w-[min(calc(100vw-16px),560px)]'
                  }`}
                  style={
                    isHistoryPanelOpen || !historyPreviewPosition
                      ? undefined
                      : {
                          left: historyPreviewPosition.left,
                          top: historyPreviewPosition.top,
                        }
                  }
                >
                  {actions.history && !actions.historyPanel ? (
                    <button
                      type="button"
                      onClick={() => {
                        void actions.history?.onClick();
                        closeHistoryPopover();
                      }}
                      disabled={actions.history.disabled}
                      className="block w-full border-b border-zinc-200 px-3 py-2 text-left text-[11px] hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:hover:bg-zinc-900"
                      title={actions.history.title ?? '編集履歴'}
                    >
                      {actions.history.title ?? '編集履歴'}
                    </button>
                  ) : null}

                  {isHistoryPanelOpen && actions.historyPanel ? (
                    actions.historyPanel.content
                  ) : (
                    <div className="max-h-[32rem] overflow-auto py-1">
                      {actions.historyMenu ? (
                        <div className="flex flex-col gap-1 px-2 pb-1">
                          {actions.historyMenu.loading || !actions.historyMenu.loaded ? (
                            <div className="px-2 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">履歴を読み込み中...</div>
                          ) : null}
                          {actions.historyMenu.loaded && actions.historyMenu.items.length === 0 ? (
                            <div className="px-2 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">{actions.historyMenu.emptyLabel ?? '編集履歴はありません。'}</div>
                          ) : null}
                          {actions.historyMenu.items.slice(0, 12).map((it) => (
                            <div
                              key={it.key}
                              data-color-edit-slot="border"
                              className="rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs text-zinc-700 hover:border-red-300 hover:bg-red-50/40 dark:border-zinc-800 dark:bg-black dark:text-zinc-300 dark:hover:border-red-800 dark:hover:bg-red-950/20"
                              onPointerEnter={() => actions.historyMenu?.onHover?.(it.hover)}
                              onPointerLeave={() => actions.historyMenu?.onHover?.(null)}
                            >
                              <div className="grid grid-cols-[84px_minmax(0,0.55fr)_minmax(0,0.55fr)_46px] items-center gap-2 text-[11px]">
                                <div className="min-w-0 truncate text-zinc-500 dark:text-zinc-400" title={it.targetLabel ?? ''}>
                                  {it.targetLabel ?? ''}
                                </div>
                                <div className="min-w-0 truncate text-zinc-700 dark:text-zinc-200" title={it.beforeLabel}>
                                  {it.beforeLabel}
                                </div>
                                <div className="min-w-0 truncate text-zinc-700 dark:text-zinc-200" title={it.afterLabel}>
                                  {it.afterLabel}
                                </div>
                                <div className="truncate text-zinc-500 dark:text-zinc-400" title={it.editorLabel}>{it.editorLabel}</div>
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
                              {it.label}
                            </div>
                          ))
                      )}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {pathname === '/' ? (
              <div className="ml-0 hidden min-w-0 flex-wrap items-center gap-1 text-[11px] xl:flex" aria-label="当月アラート凡例">
                <div
                  data-color-edit-slot="button"
                  data-color-edit-id="header:alert-legend:invoice"
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-zinc-900 bg-white px-1.5 py-0.5 text-zinc-900"
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full bg-green-500 dark:bg-green-600"
                    aria-hidden="true"
                  />
                  <span>請求未</span>
                </div>
                <div
                  data-color-edit-slot="button"
                  data-color-edit-id="header:alert-legend:report"
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-zinc-900 bg-white px-1.5 py-0.5 text-zinc-900"
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full bg-orange-400 dark:bg-orange-500"
                    aria-hidden="true"
                  />
                  <span>報告未</span>
                </div>
                <div
                  data-color-edit-slot="button"
                  data-color-edit-id="header:alert-legend:unassigned"
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-zinc-900 bg-white px-1.5 py-0.5 text-zinc-900"
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full bg-red-500 dark:bg-red-600"
                    aria-hidden="true"
                  />
                  <span>未配置</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Right-side hub actions */}
        <div className={`${isMobileBrowser ? 'hidden' : 'flex'} min-w-0 max-w-full flex-wrap items-center justify-end gap-1`}>
          <div ref={overflowMenuRef} className="relative lg:hidden">
            <button
              type="button"
              data-color-edit-slot="button"
              data-color-edit-id="header:overflow-menu-toggle"
              onClick={() => {
                setIsMultiMenuOpen(false);
                setIsOverflowMenuOpen((v) => !v);
              }}
              className={`${navLinkClass(false)} relative`}
              aria-expanded={isOverflowMenuOpen}
              title="主要メニュー"
            >
              メニュー
              {!alertLoading && alertCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
                  {alertCount > 99 ? '99+' : alertCount}
                </span>
              ) : null}
            </button>

            {isOverflowMenuOpen ? (
              <div
                data-color-edit-slot="border"
                className="absolute right-0 top-full z-50 mt-1 w-[220px] overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-black"
              >
                <div className="max-h-[70vh] overflow-auto py-1">
                  <Link
                    href="/alerts"
                    onClick={() => {
                      navIntentRef.current = 'push';
                      setIsOverflowMenuOpen(false);
                    }}
                    className={`block px-3 py-2 text-[11px] hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                      isAlerts ? 'bg-zinc-100 font-medium dark:bg-zinc-900' : ''
                    }`}
                    aria-current={isAlerts ? 'page' : undefined}
                  >
                    アラート
                  </Link>
                  <Link
                    href="/accounting"
                    onClick={() => {
                      navIntentRef.current = 'push';
                      setIsOverflowMenuOpen(false);
                    }}
                    className={`block px-3 py-2 text-[11px] hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                      isAccounting ? 'bg-zinc-100 font-medium dark:bg-zinc-900' : ''
                    }`}
                    aria-current={isAccounting ? 'page' : undefined}
                  >
                    会計
                  </Link>
                  <Link
                    href="/reports"
                    onClick={() => {
                      navIntentRef.current = 'push';
                      setIsOverflowMenuOpen(false);
                    }}
                    className={`block px-3 py-2 text-[11px] hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                      isReports ? 'bg-zinc-100 font-medium dark:bg-zinc-900' : ''
                    }`}
                    aria-current={isReports ? 'page' : undefined}
                  >
                    報告書
                  </Link>
                  <Link
                    href="/invoices"
                    onClick={() => {
                      navIntentRef.current = 'push';
                      setIsOverflowMenuOpen(false);
                    }}
                    className={`block px-3 py-2 text-[11px] hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                      isInvoices ? 'bg-zinc-100 font-medium dark:bg-zinc-900' : ''
                    }`}
                    aria-current={isInvoices ? 'page' : undefined}
                  >
                    請求書
                  </Link>
                  <Link
                    href={managementHref}
                    onClick={() => {
                      navIntentRef.current = 'push';
                      setIsOverflowMenuOpen(false);
                    }}
                    className={`block px-3 py-2 text-[11px] hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                      isManagement ? 'bg-zinc-100 font-medium dark:bg-zinc-900' : ''
                    }`}
                    aria-current={isManagement ? 'page' : undefined}
                  >
                    管理
                  </Link>
                  <Link
                    href={siteLedgerHref}
                    onClick={() => {
                      navIntentRef.current = 'push';
                      setIsOverflowMenuOpen(false);
                    }}
                    className={`block px-3 py-2 text-[11px] hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                      isSiteLedger ? 'bg-zinc-100 font-medium dark:bg-zinc-900' : ''
                    }`}
                    aria-current={isSiteLedger ? 'page' : undefined}
                  >
                    現場台帳
                  </Link>
                  <Link
                    href="/partners"
                    onClick={() => {
                      navIntentRef.current = 'push';
                      setIsOverflowMenuOpen(false);
                    }}
                    className={`block px-3 py-2 text-[11px] hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                      isPartners ? 'bg-zinc-100 font-medium dark:bg-zinc-900' : ''
                    }`}
                    aria-current={isPartners ? 'page' : undefined}
                  >
                    関係会社
                  </Link>
                  <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
                  <button
                    type="button"
                    onClick={() => {
                      navIntentRef.current = 'push';
                      setIsOverflowMenuOpen(false);
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
                      setIsOverflowMenuOpen(false);
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
                      setIsOverflowMenuOpen(false);
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

          <Link
            href="/alerts"
            data-color-edit-slot="button"
            data-color-edit-id="header:nav:alerts"
            onClick={() => {
              navIntentRef.current = 'push';
            }}
            className={`relative hidden rounded-md border px-3 py-2 text-[11px] lg:inline-flex ${
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
            href="/?mode=week&kind=normal"
            data-color-edit-slot="button"
            data-color-edit-id="header:nav:week"
            onClick={() => {
              navIntentRef.current = 'push';
              markForceDesktopWeekHomeOnce();
              if (pathname === '/') {
                try {
                  window.dispatchEvent(new CustomEvent('masterHub:jumpCurrentWeek'));
                } catch {
                  // ignore
                }
              }
            }}
            className={navLinkClass(isNormalWeek)}
            title="週予定へ（週モードに戻す）"
            aria-current={isNormalWeek ? 'page' : undefined}
          >
            週予定
          </Link>
          <Link
            href="/accounting"
            data-color-edit-slot="button"
            data-color-edit-id="header:nav:accounting"
            onClick={() => {
              navIntentRef.current = 'push';
            }}
            className={navLinkClass(isAccounting, 'hidden lg:inline-flex')}
            title="会計（PDF/CSV/テンプレ/一覧）へ"
            aria-current={isAccounting ? 'page' : undefined}
          >
            会計
          </Link>

          <Link
            href="/reports"
            data-color-edit-slot="button"
            data-color-edit-id="header:nav:reports"
            onClick={() => {
              navIntentRef.current = 'push';
            }}
            className={navLinkClass(isReports, 'hidden lg:inline-flex')}
            title="報告書（送信/履歴/検索）へ"
            aria-current={isReports ? 'page' : undefined}
          >
            報告書
          </Link>

          <Link
            href="/invoices"
            data-color-edit-slot="button"
            data-color-edit-id="header:nav:invoices"
            onClick={() => {
              navIntentRef.current = 'push';
            }}
            className={navLinkClass(isInvoices, 'hidden lg:inline-flex')}
            title="請求書（送信/履歴/検索）へ"
            aria-current={isInvoices ? 'page' : undefined}
          >
            請求書
          </Link>
          <Link
            href={managementHref}
            data-color-edit-slot="button"
            data-color-edit-id="header:nav:management"
            onClick={() => {
              navIntentRef.current = 'push';
            }}
            className={navLinkClass(isManagement, 'hidden lg:inline-flex')}
            title="リピート/自動入力などの管理へ"
            aria-current={isManagement ? 'page' : undefined}
          >
            管理
          </Link>
          <Link
            href={siteLedgerHref}
            data-color-edit-slot="button"
            data-color-edit-id="header:nav:site-ledger"
            onClick={() => {
              navIntentRef.current = 'push';
            }}
            className={navLinkClass(isSiteLedger, 'hidden lg:inline-flex')}
            title="現場台帳（追加/詳細）へ"
            aria-current={isSiteLedger ? 'page' : undefined}
          >
            現場台帳
          </Link>
          <Link
            href="/partners"
            data-color-edit-slot="button"
            data-color-edit-id="header:nav:partners"
            onClick={() => {
              navIntentRef.current = 'push';
            }}
            className={navLinkClass(isPartners, 'hidden lg:inline-flex')}
            title="関係会社へ"
            aria-current={isPartners ? 'page' : undefined}
          >
            関係会社
          </Link>

          <Link
            href="/?mode=week&kind=daily"
            data-color-edit-slot="button"
            data-color-edit-id="header:nav:daily"
            onClick={() => {
              navIntentRef.current = 'push';
            }}
            className={navLinkClass(isDailyWeek, 'hidden lg:inline-flex')}
            title="日常予定へ"
            aria-current={isDailyWeek ? 'page' : undefined}
          >
            日常
          </Link>

          <div ref={multiMenuRef} className="relative">
            <button
              type="button"
              data-color-edit-slot="button"
              data-color-edit-id="header:nav:multi"
              onClick={() => {
                setIsOverflowMenuOpen(false);
                setIsMultiMenuOpen((v) => !v);
              }}
              className={navLinkClass(isMulti, 'hidden lg:inline-flex')}
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
