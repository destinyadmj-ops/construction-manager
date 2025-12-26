'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHeaderActions } from '../header-actions';

type ApiUser = { id: string; name: string | null; email: string | null };
type ApiSite = {
  id: string;
  companyName: string | null;
  name: string;
  repeatRule: unknown;
  createdAt: string;
};

type RepeatRule = {
  intervalMonths: number;
  weekdays: number[];
  monthDays: number[];
};

const DOW = ['月', '火', '水', '木', '金', '土', '日'] as const;

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

function parseRepeatRule(x: unknown): RepeatRule {
  const base: RepeatRule = { intervalMonths: 1, weekdays: [], monthDays: [] };
  if (!x || typeof x !== 'object') return base;
  const o = x as Record<string, unknown>;
  const intervalMonths = typeof o.intervalMonths === 'number' ? o.intervalMonths : 1;
  const weekdays = Array.isArray(o.weekdays) ? o.weekdays.filter((n) => typeof n === 'number') : [];
  const monthDays = Array.isArray(o.monthDays) ? o.monthDays.filter((n) => typeof n === 'number') : [];
  return {
    intervalMonths: Math.min(12, Math.max(1, intervalMonths || 1)),
    weekdays: weekdays.map((n) => Math.min(7, Math.max(1, n))).sort((a, b) => a - b),
    monthDays: monthDays.map((n) => Math.min(31, Math.max(1, n))).sort((a, b) => a - b),
  };
}

export default function ManagementPage() {
  const { setAddAction, setSaveAction, setUndoAction, setRedoAction } = useHeaderActions();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [sites, setSites] = useState<ApiSite[]>([]);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [repeatRule, setRepeatRule] = useState<RepeatRule>({ intervalMonths: 1, weekdays: [], monthDays: [] });
  const [isSavingRule, setIsSavingRule] = useState(false);

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

  const weekDays = useMemo(() => {
    const ws = startOfWeekMonday(new Date());
    return Array.from({ length: 7 }, (_, i) => toYmd(new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + i)));
  }, []);

  const selectedSite = useMemo(() => sites.find((s) => s.id === selectedSiteId) ?? null, [sites, selectedSiteId]);

  const loadSites = useCallback(async () => {
    setStatusMsg(null);
    try {
      const r = await fetch('/api/sites');
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
          const repeatRule = o?.repeatRule;
          if (!id || !name) return null;
          return { id, name, companyName, createdAt, repeatRule };
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
  }, [selectedSiteId]);

  const loadUsers = useCallback(async () => {
    try {
      const weekStart = toYmd(startOfWeekMonday(new Date()));
      const r = await fetch(`/api/schedule/week?weekStart=${encodeURIComponent(weekStart)}`);
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
          return { id, name, email };
        })
        .filter((x): x is ApiUser => !!x);
      setUsers(parsed);
      if (!selectedUserId && parsed.length > 0) setSelectedUserId(parsed[0].id);
    } catch {
      setUsers([]);
    }
  }, [selectedUserId]);

  useEffect(() => {
    void loadSites();
    void loadUsers();
  }, [loadSites, loadUsers]);

  useEffect(() => {
    if (!selectedSite) return;
    setRepeatRule(parseRepeatRule(selectedSite.repeatRule));
  }, [selectedSite]);

  const saveRepeatRule = useCallback(async () => {
    if (!selectedSiteId) return;
    setIsSavingRule(true);
    setStatusMsg(null);
    try {
      const r = await fetch('/api/sites/repeat-rule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteId: selectedSiteId, repeatRule }),
      });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) throw new Error((obj?.error as string) || `HTTP ${r.status}`);
      await loadSites();
    } catch (e) {
      setStatusMsg(e instanceof Error ? `保存に失敗: ${e.message}` : '保存に失敗しました');
    } finally {
      setIsSavingRule(false);
    }
  }, [loadSites, repeatRule, selectedSiteId]);

  useEffect(() => {
    setAddAction(undefined);
    setSaveAction({
      onClick: saveRepeatRule,
      disabled: !selectedSiteId || isSavingRule,
      title: '作業や入力（リピート設定）',
    });
    return () => {
      setAddAction(undefined);
      setSaveAction(undefined);
    };
  }, [isSavingRule, saveRepeatRule, selectedSiteId, setAddAction, setSaveAction]);

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
        className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-black"
      >
        <h1 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">管理</h1>
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          ペース（リピート）と自動入力をまとめて操作します。
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
          <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">ペース（リピート）</div>
          <div className="mt-2 space-y-3">
            <div>
              <div className="text-xs text-zinc-600 dark:text-zinc-400">月スパン（1〜12ヶ月）</div>
              <select
                value={repeatRule.intervalMonths}
                onChange={(e) => setRepeatRule((r) => ({ ...r, intervalMonths: Number(e.target.value) || 1 }))}
                disabled={!selectedSiteId}
                className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs disabled:opacity-60 dark:border-zinc-800 dark:bg-black"
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
                      disabled={!selectedSiteId}
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
                      disabled={!selectedSiteId}
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
              disabled={!selectedSiteId || isSavingRule}
              onClick={() => void saveRepeatRule()}
              className="w-full rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
            >
              {isSavingRule ? '保存中…' : 'リピートを保存'}
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
