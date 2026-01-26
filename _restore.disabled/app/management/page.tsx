'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHeaderActions } from '../header-actions';
import { useOutsidePointerDown } from '../use-outside-pointerdown';

type DailySummaryItem = {
  userId: string;
  name: string | null;
  email: string | null;
  workDays: number;
  workMinutes: number;
  workHoursText: string;
};

type CsvCol = 'date' | 'site' | 'user' | 'start' | 'end';

type ApiUser = {
  id: string;
  name: string | null;
  email: string | null;
  canEditSchedule: boolean | undefined;
  canGrantScheduleEdit: boolean | undefined;
};
type ApiSite = {
  id: string;
  companyName: string | null;
  name: string;
  createdAt: string;
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

function startOfMonthYmd(now: Date) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
}

function endOfMonthYmd(now: Date) {
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`;
}


export default function ManagementPage() {
  const { setAddAction, setUndoAction, setRedoAction } = useHeaderActions();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [scheduleKind, setScheduleKind] = useState<'normal' | 'daily'>(() => {
    const k = (searchParams.get('kind') ?? '').trim().toLowerCase();
    return k === 'daily' ? 'daily' : 'normal';
  });
  const [sites, setSites] = useState<ApiSite[]>([]);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [selectedUserId, setSelectedUserId] = useState<string>('');

  const [permTargetUserId, setPermTargetUserId] = useState<string>('');
  const [permMsg, setPermMsg] = useState<string | null>(null);
  const [isPermSaving, setIsPermSaving] = useState(false);

  const [autoFillMonth, setAutoFillMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  });
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [autoFillResult, setAutoFillResult] = useState<
    | { ok: true; created: number; skipped: number; reason?: string }
    | { ok: false; error: string }
    | null
  >(null);

  const [dailySiteCreateOpen, setDailySiteCreateOpen] = useState(false);
  const dailySiteCreateButtonRef = useRef<HTMLButtonElement | null>(null);
  const dailySiteCreatePanelRef = useRef<HTMLDivElement | null>(null);
  const [dailySiteName, setDailySiteName] = useState('');
  const [dailySiteCreateMsg, setDailySiteCreateMsg] = useState<string | null>(null);
  const [isDailySiteCreating, setIsDailySiteCreating] = useState(false);

  const [dailyToolsFrom, setDailyToolsFrom] = useState<string>(() => startOfMonthYmd(new Date()));
  const [dailyToolsTo, setDailyToolsTo] = useState<string>(() => endOfMonthYmd(new Date()));
  const [dailyToolsSiteId, setDailyToolsSiteId] = useState<string>('');

  const [dailyWorkExplorerOpen, setDailyWorkExplorerOpen] = useState(false);
  const dailyWorkButtonRef = useRef<HTMLButtonElement | null>(null);
  const dailyWorkPanelRef = useRef<HTMLDivElement | null>(null);
  const [dailyWorkBusy, setDailyWorkBusy] = useState(false);
  const [dailyWorkMsg, setDailyWorkMsg] = useState<string | null>(null);
  const [dailyWorkItems, setDailyWorkItems] = useState<DailySummaryItem[]>([]);

  const [dailyCsvOpen, setDailyCsvOpen] = useState(false);
  const dailyCsvButtonRef = useRef<HTMLButtonElement | null>(null);
  const dailyCsvPanelRef = useRef<HTMLDivElement | null>(null);
  const [dailyCsvBusy, setDailyCsvBusy] = useState(false);
  const [dailyCsvMsg, setDailyCsvMsg] = useState<string | null>(null);
  const [dailyCsvCols, setDailyCsvCols] = useState<CsvCol[]>(['date', 'site', 'user', 'start', 'end']);
  const [dailyCsvUserIds, setDailyCsvUserIds] = useState<string[]>([]);

  const weekDays = useMemo(() => {
    const ws = startOfWeekMonday(new Date());
    return Array.from({ length: 7 }, (_, i) => toYmd(new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + i)));
  }, []);

  useEffect(() => {
    const k = (searchParams.get('kind') ?? '').trim().toLowerCase();
    const next = k === 'daily' ? 'daily' : 'normal';
    setScheduleKind(next);
  }, [searchParams]);

  useEffect(() => {
    // Close daily-site-create UI when leaving daily context.
    if (scheduleKind !== 'daily') {
      setDailySiteCreateOpen(false);
      setDailySiteCreateMsg(null);
      setDailyWorkExplorerOpen(false);
      setDailyCsvOpen(false);
      setDailyToolsSiteId('');
    }
  }, [scheduleKind]);

  useOutsidePointerDown({
    open: dailySiteCreateOpen,
    refs: [dailySiteCreateButtonRef, dailySiteCreatePanelRef],
    onOutside: () => setDailySiteCreateOpen(false),
    capture: true,
  });

  useOutsidePointerDown({
    open: dailyWorkExplorerOpen,
    refs: [dailyWorkButtonRef, dailyWorkPanelRef],
    onOutside: () => setDailyWorkExplorerOpen(false),
    capture: true,
  });

  useOutsidePointerDown({
    open: dailyCsvOpen,
    refs: [dailyCsvButtonRef, dailyCsvPanelRef],
    onOutside: () => setDailyCsvOpen(false),
    capture: true,
  });

  useEffect(() => {
    if (scheduleKind !== 'daily') return;
    // Default CSV selection = all users.
    const ids = users.map((u) => u.id);
    setDailyCsvUserIds((cur) => {
      if (cur.length > 0) return cur;
      return ids;
    });
  }, [scheduleKind, users]);

  const loadDailyWorkSummary = useCallback(async () => {
    if (scheduleKind !== 'daily') return;
    setDailyWorkMsg(null);
    setDailyWorkBusy(true);
    try {
      const sp = new URLSearchParams({ from: dailyToolsFrom, to: dailyToolsTo });
      if (dailyToolsSiteId) sp.set('siteId', dailyToolsSiteId);
      const r = await fetch(`/api/time-clocks/summary?${sp.toString()}`);
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      const itemsRaw = Array.isArray(obj?.items) ? (obj?.items as unknown[]) : [];
      const items: DailySummaryItem[] = itemsRaw
        .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null))
        .map((o) => {
          const userId = typeof o?.userId === 'string' ? o.userId : null;
          if (!userId) return null;
          const name = typeof o?.name === 'string' ? o.name : null;
          const email = typeof o?.email === 'string' ? o.email : null;
          const workDays = typeof o?.workDays === 'number' ? o.workDays : 0;
          const workMinutes = typeof o?.workMinutes === 'number' ? o.workMinutes : 0;
          const workHoursText = typeof o?.workHoursText === 'string' ? o.workHoursText : '';
          return { userId, name, email, workDays, workMinutes, workHoursText } satisfies DailySummaryItem;
        })
        .filter((x): x is DailySummaryItem => !!x);

      if (!r.ok || obj?.ok !== true) {
        const msg = typeof obj?.error === 'string' ? (obj.error as string) : `HTTP ${r.status}`;
        setDailyWorkMsg(msg);
        setDailyWorkItems([]);
        return;
      }

      setDailyWorkItems(items);
      if (items.length === 0) setDailyWorkMsg('該当データがありません。');
    } catch (e) {
      setDailyWorkMsg(e instanceof Error ? e.message : '取得に失敗しました');
      setDailyWorkItems([]);
    } finally {
      setDailyWorkBusy(false);
    }
  }, [dailyToolsFrom, dailyToolsSiteId, dailyToolsTo, scheduleKind]);

  const downloadDailyCsv = useCallback(async () => {
    if (scheduleKind !== 'daily') return;
    setDailyCsvMsg(null);
    setDailyCsvBusy(true);
    try {
      const sp = new URLSearchParams({
        from: dailyToolsFrom,
        to: dailyToolsTo,
        userIds: dailyCsvUserIds.join(','),
        columns: dailyCsvCols.join(','),
      });
      if (dailyToolsSiteId) sp.set('siteId', dailyToolsSiteId);
      const r = await fetch(`/api/time-clocks/export?${sp.toString()}`);
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        const msg = typeof obj?.error === 'string' ? (obj.error as string) : `HTTP ${r.status}`;
        setDailyCsvMsg(msg);
        return;
      }
      const blob = await r.blob();
      const url = window.URL.createObjectURL(blob);

      const contentDisp = r.headers.get('content-disposition') ?? '';
      const mQuoted = contentDisp.match(/filename="([^"]+)"/i);
      const mStar = contentDisp.match(/filename\*=UTF-8''([^;\s]+)/i);
      const filename =
        (mQuoted?.[1] ? mQuoted[1] : null) ??
        (mStar?.[1] ? (() => {
          try {
            return decodeURIComponent(mStar[1]);
          } catch {
            return mStar[1];
          }
        })() : null) ??
        `daily_timeclocks_${dailyToolsFrom}_to_${dailyToolsTo}.csv`;

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setDailyCsvMsg('CSVを出力しました');
    } catch (e) {
      setDailyCsvMsg(e instanceof Error ? e.message : 'CSV出力に失敗しました');
    } finally {
      setDailyCsvBusy(false);
    }
  }, [dailyCsvCols, dailyCsvUserIds, dailyToolsFrom, dailyToolsSiteId, dailyToolsTo, scheduleKind]);

  const loadSites = useCallback(async () => {
    setStatusMsg(null);
    try {
      const r = await fetch(`/api/sites?kind=${encodeURIComponent(scheduleKind)}`);
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) throw new Error((obj?.error as string) || `HTTP ${r.status}`);
      const raw = Array.isArray(obj.sites) ? (obj.sites as unknown[]) : [];
      const parsed: ApiSite[] = raw
        .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null))
        .map((o) => {
          const id = typeof o?.id === 'string' ? o.id : null;
          const name = typeof o?.name === 'string' ? o.name : null;
          const companyName = typeof o?.companyName === 'string' ? o.companyName : o?.companyName === null ? null : null;
          const createdAt = typeof o?.createdAt === 'string' ? o.createdAt : new Date().toISOString();
          if (!id || !name) return null;
          return { id, name, companyName, createdAt };
        })
        .filter((x): x is ApiSite => !!x);
      setSites(parsed);
      if (!selectedSiteId && parsed.length > 0) {
        setSelectedSiteId(parsed[0].id);
      }
    } catch (e) {
      setSites([]);
      setStatusMsg(e instanceof Error ? `現場の取得に失敗: ${e.message}` : '現場の取得に失敗しました');
    }
  }, [scheduleKind, selectedSiteId]);

  const loadUsers = useCallback(async () => {
    try {
      const r = await fetch(`/api/users/schedule-permissions?kind=${encodeURIComponent(scheduleKind)}`);
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      const raw = Array.isArray(obj?.users) ? (obj?.users as unknown[]) : [];
      const parsed: ApiUser[] = raw
        .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null))
        .map((o) => {
          const id = typeof o?.id === 'string' ? o.id : null;
          if (!id) return null;
          const name = typeof o?.name === 'string' ? o.name : null;
          const email = typeof o?.email === 'string' ? o.email : null;
          const canEditSchedule = typeof o?.canEditSchedule === 'boolean' ? o.canEditSchedule : undefined;
          const canGrantScheduleEdit =
            typeof o?.canGrantScheduleEdit === 'boolean' ? o.canGrantScheduleEdit : undefined;
          return { id, name, email, canEditSchedule, canGrantScheduleEdit };
        })
        .filter((x): x is ApiUser => !!x);
      setUsers(parsed);
      if (!selectedUserId && parsed.length > 0) setSelectedUserId(parsed[0].id);
      if (!permTargetUserId && parsed.length > 0) setPermTargetUserId(parsed[0].id);
    } catch {
      setUsers([]);
    }
  }, [permTargetUserId, scheduleKind, selectedUserId]);

  const permTarget = useMemo(() => {
    const id = (permTargetUserId || '').trim();
    return id ? users.find((u) => u.id === id) ?? null : null;
  }, [permTargetUserId, users]);

  const setUserPerms = useCallback(
    async (userId: string, patch: { canEditSchedule?: boolean; canGrantScheduleEdit?: boolean }) => {
      setPermMsg(null);
      setIsPermSaving(true);
      try {
        const r = await fetch('/api/users/schedule-permissions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId, ...patch }),
        });
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        if (!r.ok || obj?.ok !== true) throw new Error((obj?.error as string) || `HTTP ${r.status}`);
        setPermMsg('更新しました');
        await loadUsers();
      } catch (e) {
        setPermMsg(e instanceof Error ? `更新に失敗: ${e.message}` : '更新に失敗しました');
      } finally {
        setIsPermSaving(false);
      }
    },
    [loadUsers],
  );

  useEffect(() => {
    void loadSites();
    void loadUsers();
  }, [loadSites, loadUsers]);

  useEffect(() => {
    setAddAction(undefined);
    return () => {
      setAddAction(undefined);
    };
  }, [setAddAction]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const isEditable = (el: Element | null) => {
      if (!el) return false;
      if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
      if (el instanceof HTMLInputElement) {
        const t = (el.type || '').toLowerCase();
        const isTextLike = t === 'text' || t === 'search' || t === 'email' || t === 'number' || t === 'date' || t === 'month';
        return isTextLike && !el.disabled && !el.readOnly;
      }
      return false;
    };

    const enable = () => {
      setUndoAction({
        onClick: () => {
          try {
            document.execCommand('undo');
          } catch {
            // ignore
          }
        },
        title: '入力を取り消し',
      });
      setRedoAction({
        onClick: () => {
          try {
            document.execCommand('redo');
          } catch {
            // ignore
          }
        },
        title: '入力をやり直し',
      });
    };

    const maybeClear = () => {
      const active = document.activeElement;
      if (!(active instanceof Element) || !root.contains(active) || !isEditable(active)) {
        setUndoAction(undefined);
        setRedoAction(undefined);
      }
    };

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!isEditable(target)) return;
      enable();
    };

    const onFocusOut = () => {
      queueMicrotask(() => maybeClear());
    };

    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    return () => {
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
      setUndoAction(undefined);
      setRedoAction(undefined);
    };
  }, [setRedoAction, setUndoAction]);

  return (
    <main className="mx-auto w-full max-w-screen-2xl px-4 py-4 lg:px-6">
      <div
        id="management"
        ref={rootRef}
        className="space-y-4"
      >
        <h1 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">管理</h1>
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          自動入力などをまとめて操作します。
        </div>

        <div className="mt-4 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/40">
          <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">日常/通常</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => router.replace('/management?kind=normal')}
              className={`rounded-md border px-3 py-2 text-xs ${
                scheduleKind === 'normal'
                  ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-black'
                  : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
              }`}
            >
              通常
            </button>
            <button
              type="button"
              onClick={() => router.replace('/management?kind=daily')}
              className={`rounded-md border px-3 py-2 text-xs ${
                scheduleKind === 'daily'
                  ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-black'
                  : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
              }`}
            >
              日常
            </button>

            <button
              type="button"
              onClick={() => router.push('/?mode=week&kind=daily')}
              className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
              title="日常予定（全体）を開く"
            >
              日常予定
            </button>

            <button
              type="button"
              ref={dailySiteCreateButtonRef}
              onClick={() => {
                setDailySiteCreateMsg(null);
                if (scheduleKind !== 'daily') {
                  router.replace('/management?kind=daily');
                }
                setDailySiteCreateOpen((v) => !v);
              }}
              className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
              title="日常（DAILY）の現場を新規登録"
            >
              日常現場登録
            </button>
          </div>

          {scheduleKind === 'daily' ? (
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => router.push('/alerts')}
                className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                title="アラート（一覧）"
              >
                アラート
              </button>
              <button
                type="button"
                ref={dailyWorkButtonRef}
                onClick={() => {
                  const next = !dailyWorkExplorerOpen;
                  setDailyWorkExplorerOpen(next);
                  if (next) void loadDailyWorkSummary();
                }}
                className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                title="勤務集計（エクスプローラー表示）"
              >
                勤務集計
              </button>
              <button
                type="button"
                ref={dailyCsvButtonRef}
                onClick={() => setDailyCsvOpen((v) => !v)}
                className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                title="CSV出力（項目選択）"
              >
                CSV出力
              </button>
            </div>
          ) : null}

          {scheduleKind === 'daily' && dailyWorkExplorerOpen ? (
            <div
              ref={dailyWorkPanelRef}
              data-color-edit-slot="border"
              className="mt-3 rounded-md border border-zinc-200 bg-white/60 px-3 py-3 dark:border-zinc-800 dark:bg-black/60"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">勤務集計（エクスプローラー）</div>
                  <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">日常（打刻）から自動集計します。</div>
                </div>
                <button
                  type="button"
                  onClick={() => void loadDailyWorkSummary()}
                  disabled={dailyWorkBusy}
                  className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                >
                  更新
                </button>
              </div>

              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">期間（開始）</div>
                  <input
                    type="date"
                    value={dailyToolsFrom}
                    onChange={(e) => setDailyToolsFrom(e.target.value)}
                    className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs tabular-nums dark:border-zinc-800 dark:bg-black"
                  />
                </div>
                <div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">期間（終了）</div>
                  <input
                    type="date"
                    value={dailyToolsTo}
                    onChange={(e) => setDailyToolsTo(e.target.value)}
                    className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs tabular-nums dark:border-zinc-800 dark:bg-black"
                  />
                </div>
              </div>

              <div className="mt-2">
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">現場（絞り込み）</div>
                <select
                  value={dailyToolsSiteId}
                  onChange={(e) => setDailyToolsSiteId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                >
                  <option value="">（全て）</option>
                  <option value="__none__">（未設定）</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.companyName ? `${s.companyName} / ${s.name}` : s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-3">
                {dailyWorkBusy ? (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">読み込み中…</div>
                ) : dailyWorkItems.length === 0 ? (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">{dailyWorkMsg ?? '該当データがありません。'}</div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {dailyWorkItems.map((it) => {
                      const label = (it.name ?? it.email ?? it.userId).trim();
                      return (
                        <div
                          key={it.userId}
                          data-color-edit-slot="border"
                          className="group flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white/60 px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black/60"
                        >
                          <div className="min-w-0 flex-1 truncate">{label}</div>
                          <div className="shrink-0 tabular-nums text-zinc-600 dark:text-zinc-300">
                            {it.workDays}日 / {it.workHoursText}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {dailyWorkMsg && dailyWorkItems.length > 0 ? (
                <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{dailyWorkMsg}</div>
              ) : null}
            </div>
          ) : null}

          {scheduleKind === 'daily' && dailyCsvOpen ? (
            <div
              ref={dailyCsvPanelRef}
              data-color-edit-slot="border"
              className="mt-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-black"
            >
              <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">CSV出力（項目選択）</div>
              <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">期間・項目・従業員を選択して出力します。</div>

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">期間（開始）</div>
                  <input
                    type="date"
                    value={dailyToolsFrom}
                    onChange={(e) => setDailyToolsFrom(e.target.value)}
                    className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs tabular-nums dark:border-zinc-800 dark:bg-black"
                  />
                </div>
                <div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">期間（終了）</div>
                  <input
                    type="date"
                    value={dailyToolsTo}
                    onChange={(e) => setDailyToolsTo(e.target.value)}
                    className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs tabular-nums dark:border-zinc-800 dark:bg-black"
                  />
                </div>
              </div>

              <div className="mt-2">
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">現場（絞り込み）</div>
                <select
                  value={dailyToolsSiteId}
                  onChange={(e) => setDailyToolsSiteId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                >
                  <option value="">（全て）</option>
                  <option value="__none__">（未設定）</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.companyName ? `${s.companyName} / ${s.name}` : s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-3">
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">出力項目</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {([
                    { key: 'date', label: '日付' },
                    { key: 'site', label: '現場' },
                    { key: 'user', label: '従業員名' },
                    { key: 'start', label: '開始' },
                    { key: 'end', label: '終了' },
                  ] as const).map((c) => (
                    <label
                      key={c.key}
                      data-color-edit-slot="border"
                      className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white/60 px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black/60"
                    >
                      <input
                        type="checkbox"
                        checked={dailyCsvCols.includes(c.key)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setDailyCsvCols((cur) => {
                            const has = cur.includes(c.key);
                            if (checked && !has) return [...cur, c.key];
                            if (!checked && has) return cur.filter((x) => x !== c.key);
                            return cur;
                          });
                        }}
                      />
                      <span>{c.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="mt-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">従業員（チェック選択）</div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                      onClick={() => setDailyCsvUserIds(users.map((u) => u.id))}
                    >
                      全選択
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                      onClick={() => setDailyCsvUserIds([])}
                    >
                      全解除
                    </button>
                  </div>
                </div>
                <div
                  data-color-edit-slot="border"
                  className="mt-2 max-h-40 overflow-auto rounded-md border border-zinc-200 bg-white/60 p-2 dark:border-zinc-800 dark:bg-black/60"
                >
                  {users.length === 0 ? (
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">従業員がありません。</div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {users.map((u) => {
                        const label = (u.name ?? u.email ?? u.id).trim();
                        const checked = dailyCsvUserIds.includes(u.id);
                        return (
                          <label
                            key={u.id}
                            data-color-edit-slot="border"
                            className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-xs dark:border-zinc-800 dark:bg-black/60"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const on = e.target.checked;
                                setDailyCsvUserIds((cur) => {
                                  const has = cur.includes(u.id);
                                  if (on && !has) return [...cur, u.id];
                                  if (!on && has) return cur.filter((x) => x !== u.id);
                                  return cur;
                                });
                              }}
                            />
                            <span className="min-w-0 flex-1 truncate">{label}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3">
                <button
                  type="button"
                  disabled={dailyCsvBusy || dailyCsvUserIds.length === 0 || dailyCsvCols.length === 0}
                  onClick={() => void downloadDailyCsv()}
                  className="w-full rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                >
                  {dailyCsvBusy ? 'CSV作成中…' : 'CSV出力'}
                </button>
                {dailyCsvMsg ? (
                  <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400" role="status" aria-live="polite">
                    {dailyCsvMsg}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {scheduleKind === 'daily' && dailySiteCreateOpen ? (
            <div
              ref={dailySiteCreatePanelRef}
              data-color-edit-slot="border"
              className="mt-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-black"
            >
              <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">日常現場（追加）</div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  value={dailySiteName}
                  onChange={(e) => setDailySiteName(e.target.value)}
                  placeholder="現場名"
                  className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    if (isDailySiteCreating) return;
                    const name = dailySiteName.trim();
                    if (!name) {
                      setDailySiteCreateMsg('現場名を入力してください');
                      return;
                    }
                    void (async () => {
                      setIsDailySiteCreating(true);
                      setDailySiteCreateMsg(null);
                      try {
                        const r = await fetch('/api/sites', {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ name, kind: 'DAILY' }),
                        });
                        const j = (await r.json().catch(() => null)) as unknown;
                        const o = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
                        if (!r.ok || o?.ok !== true) {
                          const msg = typeof o?.error === 'string' ? (o.error as string) : `HTTP ${r.status}`;
                          setDailySiteCreateMsg(msg);
                          return;
                        }
                        setDailySiteName('');
                        setDailySiteCreateMsg('登録しました');
                        await loadSites();
                      } catch (err) {
                        setDailySiteCreateMsg(err instanceof Error ? err.message : '登録に失敗しました');
                      } finally {
                        setIsDailySiteCreating(false);
                      }
                    })();
                  }}
                />
                <button
                  type="button"
                  disabled={isDailySiteCreating}
                  onClick={() => {
                    const name = dailySiteName.trim();
                    if (!name) {
                      setDailySiteCreateMsg('現場名を入力してください');
                      return;
                    }
                    void (async () => {
                      setIsDailySiteCreating(true);
                      setDailySiteCreateMsg(null);
                      try {
                        const r = await fetch('/api/sites', {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ name, kind: 'DAILY' }),
                        });
                        const j = (await r.json().catch(() => null)) as unknown;
                        const o = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
                        if (!r.ok || o?.ok !== true) {
                          const msg = typeof o?.error === 'string' ? (o.error as string) : `HTTP ${r.status}`;
                          setDailySiteCreateMsg(msg);
                          return;
                        }
                        setDailySiteName('');
                        setDailySiteCreateMsg('登録しました');
                        await loadSites();
                      } catch (err) {
                        setDailySiteCreateMsg(err instanceof Error ? err.message : '登録に失敗しました');
                      } finally {
                        setIsDailySiteCreating(false);
                      }
                    })();
                  }}
                  className="w-full rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black sm:w-auto"
                >
                  {isDailySiteCreating ? '登録中…' : '登録'}
                </button>
              </div>
              {dailySiteCreateMsg ? (
                <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400" role="status" aria-live="polite">
                  {dailySiteCreateMsg}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            ※ このページの現場/従業員リストも、通常/日常で切り替わります。
          </div>

          <div
            data-color-edit-slot="border"
            className="mt-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-black"
          >
            <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">編集権限付与</div>
            <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              アカウントを選択して、週予定の編集権限/付与権限を切り替えます。
            </div>

            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
              <div className="w-full rounded-md border border-zinc-200 bg-white p-2 text-xs dark:border-zinc-800 dark:bg-black sm:max-w-[420px]">
                <div className="max-h-40 overflow-y-auto">
                  <div className="flex flex-col gap-1">
                    {users.map((u) => {
                      const active = u.id === permTargetUserId;
                      const hasPerm = u.canEditSchedule === true || u.canGrantScheduleEdit === true;
                      const label = `${u.name ?? '（無名）'}${u.email ? ` <${u.email}>` : ''}`;
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => setPermTargetUserId(u.id)}
                          className={`w-full rounded-md border px-2 py-2 text-left text-xs ${
                            active
                              ? 'border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950'
                              : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-2 w-2 shrink-0 rounded-full ${
                                hasPerm ? 'bg-red-500 dark:bg-red-400' : 'bg-transparent'
                              }`}
                              aria-hidden
                            />
                            <div className="min-w-0 flex-1 truncate">{label}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <button
                type="button"
                disabled={isPermSaving || !permTarget}
                onClick={() => {
                  if (!permTarget) return;
                  void setUserPerms(permTarget.id, { canEditSchedule: !(permTarget.canEditSchedule === true) });
                }}
                className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
              >
                {permTarget?.canEditSchedule === true ? '編集権限 解除' : '編集権限 付与'}
              </button>

              <button
                type="button"
                disabled={isPermSaving || !permTarget}
                onClick={() => {
                  if (!permTarget) return;
                  void setUserPerms(permTarget.id, {
                    canGrantScheduleEdit: !(permTarget.canGrantScheduleEdit === true),
                  });
                }}
                className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
              >
                {permTarget?.canGrantScheduleEdit === true ? '付与権限 解除' : '付与権限 付与'}
              </button>
            </div>

            {permMsg ? <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{permMsg}</div> : null}
          </div>
        </div>

        {statusMsg ? <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{statusMsg}</div> : null}

        <div className="mt-5 grid grid-cols-1 gap-2">
          <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">現場</div>
          <select
            value={selectedSiteId}
            onChange={(e) => setSelectedSiteId(e.target.value)}
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
          >
            {sites.length === 0 ? <option value="">（現場なし）</option> : null}
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {(s.companyName ? `${s.companyName} / ` : '') + s.name}
              </option>
            ))}
          </select>
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => void loadSites()}
              className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
            >
              再読込
            </button>
          </div>
        </div>

        <div className="mt-6 border-t border-zinc-200 pt-5 dark:border-zinc-800">
          <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">自動入力</div>

          <div className="mt-3 space-y-3">
            <div>
              <div className="text-xs text-zinc-600 dark:text-zinc-400">対象月</div>
              <input
                type="month"
                value={autoFillMonth}
                onChange={(e) => setAutoFillMonth(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
              />
            </div>

            <div>
              <div className="text-xs text-zinc-600 dark:text-zinc-400">従業員</div>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
              >
                {users.length === 0 ? <option value="">（取得できません）</option> : null}
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name ?? u.email ?? u.id}
                  </option>
                ))}
              </select>
              <div className="mt-1 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => void loadUsers()}
                  className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                >
                  再読込
                </button>
              </div>
            </div>

            <button
              type="button"
              disabled={!selectedSiteId || !selectedUserId || isAutoFilling}
              onClick={() => {
                if (!selectedSiteId || !selectedUserId) return;
                void (async () => {
                  setIsAutoFilling(true);
                  setAutoFillResult(null);
                  try {
                    const r = await fetch('/api/schedule/auto-fill', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ userId: selectedUserId, siteId: selectedSiteId, month: autoFillMonth }),
                    });
                    const json = (await r.json().catch(() => null)) as
                      | { ok: true; created: number; skipped: number; reason?: string }
                      | { ok: false; error?: string }
                      | null;
                    if (json && json.ok) setAutoFillResult(json);
                    else {
                      setAutoFillResult({
                        ok: false,
                        error: json?.error || (!r.ok ? `HTTP ${r.status}` : 'Unknown error'),
                      });
                    }
                  } catch (e) {
                    setAutoFillResult({ ok: false, error: e instanceof Error ? e.message : 'Failed' });
                  } finally {
                    setIsAutoFilling(false);
                  }
                })();
              }}
              className="w-full rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
            >
              {isAutoFilling ? '自動入力中…' : '自動入力'}
            </button>

            <button
              type="button"
              disabled={!selectedSiteId || !selectedUserId || isAutoFilling}
              onClick={() => {
                if (!selectedSiteId || !selectedUserId) return;
                void (async () => {
                  setIsAutoFilling(true);
                  setAutoFillResult(null);
                  try {
                    const r = await fetch('/api/schedule/auto-fill', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({
                        userId: selectedUserId,
                        siteId: selectedSiteId,
                        month: autoFillMonth,
                        days: weekDays,
                      }),
                    });
                    const json = (await r.json().catch(() => null)) as
                      | { ok: true; created: number; skipped: number; reason?: string }
                      | { ok: false; error?: string }
                      | null;
                    if (json && json.ok) setAutoFillResult(json);
                    else {
                      setAutoFillResult({
                        ok: false,
                        error: json?.error || (!r.ok ? `HTTP ${r.status}` : 'Unknown error'),
                      });
                    }
                  } catch (e) {
                    setAutoFillResult({ ok: false, error: e instanceof Error ? e.message : 'Failed' });
                  } finally {
                    setIsAutoFilling(false);
                  }
                })();
              }}
              className="w-full rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
            >
              {isAutoFilling ? '自動入力中…' : '自動入力（今週）'}
            </button>

            <button
              type="button"
              disabled={!selectedSiteId || isAutoFilling || users.length === 0}
              onClick={() => {
                if (!selectedSiteId) return;
                if (users.length === 0) return;
                void (async () => {
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
                        body: JSON.stringify({ userId: u.id, siteId: selectedSiteId, month: autoFillMonth }),
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
                  } catch (e) {
                    setAutoFillResult({ ok: false, error: e instanceof Error ? e.message : 'Failed' });
                  } finally {
                    setIsAutoFilling(false);
                  }
                })();
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
                {autoFillResult.ok
                  ? `結果: created=${autoFillResult.created}, skipped=${autoFillResult.skipped}${autoFillResult.reason ? `, reason=${autoFillResult.reason}` : ''}`
                  : `失敗: ${autoFillResult.error}`}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
