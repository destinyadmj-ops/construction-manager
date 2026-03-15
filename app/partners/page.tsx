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
  const [selectedInvoiceSites, setSelectedInvoiceSites] = useState<Set<string>>(new Set());
  const [selectedReportSite, setSelectedReportSite] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // --- state for new site add ---
  const [newSiteName, setNewSiteName] = useState('');
  const [addingSite, setAddingSite] = useState(false);

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
      setDraftAddress('');
    } catch (e) {
      setStatusMsg(e instanceof Error ? `保存に失敗: ${e.message}` : '保存に失敗しました');
    }
  }, [draftAddress, draftEmail, draftFax, draftNotes, editingPartner, loadFromServer]);

  const toggleInvoiceSite = useCallback((siteId: string) => {
    setSelectedInvoiceSites(prev => {
      const next = new Set(prev);
      if (next.has(siteId)) {
        next.delete(siteId);
      } else {
        next.add(siteId);
      }
      return next;
    });
  }, []);

  const generateInvoices = useCallback(() => {
    if (selectedInvoiceSites.size === 0) return;
    const siteIds = Array.from(selectedInvoiceSites);
    // 請求書一括発行: 会計画面へパラメータ付きで遷移
    const params = new URLSearchParams();
    siteIds.forEach(id => params.append('siteId', id));
    window.location.href = `/accounting?${params.toString()}`;
  }, [selectedInvoiceSites]);

  const goToReport = useCallback(() => {
    if (!selectedReportSite) return;
    // 報告書作成画面へ遷移
    window.location.href = `/accounting?siteId=${encodeURIComponent(selectedReportSite)}`;
  }, [selectedReportSite]);

  const handleFileImport = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        if (!text) return;

        // CSV/TSV形式を解析（カンマまたはタブ区切り）
        const lines = text.split(/\r?\n/).filter(line => line.trim());
        if (lines.length === 0) {
          setStatusMsg('ファイルが空です');
          return;
        }

        // 1行目をヘッダーとして解析
        const delimiter = lines[0].includes('\t') ? '\t' : ',';
        const headers = lines[0].split(delimiter).map(h => h.trim().toLowerCase());
        
        // 2行目以降をデータとして解析
        const dataLines = lines.slice(1);
        
        // 編集中の場合は1件のみ取り込み
        if (editingId) {
          if (dataLines.length === 0) {
            setStatusMsg('取り込み可能なデータが見つかりませんでした');
            return;
          }

          const line = dataLines[0];
          const values = line.split(delimiter).map(v => v.trim());
          const row: Record<string, string> = {};
          headers.forEach((header, index) => {
            row[header] = values[index] || '';
          });

          const email = row['email'] || row['メール'] || row['mail'] || '';
          const fax = row['fax'] || row['ファックス'] || row['fax番号'] || '';
          const address = row['住所'] || row['address'] || row['所在地'] || '';
          const notes = row['メモ'] || row['notes'] || row['備考'] || '';

          setDraftEmail(email);
          setDraftFax(fax);
          setDraftAddress(address);
          setDraftNotes(notes);
          setStatusMsg('ファイルから1件の情報を取り込みました');
          return;
        }

        // 編集中でない場合は全件を一括登録
        const companies: Array<{
          name: string;
          email: string;
          fax: string;
          address: string;
          notes: string;
        }> = [];

        for (const line of dataLines) {
          const values = line.split(delimiter).map(v => v.trim());
          const row: Record<string, string> = {};
          headers.forEach((header, index) => {
            row[header] = values[index] || '';
          });

          // 会社名が必須
          const name = row['会社名'] || row['name'] || row['名前'] || row['company'];
          if (!name) continue;

          const email = row['email'] || row['メール'] || row['mail'] || '';
          const fax = row['fax'] || row['ファックス'] || row['fax番号'] || '';
          const address = row['住所'] || row['address'] || row['所在地'] || '';
          const notes = row['メモ'] || row['notes'] || row['備考'] || '';

          companies.push({ name, email, fax, address, notes });
        }

        if (companies.length === 0) {
          setStatusMsg('取り込み可能なデータが見つかりませんでした');
          return;
        }

        // 一括登録処理
        setStatusMsg(`${companies.length}件の会社情報を登録中...`);
        let successCount = 0;
        let failCount = 0;

        for (const company of companies) {
          try {
            const r = await fetch('/api/partners', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                name: company.name,
                email: company.email || null,
                fax: company.fax || null,
                address: company.address || null,
                notes: company.notes || null,
              }),
            });
            const j = (await r.json().catch(() => null)) as unknown;
            const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
            
            if (r.ok && obj?.ok === true) {
              successCount++;
            } else {
              failCount++;
              console.warn(`Failed to create partner: ${company.name}`, obj?.error);
            }
          } catch (error) {
            failCount++;
            console.error(`Error creating partner: ${company.name}`, error);
          }
        }

        // 結果を表示
        if (successCount > 0) {
          await loadFromServer();
          if (failCount > 0) {
            setStatusMsg(`${successCount}件登録成功、${failCount}件失敗しました`);
          } else {
            setStatusMsg(`${successCount}件の会社情報を登録しました`);
          }
        } else {
          setStatusMsg(`登録に失敗しました（${failCount}件）`);
        }
      } catch (error) {
        console.error('File import error:', error);
        setStatusMsg('ファイル取り込み中にエラーが発生しました');
      }
    };

    reader.onerror = () => {
      setStatusMsg('ファイル読み込みに失敗しました');
    };

    reader.readAsText(file, 'UTF-8');
    
    // input要素をリセット（同じファイルを再選択可能にする）
    event.target.value = '';
  }, [editingId, loadFromServer]);

  const triggerFileImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

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
          <button
            type="button"
            onClick={triggerFileImport}
            className="rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2 text-xs hover:bg-blue-50 dark:border-blue-800 dark:bg-blue-950/60 dark:hover:bg-blue-950"
            title="CSV/TSVファイルから会社情報を取り込み"
          >
            📄 ファイル取込
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.tsv,.txt"
            onChange={handleFileImport}
            className="hidden"
          />
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

                      {/* 現場リストドロップダウン */}
                      {siteListOpen === p.id ? (
                        <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 px-2 py-2 text-[11px] dark:border-zinc-700 dark:bg-zinc-900">
                          <div className="font-medium text-zinc-700 dark:text-zinc-300">会社属性の現場リスト</div>
                          <div className="mt-1 space-y-1">
                            {sites.filter(s => s.companyName === p.name).length === 0 ? (
                              <div className="text-zinc-500 dark:text-zinc-400">（該当する現場はありません）</div>
                            ) : (
                              sites.filter(s => s.companyName === p.name).map(s => (
                                <button
                                  key={s.id}
                                  className="text-zinc-700 dark:text-zinc-300 hover:underline hover:text-blue-600 dark:hover:text-blue-400"
                                  style={{ textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                                  onClick={() => window.open(`/site-ledger/${encodeURIComponent(s.id)}`, '_blank')}
                                  title="現場詳細を開く"
                                >
                                  • {s.name}
                                </button>
                              ))
                            )}
                          </div>
                          <div className="mt-2 flex gap-1">
                            <input
                              type="text"
                              value={newSiteName}
                              onChange={e => setNewSiteName(e.target.value)}
                              placeholder="新規現場名を追加"
                              className="rounded border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-700"
                              style={{ minWidth: 0, flex: 1 }}
                            />
                            <button
                              type="button"
                              className="rounded border border-blue-500 bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
                              disabled={!newSiteName.trim() || addingSite}
                              onClick={async () => {
                                if (!newSiteName.trim()) return;
                                setAddingSite(true);
                                try {
                                  const res = await fetch('/api/sites', {
                                    method: 'POST',
                                    headers: { 'content-type': 'application/json' },
                                    body: JSON.stringify({ name: newSiteName.trim(), companyName: p.name }),
                                  });
                                  const j = await res.json().catch(() => null);
                                  const obj = j && typeof j === 'object' ? j : null;
                                  if (!res.ok || obj?.ok !== true || !obj?.site?.id) throw new Error(obj?.error || '追加失敗');
                                  setNewSiteName('');
                                  setSites(cur => [...cur, { id: obj.site.id, name: obj.site.name, companyName: obj.site.companyName }]);
                                  window.open(`/site-ledger/${encodeURIComponent(obj.site.id)}`, '_blank');
                                } catch {
                                  alert('現場の追加に失敗しました');
                                } finally {
                                  setAddingSite(false);
                                }
                              }}
                            >
                              追加
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {/* 請求書ダイアログ */}
                      {invoiceDialogOpen === p.id ? (
                        <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
                          <div className="font-medium text-zinc-700 dark:text-zinc-300">請求書発行（複数選択）</div>
                          <div className="mt-2 space-y-1">
                            {sites.filter(s => s.companyName === p.name).length === 0 ? (
                              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">（該当する現場はありません）</div>
                            ) : (
                              sites.filter(s => s.companyName === p.name).map(s => (
                                <label key={s.id} className="flex items-center gap-2 text-[11px] text-zinc-700 hover:bg-zinc-100 px-1 py-1 rounded dark:text-zinc-300 dark:hover:bg-zinc-800">
                                  <input
                                    type="checkbox"
                                    checked={selectedInvoiceSites.has(s.id)}
                                    onChange={() => toggleInvoiceSite(s.id)}
                                    className="rounded"
                                  />
                                  {s.name}
                                </label>
                              ))
                            )}
                          </div>
                          <div className="mt-2 flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setInvoiceDialogOpen(null);
                                setSelectedInvoiceSites(new Set());
                              }}
                              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                            >
                              キャンセル
                            </button>
                            <button
                              type="button"
                              onClick={generateInvoices}
                              disabled={selectedInvoiceSites.size === 0}
                              className="rounded-md border border-blue-500 bg-blue-500 px-2 py-1 text-[11px] text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              一括発行 ({selectedInvoiceSites.size})
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {/* 報告書ダイアログ */}
                      {reportDialogOpen === p.id ? (
                        <div className="mt-2 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
                          <div className="font-medium text-zinc-700 dark:text-zinc-300">報告書作成</div>
                          <div className="mt-2 space-y-1">
                            {sites.filter(s => s.companyName === p.name).length === 0 ? (
                              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">（該当する現場はありません）</div>
                            ) : (
                              sites.filter(s => s.companyName === p.name).map(s => (
                                <label key={s.id} className="flex items-center gap-2 text-[11px] text-zinc-700 hover:bg-zinc-100 px-1 py-1 rounded dark:text-zinc-300 dark:hover:bg-zinc-800">
                                  <input
                                    type="radio"
                                    name={`report-site-${p.id}`}
                                    checked={selectedReportSite === s.id}
                                    onChange={() => setSelectedReportSite(s.id)}
                                    className="rounded-full"
                                  />
                                  {s.name}
                                </label>
                              ))
                            )}
                          </div>
                          <div className="mt-2 flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setReportDialogOpen(null);
                                setSelectedReportSite(null);
                              }}
                              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                            >
                              キャンセル
                            </button>
                            <button
                              type="button"
                              onClick={goToReport}
                              disabled={!selectedReportSite}
                              className="rounded-md border border-blue-500 bg-blue-500 px-2 py-1 text-[11px] text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              作成画面へ
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {/* 編集フォーム */}
                      {isEditing ? (
                        <div className="mt-2 space-y-2">
                          <div className="flex items-center justify-between pb-1 border-b border-zinc-200 dark:border-zinc-800">
                            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">会社情報を編集</div>
                            <button
                              type="button"
                              onClick={triggerFileImport}
                              className="rounded-md border border-blue-200 bg-blue-50/60 px-2 py-1 text-[11px] hover:bg-blue-50 dark:border-blue-800 dark:bg-blue-950/60 dark:hover:bg-blue-950"
                              title="CSV/TSVファイルから会社情報を取り込み"
                            >
                              📄 ファイル取込
                            </button>
                          </div>
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
