'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type SearchItem = {
  siteId: string;
  siteLabel: string;
  companyName: string | null;
  alertsEnabled: boolean;
  workCount: number;
  invoiceIssuedThisMonth: boolean;
  partner: { id: string; name: string; email: string | null; fax: string | null } | null;
};

type CompanyGroup = {
  companyName: string;
  partner: { id: string; name: string; email: string | null; fax: string | null } | null;
  sites: SearchItem[];
  totalWorkCount: number;
};

type JsonObject = Record<string, unknown>;

function asObject(v: unknown): JsonObject | null {
  return v && typeof v === 'object' ? (v as JsonObject) : null;
}

function getStringField(obj: unknown, key: string): string | null {
  const o = asObject(obj);
  const v = o?.[key];
  return typeof v === 'string' ? v : null;
}

function toYmd(d: Date) {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function firstOfThisMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function lastOfThisMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0);
}

export default function InvoiceIssuePage() {
  const router = useRouter();

  const [from, setFrom] = useState<string>(() => toYmd(firstOfThisMonth()));
  const [to, setTo] = useState<string>(() => toYmd(lastOfThisMonth()));
  const [company, setCompany] = useState('');

  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [items, setItems] = useState<SearchItem[]>([]);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [expandedCompanies, setExpandedCompanies] = useState<Record<string, boolean>>({});

  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);

  const companyGroups = useMemo<CompanyGroup[]>(() => {
    const map: Record<string, CompanyGroup> = {};
    
    for (const item of items) {
      const key = item.companyName || '（会社名なし）';
      if (!map[key]) {
        map[key] = {
          companyName: key,
          partner: item.partner,
          sites: [],
          totalWorkCount: 0,
        };
      }
      map[key].sites.push(item);
      map[key].totalWorkCount += item.workCount;
    }
    
    return Object.values(map).sort((a, b) => a.companyName.localeCompare(b.companyName));
  }, [items]);

  const hasMissingPartner = useMemo(() => {
    const map: Record<string, SearchItem> = {};
    for (const it of items) map[it.siteId] = it;
    return selectedIds.some((id) => !map[id]?.partner);
  }, [items, selectedIds]);

  const runSearch = useCallback(async () => {
    setStatusMsg(null);
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set('from', from);
      qs.set('to', to);
      if (company.trim()) qs.set('company', company.trim());
      const r = await fetch(`/api/invoices/issue/search?${qs.toString()}`, { cache: 'no-store' });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = asObject(j);
      const itemsRaw = Array.isArray(obj?.items) ? (obj?.items as unknown[]) : null;
      if (!r.ok || obj?.ok !== true || !itemsRaw) {
        throw new Error(getStringField(obj, 'error') || `HTTP ${r.status}`);
      }
      const parsed: SearchItem[] = itemsRaw
        .map((x) => {
          const o = asObject(x);
          const siteId = getStringField(o, 'siteId');
          const siteLabel = getStringField(o, 'siteLabel');

          const companyNameVal = o?.companyName;
          const companyName =
            typeof companyNameVal === 'string' ? companyNameVal : companyNameVal === null ? null : null;

          const alertsEnabled = typeof o?.alertsEnabled === 'boolean' ? o.alertsEnabled : true;
          const workCount = typeof o?.workCount === 'number' ? o.workCount : 0;
          const invoiceIssuedThisMonth = typeof o?.invoiceIssuedThisMonth === 'boolean' ? o.invoiceIssuedThisMonth : false;

          const p = asObject(o?.partner);
          const partnerId = getStringField(p, 'id');
          const partnerName = getStringField(p, 'name');
          const partnerEmailVal = p?.email;
          const partnerFaxVal = p?.fax;
          const partner =
            partnerId && partnerName
              ? {
                  id: partnerId,
                  name: partnerName,
                  email:
                    typeof partnerEmailVal === 'string' ? partnerEmailVal : partnerEmailVal === null ? null : null,
                  fax: typeof partnerFaxVal === 'string' ? partnerFaxVal : partnerFaxVal === null ? null : null,
                }
              : null;

          if (!siteId || !siteLabel) return null;
          return { siteId, siteLabel, companyName, alertsEnabled, workCount, invoiceIssuedThisMonth, partner };
        })
        .filter((x): x is SearchItem => !!x);

      setItems(parsed);
      setSelected({});
      setStatusMsg(`${parsed.length}件ヒット`);
    } catch (e) {
      setItems([]);
      setSelected({});
      setStatusMsg(e instanceof Error ? e.message : '検索に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [company, from, to]);

  const selectAll = useCallback(() => {
    const next: Record<string, boolean> = {};
    for (const it of items) next[it.siteId] = true;
    setSelected(next);
  }, [items]);

  const clearAll = useCallback(() => setSelected({}), []);

  const toggleCompany = useCallback((companyName: string) => {
    setExpandedCompanies((prev) => ({ ...prev, [companyName]: !prev[companyName] }));
  }, []);

  const selectCompany = useCallback((group: CompanyGroup) => {
    setSelected((prev) => {
      const next = { ...prev };
      for (const site of group.sites) {
        next[site.siteId] = true;
      }
      return next;
    });
  }, []);

  const clearCompany = useCallback((group: CompanyGroup) => {
    setSelected((prev) => {
      const next = { ...prev };
      for (const site of group.sites) {
        delete next[site.siteId];
      }
      return next;
    });
  }, []);

  const issueSelected = useCallback(async () => {
    if (selectedIds.length === 0) return;
    const ok = window.confirm(`選択した${selectedIds.length}件を請求書発行（請求未アラート解除）しますか？`);
    if (!ok) return;

    setStatusMsg(null);
    try {
      const r = await fetch('/api/invoices/issue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteIds: selectedIds, from, to }),
      });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = asObject(j);
      if (!r.ok || obj?.ok !== true) throw new Error(getStringField(obj, 'error') || `HTTP ${r.status}`);
      const created = typeof obj?.created === 'number' ? obj.created : 0;
      const already = typeof obj?.alreadyIssued === 'number' ? obj.alreadyIssued : 0;
      setStatusMsg(`発行しました（新規 ${created} / 既発行 ${already}）`);
      await runSearch();
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : '発行に失敗しました');
    }
  }, [from, runSearch, selectedIds, to]);

  const doBatch = useCallback(
    async (kind: 'print' | 'fax' | 'email') => {
      if (selectedIds.length === 0) return;
      const title = kind === 'print' ? '印刷' : kind === 'fax' ? 'FAX送信' : 'メール送信（PDF）';
      const ok = window.confirm(`選択した${selectedIds.length}件を${title}しますか？`);
      if (!ok) return;

      setStatusMsg(null);
      const map: Record<string, SearchItem> = {};
      for (const it of items) map[it.siteId] = it;

      let okCount = 0;
      let failCount = 0;
      for (const siteId of selectedIds) {
        const it = map[siteId];
        const partnerId = it?.partner?.id ?? '';
        if (!partnerId) {
          failCount++;
          continue;
        }
        try {
          if (kind === 'print') {
            const r = await fetch('/api/print/invoice', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ siteId, partnerId, from, to }),
            });
            const j = (await r.json().catch(() => null)) as unknown;
            const obj = asObject(j);
            if (!r.ok || obj?.ok !== true) throw new Error(getStringField(obj, 'error') || `HTTP ${r.status}`);
          } else if (kind === 'fax') {
            const r = await fetch('/api/fax/send-invoice', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ siteId, partnerId, from, to }),
            });
            const j = (await r.json().catch(() => null)) as unknown;
            const obj = asObject(j);
            if (!r.ok || obj?.ok !== true) throw new Error(getStringField(obj, 'error') || `HTTP ${r.status}`);
          } else {
            const r = await fetch('/api/outlook/send-report', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ siteId, partnerId, kind: 'invoice', from, to }),
            });
            const j = (await r.json().catch(() => null)) as unknown;
            const obj = asObject(j);
            if (!r.ok || obj?.ok !== true) throw new Error(getStringField(obj, 'error') || `HTTP ${r.status}`);
          }
          okCount++;
        } catch {
          failCount++;
        }
      }
      setStatusMsg(`${title}: OK ${okCount} / NG ${failCount}${failCount > 0 ? '（宛先未設定等）' : ''}`);
    },
    [from, items, selectedIds, to],
  );

  return (
    <main className="mx-auto w-full max-w-screen-lg px-4 py-4 lg:px-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">請求書発行</h1>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">日付期間/会社名で検索し、チェック選択で発行します。</div>
          </div>
          <button
            type="button"
            onClick={() => router.push('/invoices')}
            className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
          >
            請求書へ戻る
          </button>
        </div>

        {statusMsg ? <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{statusMsg}</div> : null}

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">開始日</div>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
            />
          </div>
          <div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">終了日</div>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
            />
          </div>
          <div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">会社名（検索）</div>
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="会社名/現場名"
              className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void runSearch()}
            disabled={loading}
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
          >
            {loading ? '検索中…' : '検索'}
          </button>

          <button
            type="button"
            onClick={selectAll}
            disabled={items.length === 0}
            className="mh-btn px-3 py-2 text-xs"
          >
            全選択
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={selectedIds.length === 0}
            className="mh-btn px-3 py-2 text-xs"
          >
            全解除
          </button>

          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">選択: {selectedIds.length}件</div>
          {hasMissingPartner ? (
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">※ 宛先（Partner）が未設定の現場は送信NG</div>
          ) : null}
        </div>

        <div className="mt-4 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/40">
          <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">検索結果（会社別）</div>

          {items.length === 0 ? (
            <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">（検索してください）</div>
          ) : companyGroups.length === 0 ? (
            <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">（該当する現場がありません）</div>
          ) : (
            <div className="mt-2 space-y-3">
              {companyGroups.map((group) => {
                const isExpanded = expandedCompanies[group.companyName];
                const selectedSitesInGroup = group.sites.filter((s) => selected[s.siteId]).length;
                
                return (
                  <div key={group.companyName} className="rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-black">
                    <div className="flex items-center gap-2 p-3">
                      <button
                        type="button"
                        onClick={() => toggleCompany(group.companyName)}
                        className="flex-1 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {isExpanded ? '▼' : '▶'} {group.companyName}
                          </span>
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            （現場 {group.sites.length}件 / 作業 {group.totalWorkCount}件）
                          </span>
                        </div>
                        {group.partner && (
                          <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                            宛先: {group.partner.name}
                            {group.partner.email ? ` <${group.partner.email}>` : ''}
                            {group.partner.fax ? ` / FAX:${group.partner.fax}` : ''}
                          </div>
                        )}
                      </button>
                      
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {selectedSitesInGroup}/{group.sites.length}選択
                        </span>
                        <button
                          type="button"
                          onClick={() => selectCompany(group)}
                          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                        >
                          全選択
                        </button>
                        <button
                          type="button"
                          onClick={() => clearCompany(group)}
                          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                        >
                          解除
                        </button>
                      </div>
                    </div>
                    
                    {isExpanded && (
                      <div className="border-t border-zinc-200 p-2 dark:border-zinc-800">
                        <div className="space-y-1">
                          {group.sites.map((site) => {
                            const siteName = site.siteLabel.includes(' / ') 
                              ? site.siteLabel.split(' / ').slice(1).join(' / ') 
                              : site.siteLabel;
                            
                            return (
                              <label
                                key={site.siteId}
                                className="flex items-center gap-2 rounded-md bg-zinc-50 px-2 py-2 text-xs text-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300"
                              >
                                <input
                                  type="checkbox"
                                  checked={!!selected[site.siteId]}
                                  onChange={(e) => setSelected((m) => ({ ...m, [site.siteId]: e.target.checked }))}
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="min-w-0 flex-1 truncate">{siteName}</div>
                                    <div className="shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">
                                      件数: {site.workCount}
                                    </div>
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                                    {site.invoiceIssuedThisMonth ? '（当月: 発行済）' : '（当月: 未発行）'}
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={() => void issueSelected()}
            className="mh-btn-primary px-3 py-2 text-xs"
          >
            請求書発行（アラート解除）
          </button>

          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={() => void doBatch('print')}
            className="mh-btn px-3 py-2 text-xs"
          >
            印刷
          </button>

          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={() => void doBatch('fax')}
            className="mh-btn px-3 py-2 text-xs"
          >
            FAX送信
          </button>

          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={() => void doBatch('email')}
            className="mh-btn px-3 py-2 text-xs"
          >
            メール送信（PDF）
          </button>
        </div>
      </div>
    </main>
  );
}
