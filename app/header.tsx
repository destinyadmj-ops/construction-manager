"use client";

import { useOutsidePointerDown } from './use-outside-pointerdown';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PortalMenu from './components/portal-menu';
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
          <div className="flex min-w-0 items-center gap-2">
            <div ref={settingsRef} className="relative" data-color-edit-keep data-color-edit-ui>
              <button
                type="button"
                ref={settingsButtonRef}
                onClick={() => setIsSettingsOpen((v) => !v)}
                aria-expanded={isSettingsOpen}
                className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                title="設定"
              >
                設定
              </button>

              <PortalMenu anchorRef={settingsButtonRef} isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} width={320} offset={{ y: 6 }}>
                <div data-color-edit-slot="border" className="w-full overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-black">
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
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">現在: {(pageFontSize ?? 12)}px</div>
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
                        <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">ユーザー未設定のため、この端末内のみ保存されます</div>
                      ) : null}
                    </div>

                    <div className="border-t border-zinc-200 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">ユーザー</div>
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
                        <div className="border-t border-zinc-200 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">予定編集</div>
                        <div className="p-2 space-y-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (actions.save) {
                                writeColorEditMode(false);
                                setWeekColorPickMode(false);
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
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{scheduleEditHelpText}</div>
                        </div>
                      </>
                    ) : null}

                    <div className="border-t border-zinc-200 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">線（個人）</div>
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
                        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">ユーザー未設定のため、この端末内のみ保存されます</div>
                      ) : null}
                    </div>

                    <div className="border-t border-zinc-200 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">カラー編集（全画面）</div>
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
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">ONの間、画面の任意箇所をクリックして色（＋濃淡）を編集します（このページごと・アカウント別に保存）。</div>
                    </div>
                  </div>
                </div>
              </PortalMenu>
            </div>
          </div>
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
  const isHistoryButtonEnabled = Boolean(actions.historyPanel || actions.historyMenu || actions.history || navStack.length > 0);
  const scheduleEditButtonLabel = actions.save ? '編集終了' : actions.add ? '編集開始' : '編集準備中';
  const scheduleEditButtonDisabled = actions.save ? Boolean(actions.save.disabled) : actions.add ? Boolean(actions.add.disabled) : true;
  const scheduleEditHelpText = actions.save
    ? actions.save.title ?? '編集モード中です。終了すると通常表示に戻ります。'
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

          <div className="flex min-w-0 items-center gap-2">
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
                                writeColorEditMode(false);
                                setWeekColorPickMode(false);
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
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{scheduleEditHelpText}</div>
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
                    </div>

                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className={`${isElectronShell ? 'flex' : 'hidden'} min-w-0 flex-wrap items-center gap-1`}>
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
              className={`${canBack ? '' : 'hidden xl:inline-flex'} mh-btn`}
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
              className={`${actions.save && !actions.save.disabled ? '' : 'hidden xl:inline-flex'} mh-btn-primary`}
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
              className={`${canForward ? '' : 'hidden xl:inline-flex'} mh-btn`}
            >
              進む
            </button>

            <button
              type="button"
              data-testid="header-action-add"
              onClick={() => void actions.add?.onClick()}
              disabled={!actions.add || actions.add.disabled}
              title={actions.add?.title ?? '編集'}
              className={`${actions.add && !actions.add.disabled ? 'ml-1' : 'hidden xl:ml-1 xl:inline-flex'} mh-btn`}
            >
              編集
            </button>

            <div className={`${isHistoryButtonEnabled ? '' : 'hidden xl:block'} relative`}>
              <button
                type="button"
                ref={historyButtonRef}
                data-testid="header-action-history"
                onClick={() => {
                  const nextOpen = !isHistoryOpen;
                  if (nextOpen && actions.historyPanel) {
                    void actions.history?.onClick();
                  }
                  setIsHistoryOpen(nextOpen);
                }}
                disabled={!isHistoryButtonEnabled}
                title="履歴"
                className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
              >
                履歴
              </button>

              <PortalMenu anchorRef={historyButtonRef} isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} width={480} offset={{ y: 6 }}>
                <div data-color-edit-slot="border" className={`w-full overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-black ${
                  actions.historyPanel?.widthClassName ?? 'w-[480px]'
                }`}>
                  {actions.history && !actions.historyPanel ? (
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

                  {actions.historyPanel ? (
                    actions.historyPanel.content
                  ) : (
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
                              <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 text-[11px]">
                                <div className="text-zinc-500 dark:text-zinc-400">{new Date(it.at).toLocaleString()}</div>
                                <div className="min-w-0 truncate text-zinc-700 dark:text-zinc-200" title={it.beforeLabel}>
                                  {it.beforeLabel}
                                </div>
                                <div className="min-w-0 truncate text-zinc-700 dark:text-zinc-200" title={it.afterLabel}>
                                  {it.afterLabel}
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
                              {it.label}
                            </div>
                          ))
                      )}
                    </div>
                  )}
                </div>
              </PortalMenu>
            </div>

            {pathname === '/' ? (
              <div className="ml-0 hidden min-w-0 flex-wrap items-center gap-1 text-[11px] xl:flex" aria-label="当月アラート凡例">
                <div className="inline-flex shrink-0 items-center gap-1 rounded-full border border-zinc-900 bg-white px-1.5 py-0.5 text-zinc-900">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full bg-green-500 dark:bg-green-600"
                    aria-hidden="true"
                  />
                  <span>請求未</span>
                </div>
                <div className="inline-flex shrink-0 items-center gap-1 rounded-full border border-zinc-900 bg-white px-1.5 py-0.5 text-zinc-900">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full bg-orange-400 dark:bg-orange-500"
                    aria-hidden="true"
                  />
                  <span>報告未</span>
                </div>
                <div className="inline-flex shrink-0 items-center gap-1 rounded-full border border-zinc-900 bg-white px-1.5 py-0.5 text-zinc-900">
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
                    href="/management"
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
                    href="/site-ledger"
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
            className={navLinkClass(isAccounting, 'hidden lg:inline-flex')}
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
            className={navLinkClass(isReports, 'hidden lg:inline-flex')}
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
            className={navLinkClass(isInvoices, 'hidden lg:inline-flex')}
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
            className={navLinkClass(isManagement, 'hidden lg:inline-flex')}
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
            className={navLinkClass(isSiteLedger, 'hidden lg:inline-flex')}
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
            className={navLinkClass(isPartners, 'hidden lg:inline-flex')}
            title="関係会社へ"
            aria-current={isPartners ? 'page' : undefined}
          >
            関係会社
          </Link>

          <div ref={multiMenuRef} className="relative">
            <button
              type="button"
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
