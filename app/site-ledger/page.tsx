'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useHeaderActions } from '../header-actions';

function scheduleLabelDotClass(color: string | null | undefined): string {
  const c = (color ?? 'default').toString();
  if (c === 'default') return 'bg-zinc-300 dark:bg-zinc-700';
  if (c === 'red') return 'bg-red-500 dark:bg-red-400';
  if (c === 'orange') return 'bg-orange-500 dark:bg-orange-400';
  if (c === 'yellow') return 'bg-yellow-400 dark:bg-yellow-300';
  if (c === 'green') return 'bg-green-500 dark:bg-green-400';
  if (c === 'blue') return 'bg-blue-500 dark:bg-blue-400';
  if (c === 'purple') return 'bg-purple-500 dark:bg-purple-400';
  if (c === 'pink') return 'bg-pink-500 dark:bg-pink-400';
  return 'bg-zinc-300 dark:bg-zinc-700';
}

type ApiSite = {
  id: string;
  companyName: string | null;
  name: string;
  scheduleLabelColor: string;
  depreciationThreshold: number;
  alertsEnabled: boolean;
  caution: string | null;
  invoiceIssuedThisMonth: boolean | undefined;
  reportIssuedThisMonth: boolean | undefined;
  paceExpectedThisMonth: number | undefined;
  paceActualThisMonth: number | undefined;
  paceNotConsumedAlert: boolean | undefined;
  unassignedThisMonth: boolean | undefined;
  createdAt: string;
  updatedAt: string;
  repeatRule: unknown;
};

type DeprItem = { siteId: string; count: number; threshold: number; alert: boolean };

export default function SiteLedgerPage() {
  const { setAddAction, setUndoAction, setRedoAction } = useHeaderActions();
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sites, setSites] = useState<ApiSite[]>([]);
  const [q, setQ] = useState('');

  const [isImporting, setIsImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const [deprMonth, setDeprMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [deprMap, setDeprMap] = useState<Record<string, DeprItem>>({});
  const [deprStatus, setDeprStatus] = useState<string | null>(null);

  const [newCompanyName, setNewCompanyName] = useState('');
  const [newName, setNewName] = useState('');
  const [newThreshold, setNewThreshold] = useState('10');

  const loadSites = useCallback(async () => {
    setStatusMsg(null);
    setIsLoading(true);
    try {
      const r = await fetch(`/api/sites?month=${encodeURIComponent(deprMonth)}`);
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) {
        throw new Error((obj?.error as string) || `HTTP ${r.status}`);
      }

      const raw = Array.isArray(obj.sites) ? (obj.sites as unknown[]) : [];
      const parsed = raw
        .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null))
        .map((o): ApiSite | null => {
          const id = typeof o?.id === 'string' ? o.id : null;
          const name = typeof o?.name === 'string' ? o.name : null;
          const companyName = typeof o?.companyName === 'string' ? o.companyName : o?.companyName === null ? null : null;
          const scheduleLabelColor = typeof o?.scheduleLabelColor === 'string' ? o.scheduleLabelColor : 'default';
          const depreciationThreshold = typeof o?.depreciationThreshold === 'number' ? o.depreciationThreshold : 10;
          const alertsEnabled = typeof o?.alertsEnabled === 'boolean' ? o.alertsEnabled : true;
          const caution = typeof o?.caution === 'string' ? o.caution : o?.caution === null ? null : null;
          const createdAt = typeof o?.createdAt === 'string' ? o.createdAt : new Date().toISOString();
          const updatedAt = typeof o?.updatedAt === 'string' ? o.updatedAt : createdAt;
          const repeatRule = o?.repeatRule;

          const invoiceIssuedThisMonth = typeof o?.invoiceIssuedThisMonth === 'boolean' ? o.invoiceIssuedThisMonth : undefined;
          const reportIssuedThisMonth = typeof o?.reportIssuedThisMonth === 'boolean' ? o.reportIssuedThisMonth : undefined;
          const paceExpectedThisMonth = typeof o?.paceExpectedThisMonth === 'number' ? o.paceExpectedThisMonth : undefined;
          const paceActualThisMonth = typeof o?.paceActualThisMonth === 'number' ? o.paceActualThisMonth : undefined;
          const paceNotConsumedAlert = typeof o?.paceNotConsumedAlert === 'boolean' ? o.paceNotConsumedAlert : undefined;
          const unassignedThisMonth = typeof o?.unassignedThisMonth === 'boolean' ? o.unassignedThisMonth : undefined;
          if (!id || !name) return null;
          return {
            id,
            companyName,
            name,
            scheduleLabelColor,
            depreciationThreshold,
            alertsEnabled,
            caution,
            invoiceIssuedThisMonth,
            reportIssuedThisMonth,
            paceExpectedThisMonth,
            paceActualThisMonth,
            paceNotConsumedAlert,
            unassignedThisMonth,
            createdAt,
            updatedAt,
            repeatRule,
          };
        })
        .filter((x): x is ApiSite => !!x);

      setSites(parsed);
    } catch (e) {
      setSites([]);
      setStatusMsg(e instanceof Error ? `読み込みに失敗: ${e.message}` : '読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [deprMonth]);

  const loadDeprCounts = useCallback(async () => {
    setDeprStatus(null);
    try {
      const r = await fetch(`/api/sites/depreciation-counts?month=${encodeURIComponent(deprMonth)}`);
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) {
        throw new Error((obj?.error as string) || `HTTP ${r.status}`);
      }

      const items = Array.isArray(obj.items) ? (obj.items as unknown[]) : [];
      const next: Record<string, DeprItem> = {};
      for (const it of items) {
        const o = it && typeof it === 'object' ? (it as Record<string, unknown>) : null;
        const siteId = typeof o?.siteId === 'string' ? o.siteId : null;
        if (!siteId) continue;
        const count = typeof o?.count === 'number' ? o.count : 0;
        const threshold = typeof o?.threshold === 'number' ? o.threshold : 10;
        const alert = typeof o?.alert === 'boolean' ? o.alert : false;
        next[siteId] = { siteId, count, threshold, alert };
      }
      setDeprMap(next);
    } catch (e) {
      setDeprMap({});
      setDeprStatus(e instanceof Error ? `取得に失敗: ${e.message}` : '取得に失敗しました');
    }
  }, [deprMonth]);

  useEffect(() => {
    void loadSites();
  }, [loadSites]);

  useEffect(() => {
    void loadDeprCounts();
  }, [loadDeprCounts]);

  const visibleSites = useMemo(() => {
    const v = q.trim().toLowerCase();
    return !v
      ? sites
      : sites.filter((s) => {
          const a = `${s.companyName ?? ''} ${s.name}`.toLowerCase();
          return a.includes(v);
        });
  }, [q, sites]);

  const addSite = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    const companyName = newCompanyName.trim() || null;
    const threshold = Number(newThreshold);
    setStatusMsg(null);
    try {
      const r = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          companyName,
          depreciationThreshold: Number.isFinite(threshold) ? threshold : undefined,
        }),
      });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) throw new Error((obj?.error as string) || `HTTP ${r.status}`);
      setNewName('');
      setNewCompanyName('');
      setNewThreshold('10');
      await loadSites();
    } catch (e) {
      setStatusMsg(e instanceof Error ? `追加に失敗: ${e.message}` : '追加に失敗しました');
    }
  }, [loadSites, newCompanyName, newName, newThreshold]);

  const importSchedule = useCallback(
    async (file: File | null) => {
      if (!file) return;
      setImportMsg(null);
      setIsImporting(true);
      try {
        const fd = new FormData();
        fd.set('file', file);
        const r = await fetch('/api/sites/import-schedule', { method: 'POST', body: fd });
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        if (!r.ok || obj?.ok !== true) throw new Error((obj?.error as string) || `HTTP ${r.status}`);
        const created = typeof obj?.created === 'number' ? (obj.created as number) : 0;
        const total = typeof obj?.total === 'number' ? (obj.total as number) : 0;
        setImportMsg(`予定取り込み: ${created}件追加 / ${total}件抽出`);
        await loadSites();
      } catch (e) {
        setImportMsg(e instanceof Error ? `予定取り込みに失敗: ${e.message}` : '予定取り込みに失敗しました');
      } finally {
        setIsImporting(false);
      }
    },
    [loadSites],
  );

  useEffect(() => {
    setAddAction({ onClick: addSite, disabled: !newName.trim(), title: '追加（現場）' });
    return () => {
      setAddAction(undefined);
    };
  }, [addSite, newName, setAddAction]);

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
        id="site-ledger"
        ref={rootRef}
        className="space-y-4"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">現場台帳</div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">現場名で検索して詳細へ移動できます。</div>
            {importMsg ? <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{importMsg}</div> : null}
          </div>

          <div className="flex w-full max-w-sm flex-col gap-2">
            <div className="flex items-center justify-end gap-2">
              <input
                ref={importInputRef}
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="hidden"
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0] ?? null;
                  void importSchedule(f);
                  e.currentTarget.value = '';
                }}
              />
              <button
                type="button"
                disabled={isImporting}
                onClick={() => importInputRef.current?.click()}
                className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                title="予定表（Excel）から現場名を取り込み"
              >
                予定取り込み
              </button>
            </div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">現場名検索</div>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="例: ○○マンション"
              className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
            />
          </div>
        </div>
        <h1 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">現場台帳</h1>
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          一覧/追加/編集/削除（devではトークン無しでもOK）。
        </div>

        {statusMsg ? <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{statusMsg}</div> : null}

        <div className="mt-5 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">償却カウント詳細</div>
              <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                指定月の件数と閾値を確認できます。
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadDeprCounts()}
              className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
            >
              再取得
            </button>
          </div>

          <div className="mt-2">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">月</div>
            <input
              type="month"
              value={deprMonth}
              onChange={(e) => setDeprMonth(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
            />
          </div>

          {deprStatus ? <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{deprStatus}</div> : null}

          <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            「現場一覧（コンパクト）」で件数バッジ表示します。
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2">
          <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">追加</div>
          <input
            value={newCompanyName}
            onChange={(e) => setNewCompanyName(e.target.value)}
            placeholder="会社名（任意）"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="現場名"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
          />
          <input
            value={newThreshold}
            onChange={(e) => setNewThreshold(e.target.value)}
            placeholder="償却閾値（例: 10）"
            inputMode="numeric"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
          />
          <button
            type="button"
            disabled={!newName.trim()}
            onClick={() => {
              const name = newName.trim();
              const companyName = newCompanyName.trim() || null;
              const threshold = Number(newThreshold);
              void (async () => {
                setStatusMsg(null);
                try {
                  const r = await fetch('/api/sites', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      name,
                      companyName,
                      depreciationThreshold: Number.isFinite(threshold) ? threshold : undefined,
                    }),
                  });
                  const j = (await r.json().catch(() => null)) as unknown;
                  const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
                  if (!r.ok || obj?.ok !== true) {
                    throw new Error((obj?.error as string) || `HTTP ${r.status}`);
                  }
                  setNewName('');
                  setNewCompanyName('');
                  setNewThreshold('10');
                  await loadSites();
                } catch (e) {
                  setStatusMsg(e instanceof Error ? `追加に失敗: ${e.message}` : '追加に失敗しました');
                }
              })();
            }}
            className="mt-1 w-full rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
          >
            追加
          </button>
        </div>

        <div className="mt-6 flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">一覧</div>
          <button
            type="button"
            onClick={() => void loadSites()}
            className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
          >
            再読込
          </button>
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="検索（会社名/現場名）"
          className="mt-2 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
        />

        <div
          data-color-edit-slot="border"
          className="mt-3 rounded-lg border border-zinc-200 bg-white/60 p-3 dark:border-zinc-800 dark:bg-black/60"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">現場一覧（コンパクト）</div>
              <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">全体を俯瞰して名前を確認できます。</div>
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{visibleSites.length}件</div>
          </div>

          {visibleSites.length === 0 ? (
            <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">（データがありません）</div>
          ) : (
            <div className="mt-2 max-h-64 overflow-auto">
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-8">
                {visibleSites.map((s) => (
                  <button
                    key={`grid-${s.id}`}
                    type="button"
                    onClick={() =>
                      router.push(`/site-ledger/${encodeURIComponent(s.id)}?month=${encodeURIComponent(deprMonth)}`)
                    }
                    className="relative rounded border border-zinc-200 bg-white/60 px-2 py-2 pr-10 text-[10px] text-zinc-700 dark:border-zinc-800 dark:bg-black/40 dark:text-zinc-300"
                    title={`${(s.companyName ? `${s.companyName} / ` : '') + s.name}${
                      deprMap[s.id]
                        ? `\n償却カウント(${deprMonth}): ${deprMap[s.id].count}件 / 閾値 ${deprMap[s.id].threshold}`
                        : ''
                    }`}
                  >
                    <div className="absolute left-1 top-1">
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${scheduleLabelDotClass(s.scheduleLabelColor)}`}
                        aria-hidden
                      />
                    </div>
                    <div className="absolute right-1 top-1 flex items-center gap-1">
                      {s.alertsEnabled && s.invoiceIssuedThisMonth === false ? (
                        <span
                          className="mh-alert-dot mh-alert-dot-invoice mh-alert-dot-active"
                          title="請求書未発行（当月）"
                        />
                      ) : null}
                      {s.alertsEnabled && s.reportIssuedThisMonth === false ? (
                        <span
                          className="mh-alert-dot mh-alert-dot-report mh-alert-dot-active"
                          title="報告書未発行（当月）"
                        />
                      ) : null}
                      {s.alertsEnabled && s.unassignedThisMonth ? (
                        <span
                          className="mh-alert-dot mh-alert-dot-unassigned mh-alert-dot-active"
                          title="当月 現場未配置"
                        />
                      ) : null}
                    </div>

                    <div className="flex items-center justify-between gap-1">
                      <div className="min-w-0 flex-1 truncate">{s.name}</div>
                      <div className="flex shrink-0 items-center gap-1">
                        {s.caution?.trim() ? (
                          <span className="rounded-md border border-red-200 px-1 py-0.5 text-[9px] text-red-700 dark:border-red-900 dark:text-red-300">
                            注意
                          </span>
                        ) : null}

                        {s.alertsEnabled && s.paceNotConsumedAlert ? (
                          <span className="rounded-md border border-red-200 px-1 py-0.5 text-[9px] text-red-700 dark:border-red-900 dark:text-red-300">
                            ペース未
                          </span>
                        ) : null}

                        {deprMap[s.id] ? (
                          <span
                            className={`rounded-md border px-1 py-0.5 text-[9px] tabular-nums ${
                              deprMap[s.id].alert
                                ? 'border-red-200 text-red-700 dark:border-red-900 dark:text-red-300'
                                : 'border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300'
                            }`}
                          >
                            {deprMap[s.id].count}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {isLoading ? <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">読み込み中…</div> : null}
        <div className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
          現場の詳細/編集は「現場一覧（コンパクト）」から開いてください。
        </div>
      </div>
    </main>
  );
}
