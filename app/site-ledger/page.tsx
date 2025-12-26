'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHeaderActions } from '../header-actions';

type ApiSite = {
  id: string;
  companyName: string | null;
  name: string;
  depreciationThreshold: number;
  createdAt: string;
  updatedAt: string;
  repeatRule: unknown;
};

type DeprItem = { siteId: string; count: number; threshold: number; alert: boolean };

export default function SiteLedgerPage() {
  const { setAddAction, setSaveAction, setUndoAction, setRedoAction } = useHeaderActions();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sites, setSites] = useState<ApiSite[]>([]);
  const [q, setQ] = useState('');

  const [deprMonth, setDeprMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [deprMap, setDeprMap] = useState<Record<string, DeprItem>>({});
  const [deprStatus, setDeprStatus] = useState<string | null>(null);
  const [deprDetailSiteId, setDeprDetailSiteId] = useState<string | null>(null);
  const [deprDetail, setDeprDetail] = useState<DeprItem | null>(null);

  const [newCompanyName, setNewCompanyName] = useState('');
  const [newName, setNewName] = useState('');
  const [newThreshold, setNewThreshold] = useState('10');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCompanyName, setEditCompanyName] = useState('');
  const [editName, setEditName] = useState('');
  const [editThreshold, setEditThreshold] = useState('10');

  const loadSites = useCallback(async () => {
    setStatusMsg(null);
    setIsLoading(true);
    try {
      const r = await fetch('/api/sites');
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) {
        throw new Error((obj?.error as string) || `HTTP ${r.status}`);
      }

      const raw = Array.isArray(obj.sites) ? (obj.sites as unknown[]) : [];
      const parsed: ApiSite[] = raw
        .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null))
        .map((o) => {
          const id = typeof o?.id === 'string' ? o.id : null;
          const name = typeof o?.name === 'string' ? o.name : null;
          const companyName = typeof o?.companyName === 'string' ? o.companyName : o?.companyName === null ? null : null;
          const depreciationThreshold = typeof o?.depreciationThreshold === 'number' ? o.depreciationThreshold : 10;
          const createdAt = typeof o?.createdAt === 'string' ? o.createdAt : new Date().toISOString();
          const updatedAt = typeof o?.updatedAt === 'string' ? o.updatedAt : createdAt;
          const repeatRule = o?.repeatRule;
          if (!id || !name) return null;
          return { id, companyName, name, depreciationThreshold, createdAt, updatedAt, repeatRule };
        })
        .filter((x): x is ApiSite => !!x);

      setSites(parsed);
    } catch (e) {
      setSites([]);
      setStatusMsg(e instanceof Error ? `読み込みに失敗: ${e.message}` : '読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadDeprCounts = useCallback(async () => {
    setDeprStatus(null);
    try {
      const r = await fetch(`/api/sites/depreciation-counts?month=${encodeURIComponent(deprMonth)}`);
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) {
        throw new Error((obj?.error as string) || `HTTP ${r.status}`);
      }
      const raw = Array.isArray(obj.items) ? (obj.items as unknown[]) : [];
      const next: Record<string, DeprItem> = {};
      for (const x of raw) {
        const o = x && typeof x === 'object' ? (x as Record<string, unknown>) : null;
        const siteId = typeof o?.siteId === 'string' ? o.siteId : null;
        const count = typeof o?.count === 'number' ? o.count : null;
        const threshold = typeof o?.threshold === 'number' ? o.threshold : null;
        const alert = typeof o?.alert === 'boolean' ? o.alert : null;
        if (!siteId || count === null || threshold === null || alert === null) continue;
        next[siteId] = { siteId, count, threshold, alert };
      }
      setDeprMap(next);
    } catch (e) {
      setDeprMap({});
      setDeprStatus(e instanceof Error ? `償却カウント取得に失敗: ${e.message}` : '償却カウント取得に失敗しました');
    }
  }, [deprMonth]);

  const loadDeprDetail = useCallback(async (siteId: string) => {
    setDeprDetail(null);
    setDeprStatus(null);
    try {
      const r = await fetch(
        `/api/sites/depreciation-count?siteId=${encodeURIComponent(siteId)}&month=${encodeURIComponent(deprMonth)}`,
      );
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) {
        throw new Error((obj?.error as string) || `HTTP ${r.status}`);
      }
      const count = typeof obj?.count === 'number' ? (obj.count as number) : 0;
      const threshold = typeof obj?.threshold === 'number' ? (obj.threshold as number) : 10;
      const alert = typeof obj?.alert === 'boolean' ? (obj.alert as boolean) : false;
      setDeprDetail({ siteId, count, threshold, alert });
    } catch (e) {
      setDeprStatus(e instanceof Error ? `償却詳細の取得に失敗: ${e.message}` : '償却詳細の取得に失敗しました');
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
    const filtered = !v
      ? sites
      : sites.filter((s) => {
          const a = `${s.companyName ?? ''} ${s.name}`.toLowerCase();
          return a.includes(v);
        });

    // 検索で編集中の行が消えると操作しづらいので、常に先頭に残す
    if (!editingId) return filtered;
    const editing = sites.find((s) => s.id === editingId) ?? null;
    if (!editing) return filtered;
    if (filtered.some((s) => s.id === editingId)) return filtered;
    return [editing, ...filtered];
  }, [editingId, q, sites]);

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

  const saveEditing = useCallback(async () => {
    if (!editingId) return;
    const hit = sites.find((s) => s.id === editingId);
    if (!hit) return;
    const name = editName.trim();
    if (!name) return;
    const companyName = editCompanyName.trim() || null;
    const threshold = Number(editThreshold);
    setStatusMsg(null);
    try {
      const r = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: hit.id,
          name,
          companyName,
          depreciationThreshold: Number.isFinite(threshold) ? threshold : undefined,
        }),
      });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) throw new Error((obj?.error as string) || `HTTP ${r.status}`);
      setEditingId(null);
      await loadSites();
    } catch (e) {
      setStatusMsg(e instanceof Error ? `保存に失敗: ${e.message}` : '保存に失敗しました');
    }
  }, [editCompanyName, editName, editThreshold, editingId, loadSites, sites]);

  useEffect(() => {
    setAddAction({ onClick: addSite, disabled: !newName.trim(), title: '追加（現場）' });
    setSaveAction({
      onClick: saveEditing,
      disabled: !editingId || !editName.trim(),
      title: '作業や入力（編集中の現場）',
    });
    return () => {
      setAddAction(undefined);
      setSaveAction(undefined);
    };
  }, [addSite, editName, editingId, newName, saveEditing, setAddAction, setSaveAction]);

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
        className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-black"
      >
        <h1 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">現場台帳</h1>
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          一覧/追加/編集/削除（devではトークン無しでもOK）。
        </div>

        {statusMsg ? <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{statusMsg}</div> : null}

        <div className="mt-5 rounded-lg border border-zinc-200 bg-white/60 p-3 dark:border-zinc-800 dark:bg-black/60">
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

          {deprDetailSiteId && deprDetail ? (
            <div className="mt-3 rounded-md border border-zinc-200 bg-white p-3 text-xs dark:border-zinc-800 dark:bg-black">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1 truncate text-xs text-zinc-800 dark:text-zinc-200">
                  対象: {sites.find((s) => s.id === deprDetailSiteId)?.name ?? deprDetailSiteId}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDeprDetailSiteId(null);
                    setDeprDetail(null);
                  }}
                  className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                >
                  閉じる
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded-md border border-zinc-200 px-2 py-2 text-[11px] dark:border-zinc-800">
                  件数: <span className="tabular-nums">{deprDetail.count}</span>
                </div>
                <div
                  className={`rounded-md border px-2 py-2 text-[11px] ${
                    deprDetail.alert
                      ? 'border-red-200 text-red-700 dark:border-red-900 dark:text-red-300'
                      : 'border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300'
                  }`}
                >
                  閾値: <span className="tabular-nums">{deprDetail.threshold}</span>
                </div>
              </div>
            </div>
          ) : null}
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

        <div className="mt-3 rounded-lg border border-zinc-200 bg-white/60 p-3 dark:border-zinc-800 dark:bg-black/60">
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
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4">
                {visibleSites.map((s) => (
                  <div
                    key={`grid-${s.id}`}
                    className="rounded border border-zinc-200 bg-white/60 px-2 py-1 text-[10px] text-zinc-700 dark:border-zinc-800 dark:bg-black/40 dark:text-zinc-300"
                    title={(s.companyName ? `${s.companyName} / ` : '') + s.name}
                  >
                    <div className="truncate">{(s.companyName ? `${s.companyName} / ` : '') + s.name}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">読み込み中…</div>
        ) : visibleSites.length === 0 ? (
          <div className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">（データがありません）</div>
        ) : (
          <div className="mt-3 space-y-2">
            {visibleSites.map((s) => {
              const isEditing = editingId === s.id;
              const repeatEnabled = !!s.repeatRule;
              const badge = deprMap[s.id];
              return (
                <div
                  key={s.id}
                  className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-zinc-800 dark:text-zinc-200">
                        {(s.companyName ? `${s.companyName} / ` : '') + s.name}
                      </div>
                      <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                        閾値: {s.depreciationThreshold} / リピート: {repeatEnabled ? 'あり' : 'なし'}
                        {badge ? (
                          <span
                            className={`ml-2 rounded-md border px-1.5 py-0.5 text-[10px] tabular-nums ${
                              badge.alert
                                ? 'border-red-200 text-red-700 dark:border-red-900 dark:text-red-300'
                                : 'border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300'
                            }`}
                            title={`償却カウント(${deprMonth}): ${badge.count}件 / 閾値 ${badge.threshold}`}
                          >
                            {badge.count}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDeprDetailSiteId(s.id);
                          void loadDeprDetail(s.id);
                        }}
                        className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                      >
                        償却
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (isEditing) {
                            setEditingId(null);
                            return;
                          }
                          setEditingId(s.id);
                          setEditCompanyName(s.companyName ?? '');
                          setEditName(s.name);
                          setEditThreshold(String(s.depreciationThreshold));
                        }}
                        className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                      >
                        {isEditing ? '閉じる' : '編集'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const ok = window.confirm(`削除しますか？\n${(s.companyName ? `${s.companyName} / ` : '') + s.name}`);
                          if (!ok) return;
                          void (async () => {
                            setStatusMsg(null);
                            try {
                              const r = await fetch(`/api/sites/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
                              const j = (await r.json().catch(() => null)) as unknown;
                              const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
                              if (!r.ok || obj?.ok !== true) {
                                throw new Error((obj?.error as string) || `HTTP ${r.status}`);
                              }
                              if (editingId === s.id) setEditingId(null);
                              await loadSites();
                            } catch (e) {
                              setStatusMsg(e instanceof Error ? `削除に失敗: ${e.message}` : '削除に失敗しました');
                            }
                          })();
                        }}
                        className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                      >
                        削除
                      </button>
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="mt-3 space-y-2">
                      <input
                        value={editCompanyName}
                        onChange={(e) => setEditCompanyName(e.target.value)}
                        placeholder="会社名（任意）"
                        className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                      />
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="現場名"
                        className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                      />
                      <input
                        value={editThreshold}
                        onChange={(e) => setEditThreshold(e.target.value)}
                        placeholder="償却閾値"
                        inputMode="numeric"
                        className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                      />
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                        >
                          キャンセル
                        </button>
                        <button
                          type="button"
                          disabled={!editName.trim()}
                          onClick={() => {
                            const name = editName.trim();
                            const companyName = editCompanyName.trim() || null;
                            const threshold = Number(editThreshold);
                            void (async () => {
                              setStatusMsg(null);
                              try {
                                const r = await fetch('/api/sites', {
                                  method: 'POST',
                                  headers: { 'content-type': 'application/json' },
                                  body: JSON.stringify({
                                    id: s.id,
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
                                setEditingId(null);
                                await loadSites();
                              } catch (e) {
                                setStatusMsg(
                                  e instanceof Error ? `保存に失敗: ${e.message}` : '保存に失敗しました',
                                );
                              }
                            })();
                          }}
                          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                        >
                          保存
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
