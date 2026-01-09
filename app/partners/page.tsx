'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHeaderActions } from '../header-actions';

const LS_KEY = 'masterHub.partners.v1';

type ApiPartner = {
  id: string;
  name: string;
  email: string | null;
  fax: string | null;
  address: string | null;
  notes: string | null;
  outlookToEmailDefault: string | null;
  outlookSubjectReportDefault: string | null;
  outlookSubjectInvoiceDefault: string | null;
  updatedAt: string | undefined;
};

function loadPartners(): string[] {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    if (!Array.isArray(j)) return [];
    return j
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter((x) => x.length > 0)
      .slice(0, 100);
  } catch {
    return [];
  }
}

function savePartners(list: string[]) {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export default function PartnersPage() {
  const { setAddAction, setSaveAction, setUndoAction, setRedoAction } = useHeaderActions();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [partners, setPartners] = useState<string[]>([]);
  const [draftName, setDraftName] = useState('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [source, setSource] = useState<'server' | 'local'>('local');
  const [serverPartners, setServerPartners] = useState<ApiPartner[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftNotes, setDraftNotes] = useState<string>('');
  const [draftEmail, setDraftEmail] = useState<string>('');
  const [draftFax, setDraftFax] = useState<string>('');
  const [draftAddress, setDraftAddress] = useState<string>('');
  const [siteListOpen, setSiteListOpen] = useState<string | null>(null);
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState<string | null>(null);
  const [reportDialogOpen, setReportDialogOpen] = useState<string | null>(null);
  const [sites, setSites] = useState<Array<{ id: string; name: string; companyName: string | null }>>([]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setPartners(loadPartners());
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  const loadFromServer = useCallback(async () => {
    setStatusMsg(null);
    try {
      const r = await fetch('/api/partners');
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = (j && typeof j === 'object' ? (j as Record<string, unknown>) : null) as Record<string, unknown> | null;
      if (!r.ok || obj?.ok !== true) throw new Error((obj?.error as string) || `HTTP ${r.status}`);
      const raw = Array.isArray(obj.partners) ? (obj.partners as unknown[]) : [];
      const parsed: ApiPartner[] = raw
        .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null))
        .map((o) => {
          const id = typeof o?.id === 'string' ? o.id : null;
          const name = typeof o?.name === 'string' ? o.name : null;
          const email = typeof o?.email === 'string' ? o.email : o?.email === null ? null : null;
          const fax = typeof o?.fax === 'string' ? o.fax : o?.fax === null ? null : null;
          const address = typeof o?.address === 'string' ? o.address : o?.address === null ? null : null;
          const notes = typeof o?.notes === 'string' ? o.notes : o?.notes === null ? null : null;
          const outlookToEmailDefault =
            typeof o?.outlookToEmailDefault === 'string' ? o.outlookToEmailDefault : null;
          const outlookSubjectReportDefault =
            typeof o?.outlookSubjectReportDefault === 'string' ? o.outlookSubjectReportDefault : null;
          const outlookSubjectInvoiceDefault =
            typeof o?.outlookSubjectInvoiceDefault === 'string' ? o.outlookSubjectInvoiceDefault : null;
          const updatedAt = typeof o?.updatedAt === 'string' ? o.updatedAt : undefined;
          if (!id || !name) return null;
          return {
            id,
            name,
            email,
            fax,
            address,
            notes,
            outlookToEmailDefault,
            outlookSubjectReportDefault,
            outlookSubjectInvoiceDefault,
            updatedAt,
          };
        })
        .filter((x): x is ApiPartner => !!x);

      setServerPartners(parsed);
      setSource('server');
    } catch (e) {
      setSource('local');
      setStatusMsg(e instanceof Error ? `DB未接続のためローカル表示: ${e.message}` : 'DB未接続のためローカル表示');
    }
  }, []);

  useEffect(() => {
    void loadFromServer();
  }, [loadFromServer]);

  useEffect(() => {
    // 現場リストの読み込み
    void (async () => {
      try {
        const r = await fetch('/api/sites');
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        if (!r.ok || obj?.ok !== true) return;
        const raw = Array.isArray(obj.sites) ? obj.sites : [];
        const parsed = raw
          .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null))
          .map((o) => {
            const id = typeof o?.id === 'string' ? o.id : null;
            const name = typeof o?.name === 'string' ? o.name : null;
            const companyName = typeof o?.companyName === 'string' ? o.companyName : o?.companyName === null ? null : null;
            if (!id || !name) return null;
            return { id, name, companyName };
          })
          .filter((x): x is { id: string; name: string; companyName: string | null } => !!x);
        setSites(parsed);
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    savePartners(partners);
  }, [partners]);

  const canAdd = useMemo(() => {
    const v = draftName.trim();
    if (!v) return false;
    const existing = source === 'server' ? serverPartners.map((p) => p.name) : partners;
    return !existing.some((p) => p === v);
  }, [draftName, partners, serverPartners, source]);

  const visiblePartners = useMemo(() => {
    if (source === 'server') return serverPartners.map((p) => p.name);
    return partners;
  }, [partners, serverPartners, source]);

  const editingPartner = useMemo(() => {
    if (source !== 'server' || !editingId) return null;
    return serverPartners.find((p) => p.id === editingId) ?? null;
  }, [editingId, serverPartners, source]);

  const addPartner = useCallback(async () => {
    const v = draftName.trim();
    if (!v) return;
    if (visiblePartners.some((p) => p === v)) return;

    if (source === 'server') {
      setStatusMsg(null);
      try {
        const r = await fetch('/api/partners', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: v }),
        });
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = (j && typeof j === 'object' ? (j as Record<string, unknown>) : null) as Record<string, unknown> | null;
        if (!r.ok || obj?.ok !== true) throw new Error((obj?.error as string) || `HTTP ${r.status}`);
        await loadFromServer();
        setDraftName('');
      } catch (e) {
        setSource('local');
        setPartners((cur) => [v, ...cur]);
        setDraftName('');
        setStatusMsg(e instanceof Error ? `DB登録失敗→ローカル保存: ${e.message}` : 'DB登録失敗→ローカル保存');
      }
    } else {
      setPartners((cur) => [v, ...cur]);
      setDraftName('');
    }
  }, [draftName, loadFromServer, source, visiblePartners]);

  const saveNotes = useCallback(async () => {
    if (!editingPartner) return;
    setStatusMsg(null);
    try {
      const r = await fetch('/api/partners', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: editingPartner.id, email: draftEmail, fax: draftFax, address: draftAddress, notes: draftNotes }),
      });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) throw new Error((obj?.error as string) || `HTTP ${r.status}`);
      await loadFromServer();
      setEditingId(null);
      setDraftNotes('');
      setDraftEmail('');
      setDraftFax('');
    } catch (e) {
      setStatusMsg(e instanceof Error ? `保存に失敗: ${e.message}` : '保存に失敗しました');
    }
  }, [draftAddress, draftEmail, draftFax, draftNotes, editingPartner, loadFromServer]);

  useEffect(() => {
    setAddAction({ onClick: addPartner, disabled: !canAdd, title: '追加（会社名）' });
    setSaveAction({
      onClick: saveNotes,
      disabled: source !== 'server' || !editingPartner,
      title: '作業や入力（メモ）',
    });
    return () => {
      setAddAction(undefined);
      setSaveAction(undefined);
    };
  }, [addPartner, canAdd, editingPartner, saveNotes, setAddAction, setSaveAction, source]);

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
        ref={rootRef}
        className="space-y-4"
      >
        <h1 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">関係会社</h1>
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {source === 'server' ? 'DBの一覧を表示しています。' : 'この端末のローカル保存です（DB未接続時のフォールバック）。'}
        </div>
        {statusMsg ? <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{statusMsg}</div> : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="会社名を追加"
            className="w-full max-w-md rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
          />
          <button
            type="button"
            disabled={!canAdd}
            onClick={() => void addPartner()}
            className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
          >
            追加
          </button>
        </div>

        {visiblePartners.length === 0 ? (
          <div className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">（まだ登録がありません）</div>
        ) : (
          <div className="mt-4 space-y-2">
            {source === 'server'
              ? serverPartners.map((p) => {
                  const isEditing = editingId === p.id;
                  const toggleDetail = () => {
                    if (isEditing) {
                      setEditingId(null);
                      setDraftNotes('');
                      setDraftEmail('');
                      setDraftFax('');
                      setDraftAddress('');
                    } else {
                      setEditingId(p.id);
                      setDraftNotes(p.notes ?? '');
                      setDraftEmail(p.email ?? '');
                      setDraftFax(p.fax ?? '');
                      setDraftAddress(p.address ?? '');
                    }
                  };
                  return (
                    <div
                      key={p.id}
                      data-color-edit-slot="border"
                      className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={toggleDetail}
                          className="min-w-0 flex-1 truncate text-left text-xs text-zinc-800 hover:underline dark:text-zinc-200"
                          title="詳細（メモ）"
                        >
                          {p.name}
                        </button>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              toggleDetail();
                            }}
                            className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                          >
                            {isEditing ? '閉じる' : '詳細'}
                          </button>

                          <button
                            type="button"
                            onClick={() => setSiteListOpen(siteListOpen === p.id ? null : p.id)}
                            className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                          >
                            現場リスト
                          </button>

                          <button
                            type="button"
                            onClick={() => setInvoiceDialogOpen(p.id)}
                            className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                          >
                            請求書
                          </button>

                          <button
                            type="button"
                            onClick={() => setReportDialogOpen(p.id)}
                            className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                          >
                            報告書
                          </button>
                        </div>
                      </div>

                      {siteListOpen === p.id ? (
                        <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 px-2 py-2 text-[11px] dark:border-zinc-700 dark:bg-zinc-900">
                          <div className="font-medium text-zinc-700 dark:text-zinc-300">会社属性の現場リスト</div>
                          <div className="mt-1 space-y-1">
                            {sites.filter(s => s.companyName === p.name).length === 0 ? (
                              <div className="text-zinc-500 dark:text-zinc-400">（該当する現場はありません）</div>
                            ) : (
                              sites.filter(s => s.companyName === p.name).map(s => (
                                <div key={s.id} className="text-zinc-700 dark:text-zinc-300">• {s.name}</div>
                              ))
                            )}
                          </div>
                        </div>
                      ) : null}

                      {isEditing ? (
                        <div className="mt-2 space-y-2">
                          <input
                            value={draftEmail}
                            onChange={(e) => setDraftEmail(e.target.value)}
                            placeholder="送信先メール（例: example@contoso.com）"
                            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                          />
                          <input
                            value={draftFax}
                            onChange={(e) => setDraftFax(e.target.value)}
                            placeholder="FAX（例: 03-1234-5678）"
                            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                          />
                          <input
                            value={draftAddress}
                            onChange={(e) => setDraftAddress(e.target.value)}
                            placeholder="住所"
                            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                          />
                          <textarea
                            value={draftNotes}
                            onChange={(e) => setDraftNotes(e.target.value)}
                            rows={3}
                            placeholder="メモ"
                            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                          />
                          <div className="flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => {
                                const ok = window.confirm(`削除しますか？\n${p.name}`);
                                if (!ok) return;
                                void (async () => {
                                  setStatusMsg(null);
                                  try {
                                    const r = await fetch(`/api/partners/${encodeURIComponent(p.id)}`, {
                                      method: 'DELETE',
                                    });
                                    const j = (await r.json().catch(() => null)) as unknown;
                                    const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
                                    if (!r.ok || obj?.ok !== true) {
                                      throw new Error((obj?.error as string) || `HTTP ${r.status}`);
                                    }
                                    if (editingId === p.id) {
                                      setEditingId(null);
                                      setDraftNotes('');
                                      setDraftEmail('');
                                      setDraftFax('');
                                      setDraftAddress('');
                                    }
                                    await loadFromServer();
                                  } catch (e) {
                                    setSource('local');
                                    setPartners((cur) => cur.filter((x) => x !== p.name));
                                    setStatusMsg(
                                      e instanceof Error
                                        ? `DB削除失敗→ローカル削除: ${e.message}`
                                        : 'DB削除失敗→ローカル削除',
                                    );
                                  }
                                })();
                              }}
                              className="mh-btn-danger px-3 py-2 text-xs"
                            >
                              削除
                            </button>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(null);
                                  setDraftNotes('');
                                  setDraftEmail('');
                                  setDraftFax('');
                                  setDraftAddress('');
                                }}
                                className="mh-btn px-3 py-2 text-xs"
                              >
                                キャンセル
                              </button>
                              <button
                                type="button"
                                onClick={() => void saveNotes()}
                                className="mh-btn-primary px-3 py-2 text-xs"
                              >
                                保存
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {p.notes ? (
                        <div className="mt-2 whitespace-pre-wrap text-[11px] text-zinc-600 dark:text-zinc-300">
                          {p.notes}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              : visiblePartners.map((p) => (
                  <div
                    key={p}
                    data-color-edit-slot="border"
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                  >
                    <div className="min-w-0 flex-1 truncate text-xs text-zinc-800 dark:text-zinc-200">{p}</div>

                    <button
                      type="button"
                      onClick={() => {
                        const ok = window.confirm(`削除しますか？\n${p}`);
                        if (!ok) return;
                        setPartners((cur) => cur.filter((x) => x !== p));
                      }}
                      className="mh-btn-danger"
                    >
                      削除
                    </button>
                  </div>
                ))}
          </div>
        )}
      </div>
    </main>
  );
}
