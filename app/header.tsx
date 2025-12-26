"use client";

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHeaderActions } from './header-actions';

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

  const isWeek = pathname === '/' && (!mode || mode === 'week');
  const routeKey = useMemo(() => {
    const qs = searchParams.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }, [pathname, searchParams]);

  const navIntentRef = useRef<'push' | 'back' | 'forward' | null>(null);
  const didInitNavRef = useRef(false);
  const navStateRef = useRef<{ stack: string[]; index: number }>({ stack: [], index: 0 });
  const [navIndex, setNavIndex] = useState(0);
  const [navLen, setNavLen] = useState(1);

  const setNavState = useCallback((stack: string[], index: number) => {
    navStateRef.current = { stack, index };
    setNavIndex(index);
    setNavLen(stack.length || 1);
    try {
      window.sessionStorage.setItem('masterHub.navStack', JSON.stringify(stack));
      window.sessionStorage.setItem('masterHub.navIndex', String(index));
    } catch {
      // ignore
    }
  }, []);

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

    const intent = navIntentRef.current;
    navIntentRef.current = null;

    const cur = navStateRef.current;
    const stack = cur.stack.length ? cur.stack : [routeKey];
    let index = Math.max(0, Math.min(stack.length - 1, cur.index));
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
      const h = Math.max(0, Math.round(el.getBoundingClientRect().height));
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

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-50 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-black/80"
    >
      <div className="mx-auto flex w-full max-w-screen-2xl items-center justify-between gap-4 px-4 py-3 lg:px-6">
        <div className="flex items-center gap-3">
          {/* Left small banner area (future: settings/alerts/notifications) */}
          <Link href="/" className="text-sm font-medium tracking-tight">
            Master Hub
          </Link>

          <div className="flex items-center gap-1">
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
              className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
            >
              戻る
            </button>

            <button
              type="button"
              data-testid="header-action-save"
              onClick={() => void actions.save?.onClick()}
              disabled={!actions.save || actions.save.disabled}
              title={actions.save?.title ?? '作業や入力'}
              className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
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
              className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
            >
              進む
            </button>

            <button
              type="button"
              data-testid="header-action-add"
              onClick={() => void actions.add?.onClick()}
              disabled={!actions.add || actions.add.disabled}
              title={actions.add?.title ?? '追加'}
              className="ml-1 rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
            >
              追加
            </button>
          </div>
        </div>

        {/* Right-side hub actions */}
        <div className="flex flex-wrap items-center justify-end gap-2">
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
            className={navLinkClass(isAccounting)}
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
            className={navLinkClass(isReports)}
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
            className={navLinkClass(isInvoices)}
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
            className={navLinkClass(isManagement)}
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
            className={navLinkClass(isSiteLedger)}
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
            className={navLinkClass(isPartners)}
            title="関係会社へ"
            aria-current={isPartners ? 'page' : undefined}
          >
            関係会社
          </Link>
          <Link
            href="/multi"
            onClick={() => {
              navIntentRef.current = 'push';
            }}
            className={navLinkClass(isMulti)}
            title="週/月/年の切替へ"
            aria-current={isMulti ? 'page' : undefined}
          >
            マルチ
          </Link>
        </div>
      </div>
    </header>
  );
}
