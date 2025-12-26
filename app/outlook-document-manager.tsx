'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type SiteListItem = { id: string; companyName: string | null; name: string };
type PartnerListItem = {
  id: string;
  name: string;
  email: string | null;
  outlookToEmailDefault: string | null;
  outlookSubjectReportDefault: string | null;
  outlookSubjectInvoiceDefault: string | null;
};

type OutlookSendLogItem = {
  id: string;
  createdAt: string;
  kind: 'REPORT' | 'INVOICE';
  status: 'SENT' | 'FAILED';
  toEmail: string;
  subject: string;
  error: string | null;
  site: { id: string; label: string };
  partner: { id: string; name: string; email: string | null };
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

function addDays(input: Date, days: number) {
  const d = new Date(input);
  d.setDate(d.getDate() + days);
  return d;
}

function startOfWeekMonday(input: Date) {
  const d = new Date(input);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function computeDefaultSubject(args: {
  title: string;
  siteLabel: string;
  partnerName: string;
}) {
  const sitePart = args.siteLabel || '（未選択）';
  return `${args.title}: ${sitePart} / ${args.partnerName}`.trim();
}

export default function OutlookDocumentManager(props: { kind: 'report' | 'invoice' }) {
  const kind = props.kind;
  const title = kind === 'report' ? '報告書' : '請求書';

  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [sites, setSites] = useState<SiteListItem[]>([]);
  const [partners, setPartners] = useState<PartnerListItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [siteQuery, setSiteQuery] = useState('');
  const [partnerQuery, setPartnerQuery] = useState('');

  const [fixedSiteLabel, setFixedSiteLabel] = useState<string | null>(null);

  const [siteId, setSiteId] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [sending, setSending] = useState(false);

  const [toEmailDraft, setToEmailDraft] = useState('');
  const [subjectDraft, setSubjectDraft] = useState('');
  const [toEmailTouched, setToEmailTouched] = useState(false);
  const [subjectTouched, setSubjectTouched] = useState(false);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem('masterHub.lastSelectedSiteLabel');
      setFixedSiteLabel(v && v.trim().length > 0 ? v.trim() : null);
    } catch {
      setFixedSiteLabel(null);
    }
  }, []);

  const fixedSiteId = useMemo(() => {
    const label = fixedSiteLabel?.trim();
    if (!label) return null;
    const hit = sites.find((s) => `${s.companyName ? `${s.companyName} ` : ''}${s.name}`.trim() === label) ?? null;
    return hit?.id ?? null;
  }, [fixedSiteLabel, sites]);

  const visibleSites = useMemo(() => {
    const q = siteQuery.trim().toLowerCase();
    if (!q) return sites;
    return sites.filter((s) => {
      const label = `${s.companyName ? `${s.companyName} ` : ''}${s.name}`.trim().toLowerCase();
      return label.includes(q);
    });
  }, [siteQuery, sites]);

  const visiblePartners = useMemo(() => {
    const q = partnerQuery.trim().toLowerCase();
    if (!q) return partners;
    return partners.filter((p) => {
      const label = `${p.name}${p.email ? ` ${p.email}` : ''}`.toLowerCase();
      return label.includes(q);
    });
  }, [partnerQuery, partners]);

  useEffect(() => {
    if (!fixedSiteId) return;
    if (siteId !== fixedSiteId) setSiteId(fixedSiteId);
  }, [fixedSiteId, siteId]);

  const [statusFilter, setStatusFilter] = useState<'ALL' | 'SENT' | 'FAILED'>('ALL');
  const [fromDate, setFromDate] = useState<string>(() => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return toYmd(first);
  });
  const [toDate, setToDate] = useState<string>(() => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return toYmd(next);
  });

  const [logs, setLogs] = useState<OutlookSendLogItem[]>([]);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);

  const loadLists = useCallback(async () => {
    setLoadError(null);
    try {
      const [sitesRes, partnersRes] = await Promise.all([fetch('/api/sites'), fetch('/api/partners')]);
      const sitesJson = (await sitesRes.json().catch(() => null)) as unknown;
      const partnersJson = (await partnersRes.json().catch(() => null)) as unknown;
      const sitesObj = asObject(sitesJson);
      const partnersObj = asObject(partnersJson);
      if (!sitesRes.ok || sitesObj?.ok !== true) throw new Error(getStringField(sitesObj, 'error') || `sites HTTP ${sitesRes.status}`);
      if (!partnersRes.ok || partnersObj?.ok !== true) {
        throw new Error(getStringField(partnersObj, 'error') || `partners HTTP ${partnersRes.status}`);
      }

      const sitesRaw = Array.isArray(sitesObj.sites) ? sitesObj.sites : [];
      const parsedSites = sitesRaw
        .map((x) => asObject(x))
        .map((o) => {
          const id = getStringField(o, 'id');
          const name = getStringField(o, 'name');
          const companyNameVal = o?.companyName;
          const companyName = typeof companyNameVal === 'string' ? companyNameVal : companyNameVal === null ? null : null;
          if (!id || !name) return null;
          return { id, name, companyName } satisfies SiteListItem;
        })
        .filter((x): x is SiteListItem => !!x);

      const partnersRaw = Array.isArray(partnersObj.partners) ? partnersObj.partners : [];
      const parsedPartners = partnersRaw
        .map((x) => asObject(x))
        .map((o) => {
          const id = getStringField(o, 'id');
          const name = getStringField(o, 'name');
          const emailVal = o?.email;
          const email = typeof emailVal === 'string' ? emailVal : emailVal === null ? null : null;
          const odeVal = o?.outlookToEmailDefault;
          const outlookToEmailDefault = typeof odeVal === 'string' ? odeVal : odeVal === null ? null : null;
          const osrVal = o?.outlookSubjectReportDefault;
          const outlookSubjectReportDefault = typeof osrVal === 'string' ? osrVal : osrVal === null ? null : null;
          const osiVal = o?.outlookSubjectInvoiceDefault;
          const outlookSubjectInvoiceDefault = typeof osiVal === 'string' ? osiVal : osiVal === null ? null : null;
          if (!id || !name) return null;
          return {
            id,
            name,
            email,
            outlookToEmailDefault,
            outlookSubjectReportDefault,
            outlookSubjectInvoiceDefault,
          } satisfies PartnerListItem;
        })
        .filter((x): x is PartnerListItem => !!x);

      setSites(parsedSites);
      setPartners(parsedPartners);

      if (!siteId && parsedSites.length > 0) setSiteId(parsedSites[0].id);
      if (!partnerId && parsedPartners.length > 0) setPartnerId(parsedPartners[0].id);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'DBの読み込みに失敗しました');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  const loadLogs = useCallback(async () => {
    if (!siteId || !partnerId) {
      setLogs([]);
      return;
    }
    if (logsLoading) return;

    setLogsLoading(true);
    setLogsError(null);

    try {
      const qs = new URLSearchParams();
      qs.set('siteId', siteId);
      qs.set('partnerId', partnerId);
      qs.set('kind', kind === 'invoice' ? 'INVOICE' : 'REPORT');
      if (statusFilter !== 'ALL') qs.set('status', statusFilter);
      if (fromDate.trim()) qs.set('from', `${fromDate}T00:00:00.000Z`);
      if (toDate.trim()) qs.set('to', `${toDate}T00:00:00.000Z`);
      qs.set('limit', '50');

      const r = await fetch(`/api/outlook/send-logs?${qs.toString()}`);
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = asObject(j);
      if (!r.ok || obj?.ok !== true) throw new Error(getStringField(obj, 'error') || `HTTP ${r.status}`);

      const raw = Array.isArray(obj.logs) ? obj.logs : [];
      const parsed = raw
        .map((x) => asObject(x))
        .map((o) => {
          const id = getStringField(o, 'id');
          const createdAt = getStringField(o, 'createdAt');
          const kindStr = getStringField(o, 'kind');
          const statusStr = getStringField(o, 'status');
          const toEmail = getStringField(o, 'toEmail');
          const subject = getStringField(o, 'subject');
          const errorVal = o?.error;
          const error = typeof errorVal === 'string' ? errorVal : errorVal === null ? null : null;
          const siteObj = asObject(o?.site);
          const partnerObj = asObject(o?.partner);
          const siteIdVal = getStringField(siteObj, 'id');
          const siteLabel = getStringField(siteObj, 'label');
          const partnerIdVal = getStringField(partnerObj, 'id');
          const partnerName = getStringField(partnerObj, 'name');
          const partnerEmailVal = partnerObj?.email;
          const partnerEmail = typeof partnerEmailVal === 'string' ? partnerEmailVal : partnerEmailVal === null ? null : null;

          if (!id || !createdAt || !toEmail || !subject) return null;
          if (kindStr !== 'REPORT' && kindStr !== 'INVOICE') return null;
          if (statusStr !== 'SENT' && statusStr !== 'FAILED') return null;
          if (!siteIdVal || !siteLabel || !partnerIdVal || !partnerName) return null;

          return {
            id,
            createdAt,
            kind: kindStr,
            status: statusStr,
            toEmail,
            subject,
            error,
            site: { id: siteIdVal, label: siteLabel },
            partner: { id: partnerIdVal, name: partnerName, email: partnerEmail },
          } satisfies OutlookSendLogItem;
        })
        .filter((x): x is OutlookSendLogItem => !!x);

      setLogs(parsed);
    } catch (e) {
      setLogs([]);
      setLogsError(e instanceof Error ? e.message : '履歴の取得に失敗しました');
    } finally {
      setLogsLoading(false);
    }
  }, [fromDate, kind, logsLoading, partnerId, siteId, statusFilter, toDate]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const siteLabel = useMemo(() => {
    const hit = sites.find((s) => s.id === siteId);
    if (!hit) return '';
    return `${hit.companyName ? `${hit.companyName} ` : ''}${hit.name}`.trim();
  }, [siteId, sites]);

  const partnerName = useMemo(() => {
    const hit = partners.find((p) => p.id === partnerId);
    return hit?.name ?? '';
  }, [partnerId, partners]);

  const partnerLabel = useMemo(() => {
    const hit = partners.find((p) => p.id === partnerId);
    if (!hit) return '';
    return `${hit.name}${hit.email ? ` <${hit.email}>` : ''}`;
  }, [partnerId, partners]);

  useEffect(() => {
    // パートナー切替時に既定を反映（入力の "触った" 状態もリセット）
    setToEmailTouched(false);
    setSubjectTouched(false);

    if (!partnerId) {
      setToEmailDraft('');
      setSubjectDraft('');
      return;
    }
    const hit = partners.find((p) => p.id === partnerId) ?? null;
    const baseToEmail = (hit?.outlookToEmailDefault ?? hit?.email ?? '').trim();
    setToEmailDraft(baseToEmail);

    const generated = computeDefaultSubject({ title, siteLabel, partnerName: hit?.name ?? '' });
    const baseSubject =
      kind === 'report'
        ? (hit?.outlookSubjectReportDefault ?? generated)
        : (hit?.outlookSubjectInvoiceDefault ?? generated);
    setSubjectDraft(baseSubject);
  }, [kind, partnerId, partners, siteLabel, title]);

  useEffect(() => {
    // 現場変更時は、ユーザーが件名を触っていない場合のみ自動更新
    if (subjectTouched) return;
    if (!partnerId) return;
    if (!partnerName) return;

    const hit = partners.find((p) => p.id === partnerId) ?? null;
    const generated = computeDefaultSubject({ title, siteLabel, partnerName });
    const baseSubject =
      kind === 'report'
        ? (hit?.outlookSubjectReportDefault ?? generated)
        : (hit?.outlookSubjectInvoiceDefault ?? generated);
    setSubjectDraft(baseSubject);
  }, [kind, partnerId, partnerName, partners, siteLabel, subjectTouched, title]);

  const smallBtn =
    'rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black';

  const copyText = useCallback(async (label: string, text: string) => {
    const v = text.trim();
    if (!v) return;
    try {
      await navigator.clipboard.writeText(v);
      setStatusMsg(`${label} をコピーしました`);
    } catch {
      setStatusMsg('コピーに失敗しました');
    }
  }, []);

  return (
    <main className="mx-auto w-full max-w-screen-2xl px-4 py-4 lg:px-6">
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-black">
        <h1 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{title} 管理</h1>
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          送信（Outlook）と送信フォルダ（履歴）をまとめて管理します。
        </div>

        {statusMsg ? <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{statusMsg}</div> : null}

        <div className="mt-5 rounded-lg border border-zinc-200 bg-white/60 p-3 dark:border-zinc-800 dark:bg-black/60">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">送信</div>
              <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">選択した現場/会社へ {title} PDF を送信します。</div>
            </div>
            <button type="button" className={smallBtn} onClick={() => void loadLists()}>
              再読込
            </button>
          </div>

          {loadError ? <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{loadError}</div> : null}

          <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-[140px_1fr]">
            <label className="text-[11px] text-zinc-600 dark:text-zinc-400">現場</label>
            <div className="space-y-1">
              <input
                value={siteQuery}
                onChange={(e) => setSiteQuery(e.target.value)}
                placeholder="現場を検索"
                disabled={!!fixedSiteId}
                className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black"
              />
              <select
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                disabled={!!fixedSiteId}
                className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black"
              >
                {visibleSites.length === 0 ? <option value="">（現場なし）</option> : null}
                {visibleSites.map((s) => {
                  const label = `${s.companyName ? `${s.companyName} ` : ''}${s.name}`.trim();
                  return (
                    <option key={s.id} value={s.id}>
                      {label}
                    </option>
                  );
                })}
              </select>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                表示: {visibleSites.length} / 全体: {sites.length}
              </div>
            </div>

            {fixedSiteLabel ? (
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400 lg:col-span-2">
                {fixedSiteId ? '選択中の現場を自動反映中: ' : '選択中の現場（自動反映できず）: '}
                {fixedSiteLabel}
              </div>
            ) : null}

            <label className="text-[11px] text-zinc-600 dark:text-zinc-400">宛先（関係会社）</label>
            <div className="space-y-1">
              <input
                value={partnerQuery}
                onChange={(e) => setPartnerQuery(e.target.value)}
                placeholder="会社を検索"
                className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
              />
              <select
                value={partnerId}
                onChange={(e) => setPartnerId(e.target.value)}
                className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
              >
                {visiblePartners.length === 0 ? <option value="">（会社なし）</option> : null}
                {visiblePartners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.email ? ` <${p.email}>` : '（メール未設定）'}
                  </option>
                ))}
              </select>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                表示: {visiblePartners.length} / 全体: {partners.length}
              </div>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
              現場: {siteLabel || '（未選択）'} / 宛先: {partnerLabel || '（未選択）'}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={smallBtn}
                disabled={!partnerId}
                onClick={() => {
                  void (async () => {
                    if (!partnerId) return;
                    setStatusMsg(null);
                    try {
                      const payload: Record<string, unknown> = {
                        id: partnerId,
                        outlookToEmailDefault: toEmailDraft.trim() || null,
                      };
                      if (kind === 'report') {
                        payload.outlookSubjectReportDefault = subjectDraft.trim() || null;
                      } else {
                        payload.outlookSubjectInvoiceDefault = subjectDraft.trim() || null;
                      }

                      const r = await fetch('/api/partners', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify(payload),
                      });
                      const j = (await r.json().catch(() => null)) as unknown;
                      const obj = asObject(j);
                      if (!r.ok || obj?.ok !== true) {
                        throw new Error(getStringField(obj, 'error') || `HTTP ${r.status}`);
                      }
                      await loadLists();
                      setStatusMsg('既定を保存しました');
                    } catch (e) {
                      setStatusMsg(e instanceof Error ? e.message : '既定の保存に失敗しました');
                    }
                  })();
                }}
              >
                既定に保存
              </button>
              <button
                type="button"
                className={smallBtn}
                disabled={sending || !siteId || !partnerId || !toEmailDraft.trim() || !subjectDraft.trim()}
                onClick={() => {
                  void (async () => {
                    if (sending) return;
                    setStatusMsg(null);
                    setSending(true);
                    try {
                      const r = await fetch('/api/outlook/send-report', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                          siteId,
                          partnerId,
                          kind,
                          toEmail: toEmailDraft.trim(),
                          subject: subjectDraft.trim(),
                        }),
                      });
                      const j = (await r.json().catch(() => null)) as unknown;
                      const obj = asObject(j);
                      if (!r.ok || obj?.ok !== true) {
                        throw new Error(getStringField(obj, 'error') || `HTTP ${r.status}`);
                      }
                      setStatusMsg('送信しました');
                      void loadLogs();
                    } catch (e) {
                      setStatusMsg(e instanceof Error ? e.message : '送信に失敗しました');
                      void loadLogs();
                    } finally {
                      setSending(false);
                    }
                  })();
                }}
              >
                {sending ? '送信中…' : '送信'}
              </button>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-[140px_1fr]">
            <label className="text-[11px] text-zinc-600 dark:text-zinc-400">宛先（メール）</label>
            <input
              value={toEmailDraft}
              onChange={(e) => {
                setToEmailTouched(true);
                setToEmailDraft(e.target.value);
              }}
              placeholder="to@example.com"
              className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
            />

            <label className="text-[11px] text-zinc-600 dark:text-zinc-400">件名</label>
            <input
              value={subjectDraft}
              onChange={(e) => {
                setSubjectTouched(true);
                setSubjectDraft(e.target.value);
              }}
              placeholder={`${title}: 現場名 / 会社名`}
              className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
            />
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-zinc-200 bg-white/60 p-3 dark:border-zinc-800 dark:bg-black/60">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">送信フォルダ（履歴）</div>
              <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">会社/現場/日付で検索できます。</div>
            </div>
            <button type="button" className={smallBtn} onClick={() => void loadLogs()} disabled={logsLoading}>
              {logsLoading ? '更新中…' : '更新'}
            </button>
          </div>

          <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-[140px_1fr]">
            <label className="text-[11px] text-zinc-600 dark:text-zinc-400">期間プリセット</label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={smallBtn}
                onClick={() => {
                  const now = new Date();
                  const first = new Date(now.getFullYear(), now.getMonth(), 1);
                  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                  setFromDate(toYmd(first));
                  setToDate(toYmd(next));
                }}
              >
                今月
              </button>
              <button
                type="button"
                className={smallBtn}
                onClick={() => {
                  const now = new Date();
                  const firstThis = new Date(now.getFullYear(), now.getMonth(), 1);
                  const firstPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                  setFromDate(toYmd(firstPrev));
                  setToDate(toYmd(firstThis));
                }}
              >
                先月
              </button>
              <button
                type="button"
                className={smallBtn}
                onClick={() => {
                  const from = startOfWeekMonday(new Date());
                  const to = addDays(from, 7);
                  setFromDate(toYmd(from));
                  setToDate(toYmd(to));
                }}
              >
                今週
              </button>
              <button
                type="button"
                className={smallBtn}
                onClick={() => {
                  const thisMon = startOfWeekMonday(new Date());
                  const prevMon = addDays(thisMon, -7);
                  setFromDate(toYmd(prevMon));
                  setToDate(toYmd(thisMon));
                }}
              >
                先週
              </button>
            </div>

            <label className="text-[11px] text-zinc-600 dark:text-zinc-400">状態</label>
            <select
              value={statusFilter}
              onChange={(e) => {
                const v = e.target.value;
                setStatusFilter(v === 'SENT' ? 'SENT' : v === 'FAILED' ? 'FAILED' : 'ALL');
              }}
              className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
            >
              <option value="ALL">すべて</option>
              <option value="SENT">送信OK</option>
              <option value="FAILED">失敗</option>
            </select>

            <label className="text-[11px] text-zinc-600 dark:text-zinc-400">日付（開始）</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
            />

            <label className="text-[11px] text-zinc-600 dark:text-zinc-400">日付（終了）</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
            />
          </div>

          {logsError ? <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{logsError}</div> : null}

          {logs.length === 0 ? (
            <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">（履歴なし）</div>
          ) : (
            <div className="mt-2 space-y-1">
              {logs.slice(0, 50).map((x) => (
                <div
                  key={x.id}
                  className="rounded-md border border-zinc-200 px-2 py-2 text-[11px] text-zinc-700 dark:border-zinc-800 dark:text-zinc-300"
                  title={x.error ?? ''}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1 truncate">
                      {x.createdAt.replace('T', ' ').replace('Z', '')}
                      <span className="ml-2 text-zinc-500 dark:text-zinc-400">
                        {x.status === 'SENT' ? '送信OK' : '失敗'} / {x.toEmail}
                      </span>
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1 truncate text-zinc-500 dark:text-zinc-400">{x.subject}</div>
                    <button type="button" className={smallBtn} onClick={() => void copyText('件名', x.subject)}>
                      件名コピー
                    </button>
                  </div>
                  {x.status === 'FAILED' && x.error ? (
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 flex-1 truncate text-zinc-500 dark:text-zinc-400">{x.error}</div>
                      <button type="button" className={smallBtn} onClick={() => void copyText('エラー', x.error || '')}>
                        エラーコピー
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
