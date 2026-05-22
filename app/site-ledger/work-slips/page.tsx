'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type SiteAlertItem = {
  id: string;
  companyName: string | null;
  name: string;
  scheduleLabelColor: string;
  caution: string | null;
  invoiceIssuedThisMonth: boolean | undefined;
  reportIssuedThisMonth: boolean | undefined;
  paceNotConsumedAlert: boolean | undefined;
  unassignedThisMonth: boolean | undefined;
};

type WorkSlipSummaryItem = {
  id: string;
  companyName: string | null;
  name: string;
  kind: 'NORMAL' | 'DAILY' | string;
  caution: string | null;
  scheduleLabelColor: string | null;
  workSlipCount: number;
  latestWorkSlip: {
    id: string;
    fileName: string;
    createdAt: string;
    bizDateYmd: string | null;
    sizeBytes: number;
  } | null;
};

type WorkSlipItem = {
  id: string;
  createdAt: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  bizDateYmd: string | null;
  subject: string | null;
};

type WorkSlipSite = SiteAlertItem & {
  workSlipCount: number;
  latestWorkSlip: WorkSlipSummaryItem['latestWorkSlip'];
};

function scheduleLabelDotClass(color: string | null | undefined): string {
  const c = (color ?? 'default').toString();
  if (c === 'red') return 'bg-red-500 dark:bg-red-400';
  if (c === 'orange') return 'bg-orange-500 dark:bg-orange-400';
  if (c === 'yellow') return 'bg-yellow-400 dark:bg-yellow-300';
  if (c === 'green') return 'bg-green-500 dark:bg-green-400';
  if (c === 'blue') return 'bg-blue-500 dark:bg-blue-400';
  if (c === 'purple') return 'bg-violet-500 dark:bg-violet-400';
  if (c === 'pink') return 'bg-pink-500 dark:bg-pink-400';
  return 'bg-zinc-300 dark:bg-zinc-700';
}

function todayYmd() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return value;
  }
}

function formatYmd(value: string | null | undefined) {
  if (!value) return '日付未設定';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function alertChipClass(active: boolean, tone: 'rose' | 'amber' | 'sky' | 'emerald') {
  if (!active) return 'border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-400';
  if (tone === 'rose') return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200';
  if (tone === 'amber') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200';
  if (tone === 'sky') return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200';
}

export default function SiteWorkSlipsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const scheduleKind = useMemo(() => {
    const kindParam = (searchParams.get('kind') ?? '').trim().toLowerCase();
    return kindParam === 'daily' ? 'daily' : 'normal';
  }, [searchParams]);

  const monthParam = useMemo(() => {
    const value = (searchParams.get('month') ?? '').trim();
    return /^\d{4}-\d{2}$/.test(value) ? value : null;
  }, [searchParams]);

  const ledgerHref = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set('kind', scheduleKind);
    if (monthParam) sp.set('month', monthParam);
    return `/site-ledger?${sp.toString()}`;
  }, [monthParam, scheduleKind]);

  const [sites, setSites] = useState<WorkSlipSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [workSlipDate, setWorkSlipDate] = useState(todayYmd());
  const [workSlips, setWorkSlips] = useState<WorkSlipItem[]>([]);
  const [workSlipsBusy, setWorkSlipsBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);

  const buildSitePath = useCallback(
    (siteId: string, suffix = '', extra?: Record<string, string | null | undefined>) => {
      const sp = new URLSearchParams();
      sp.set('kind', scheduleKind);
      if (monthParam) sp.set('month', monthParam);
      if (extra) {
        for (const [key, value] of Object.entries(extra)) {
          if (!value) continue;
          sp.set(key, value);
        }
      }
      const basePath = suffix ? `/site-ledger/${encodeURIComponent(siteId)}/${suffix}` : `/site-ledger/${encodeURIComponent(siteId)}`;
      const queryString = sp.toString();
      return queryString ? `${basePath}?${queryString}` : basePath;
    },
    [monthParam, scheduleKind],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setStatusMsg(null);
    try {
      const sp = new URLSearchParams();
      sp.set('kind', scheduleKind);
      if (monthParam) sp.set('month', monthParam);
      const [siteResponse, summaryResponse] = await Promise.all([
        fetch(`/api/sites?${sp.toString()}`, { cache: 'no-store' }),
        fetch(`/api/sites/work-slips?kind=${encodeURIComponent(scheduleKind)}`, { cache: 'no-store' }),
      ]);

      const [siteJson, summaryJson] = await Promise.all([
        siteResponse.json().catch(() => null),
        summaryResponse.json().catch(() => null),
      ]);

      const siteObj = siteJson && typeof siteJson === 'object' ? (siteJson as Record<string, unknown>) : null;
      const summaryObj = summaryJson && typeof summaryJson === 'object' ? (summaryJson as Record<string, unknown>) : null;
      if (!siteResponse.ok || siteObj?.ok !== true) {
        throw new Error((siteObj?.error as string) || `HTTP ${siteResponse.status}`);
      }
      if (!summaryResponse.ok || summaryObj?.ok !== true) {
        throw new Error((summaryObj?.error as string) || `HTTP ${summaryResponse.status}`);
      }

      const rawSites = Array.isArray(siteObj?.sites) ? (siteObj.sites as unknown[]) : [];
      const rawSummaries = Array.isArray(summaryObj?.sites) ? (summaryObj.sites as unknown[]) : [];

      const summaryMap = new Map<string, WorkSlipSummaryItem>();
      for (const raw of rawSummaries) {
        const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
        if (!item || typeof item.id !== 'string') continue;
        summaryMap.set(item.id, {
          id: item.id,
          companyName: typeof item.companyName === 'string' ? item.companyName : item.companyName === null ? null : null,
          name: typeof item.name === 'string' ? item.name : '',
          kind: typeof item.kind === 'string' ? item.kind : 'NORMAL',
          caution: typeof item.caution === 'string' ? item.caution : item.caution === null ? null : null,
          scheduleLabelColor: typeof item.scheduleLabelColor === 'string' ? item.scheduleLabelColor : null,
          workSlipCount: typeof item.workSlipCount === 'number' ? item.workSlipCount : 0,
          latestWorkSlip:
            item.latestWorkSlip && typeof item.latestWorkSlip === 'object'
              ? {
                  id: typeof (item.latestWorkSlip as Record<string, unknown>).id === 'string' ? ((item.latestWorkSlip as Record<string, unknown>).id as string) : '',
                  fileName:
                    typeof (item.latestWorkSlip as Record<string, unknown>).fileName === 'string'
                      ? ((item.latestWorkSlip as Record<string, unknown>).fileName as string)
                      : '',
                  createdAt:
                    typeof (item.latestWorkSlip as Record<string, unknown>).createdAt === 'string'
                      ? ((item.latestWorkSlip as Record<string, unknown>).createdAt as string)
                      : '',
                  bizDateYmd:
                    typeof (item.latestWorkSlip as Record<string, unknown>).bizDateYmd === 'string'
                      ? ((item.latestWorkSlip as Record<string, unknown>).bizDateYmd as string)
                      : (item.latestWorkSlip as Record<string, unknown>).bizDateYmd === null
                        ? null
                        : null,
                  sizeBytes:
                    typeof (item.latestWorkSlip as Record<string, unknown>).sizeBytes === 'number'
                      ? ((item.latestWorkSlip as Record<string, unknown>).sizeBytes as number)
                      : 0,
                }
              : null,
        });
      }

      const merged = rawSites
        .map((raw) => {
          const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
          if (!item || typeof item.id !== 'string' || typeof item.name !== 'string') return null;
          const summary = summaryMap.get(item.id);
          return {
            id: item.id,
            companyName: typeof item.companyName === 'string' ? item.companyName : item.companyName === null ? null : null,
            name: item.name,
            scheduleLabelColor: typeof item.scheduleLabelColor === 'string' ? item.scheduleLabelColor : 'default',
            caution: typeof item.caution === 'string' ? item.caution : item.caution === null ? null : null,
            invoiceIssuedThisMonth: typeof item.invoiceIssuedThisMonth === 'boolean' ? item.invoiceIssuedThisMonth : undefined,
            reportIssuedThisMonth: typeof item.reportIssuedThisMonth === 'boolean' ? item.reportIssuedThisMonth : undefined,
            paceNotConsumedAlert: typeof item.paceNotConsumedAlert === 'boolean' ? item.paceNotConsumedAlert : undefined,
            unassignedThisMonth: typeof item.unassignedThisMonth === 'boolean' ? item.unassignedThisMonth : undefined,
            workSlipCount: summary?.workSlipCount ?? 0,
            latestWorkSlip: summary?.latestWorkSlip ?? null,
          } satisfies WorkSlipSite;
        })
        .filter((item): item is WorkSlipSite => !!item)
        .sort((a, b) => {
          const countDiff = b.workSlipCount - a.workSlipCount;
          if (countDiff !== 0) return countDiff;
          const latestA = a.latestWorkSlip?.createdAt ?? '';
          const latestB = b.latestWorkSlip?.createdAt ?? '';
          if (latestA !== latestB) return latestA < latestB ? 1 : -1;
          const companyA = a.companyName ?? '';
          const companyB = b.companyName ?? '';
          if (companyA !== companyB) return companyA.localeCompare(companyB, 'ja');
          return a.name.localeCompare(b.name, 'ja');
        });

      setSites(merged);
    } catch (error) {
      setSites([]);
      setStatusMsg(error instanceof Error ? `作業伝票の読込に失敗: ${error.message}` : '作業伝票の読込に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [monthParam, scheduleKind]);

  const loadWorkSlips = useCallback(async (siteId: string) => {
    setWorkSlipsBusy(true);
    try {
      const response = await fetch(`/api/sites/${encodeURIComponent(siteId)}/work-slips`, { cache: 'no-store' });
      const json = await response.json().catch(() => null);
      const obj = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
      if (!response.ok || obj?.ok !== true) {
        throw new Error((obj?.error as string) || `HTTP ${response.status}`);
      }

      const rawItems = Array.isArray(obj?.workSlips) ? (obj.workSlips as unknown[]) : [];
      const parsed = rawItems
        .map((raw) => {
          const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
          if (!item || typeof item.id !== 'string' || typeof item.fileName !== 'string') return null;
          return {
            id: item.id,
            createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
            fileName: item.fileName,
            mimeType: typeof item.mimeType === 'string' ? item.mimeType : 'application/octet-stream',
            sizeBytes: typeof item.sizeBytes === 'number' ? item.sizeBytes : 0,
            bizDateYmd: typeof item.bizDateYmd === 'string' ? item.bizDateYmd : item.bizDateYmd === null ? null : null,
            subject: typeof item.subject === 'string' ? item.subject : item.subject === null ? null : null,
          } satisfies WorkSlipItem;
        })
        .filter((item): item is WorkSlipItem => !!item);
      setWorkSlips(parsed);
    } catch (error) {
      setWorkSlips([]);
      setStatusMsg(error instanceof Error ? `作業伝票一覧の取得に失敗: ${error.message}` : '作業伝票一覧の取得に失敗しました');
    } finally {
      setWorkSlipsBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (sites.length === 0) {
      setSelectedSiteId(null);
      return;
    }
    setSelectedSiteId((current) => {
      if (current && sites.some((site) => site.id === current)) return current;
      const preferred = sites.find((site) => site.workSlipCount > 0);
      return preferred?.id ?? sites[0]?.id ?? null;
    });
  }, [sites]);

  useEffect(() => {
    if (!selectedSiteId) {
      setWorkSlips([]);
      return;
    }
    void loadWorkSlips(selectedSiteId);
  }, [loadWorkSlips, selectedSiteId]);

  const selectedSite = useMemo(
    () => sites.find((site) => site.id === selectedSiteId) ?? null,
    [selectedSiteId, sites],
  );

  const filteredSites = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sites;
    return sites.filter((site) => {
      const haystacks = [
        site.name,
        site.companyName ?? '',
        site.caution ?? '',
        site.latestWorkSlip?.fileName ?? '',
        site.latestWorkSlip?.bizDateYmd ?? '',
      ];
      return haystacks.some((value) => value.toLowerCase().includes(needle));
    });
  }, [query, sites]);

  const uploadWorkSlips = useCallback(async (filesArg?: FileList | null) => {
    if (!selectedSiteId) return;
    const files = filesArg ?? null;
    if (!files || files.length === 0) return;

    setUploadBusy(true);
    setStatusMsg(null);
    try {
      const formData = new FormData();
      formData.append('date', workSlipDate);
      Array.from(files)
        .slice(0, 20)
        .forEach((file) => formData.append('files', file));

      const response = await fetch(`/api/sites/${encodeURIComponent(selectedSiteId)}/work-slips?date=${encodeURIComponent(workSlipDate)}`, {
        method: 'POST',
        body: formData,
      });
      const json = await response.json().catch(() => null);
      const obj = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;
      if (!response.ok || obj?.ok !== true) {
        throw new Error((obj?.error as string) || `HTTP ${response.status}`);
      }

      setStatusMsg('作業伝票を追加しました');
      await Promise.all([load(), loadWorkSlips(selectedSiteId)]);
    } catch (error) {
      setStatusMsg(error instanceof Error ? `作業伝票の追加に失敗: ${error.message}` : '作業伝票の追加に失敗しました');
    } finally {
      setUploadBusy(false);
    }
  }, [load, loadWorkSlips, selectedSiteId, workSlipDate]);

  // Excelファイル拡張子用アイコン
  function excelIcon(fileName: string) {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') return '📊';
    return '📄';
  }

  return (
    <main className="mx-auto w-full max-w-screen-2xl px-4 py-4 lg:px-6">
      <div className="space-y-4">
        {/* アップロード済みExcelファイルをアイコン付きで表示 */}
        <section className="rounded-3xl border border-cyan-200 bg-gradient-to-br from-cyan-50/60 to-white/80 p-5 shadow-sm dark:border-cyan-900/70 dark:bg-gradient-to-br dark:from-cyan-900/30 dark:to-zinc-900/20">
          <div className="mb-2 text-base font-bold text-cyan-900 dark:text-cyan-200 flex items-center gap-2">
            <span className="text-xl">📑</span> アップロード済み作業伝票
          </div>
          <div className="mb-2 text-xs text-zinc-600 dark:text-zinc-300">アップロードしたExcelファイルがアイコン付きで一覧表示されます。</div>
          <div className="flex flex-wrap gap-4 mt-3">
            {workSlips.length === 0 ? (
              <div className="text-xs text-zinc-400 dark:text-zinc-600">まだファイルがありません。</div>
            ) : (
              workSlips.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => window.location.assign(`/site-ledger/work-slips/${encodeURIComponent(item.id)}`)}
                  className="group flex flex-col items-center justify-center w-36 h-36 rounded-2xl border border-zinc-200 bg-white shadow-sm hover:bg-cyan-50 dark:border-zinc-700 dark:bg-zinc-900/60 dark:hover:bg-cyan-900/30 transition cursor-pointer"
                  title={item.fileName}
                >
                  <span className="text-4xl mb-2">{excelIcon(item.fileName)}</span>
                  <span className="font-semibold text-sm text-zinc-800 dark:text-zinc-100 mb-1 text-center truncate w-full" title={item.fileName}>{item.fileName}</span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-300 text-center">{formatBytes(item.sizeBytes)}</span>
                  <span className="mt-2 text-[10px] text-cyan-600 group-hover:underline">編集</span>
                </button>
              ))
            )}
          </div>
        </section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">作業伝票</h1>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              現場単位で Excel を保管し、請求や報告の状態を見ながら関連画面へ移動できます。
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push(ledgerHref)}
            className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
          >
            現場台帳へ戻る
          </button>
        </div>

        <div className="rounded-3xl border border-cyan-200 bg-[linear-gradient(135deg,rgba(34,211,238,0.16),rgba(59,130,246,0.15),rgba(255,255,255,0.92))] p-5 shadow-sm dark:border-cyan-900/70 dark:bg-[linear-gradient(135deg,rgba(8,47,73,0.62),rgba(30,41,59,0.74),rgba(9,9,11,0.92))]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl space-y-2">
              <div className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">作業伝票を現場単位で保管</div>
              <div className="text-sm text-zinc-700 dark:text-zinc-200">
                選択した現場へ Excel を追加し、そのまま現場詳細、写真、報告書、フォルダ管理、会計へ移動できます。
              </div>
              {selectedSite ? (
                <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm dark:border-white/10 dark:bg-black/30">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`h-3 w-3 rounded-full ${scheduleLabelDotClass(selectedSite.scheduleLabelColor)}`} />
                        <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          {selectedSite.companyName ? `${selectedSite.companyName} / ${selectedSite.name}` : selectedSite.name}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        伝票 {selectedSite.workSlipCount}件
                        {selectedSite.latestWorkSlip ? ` / 最新 ${formatYmd(selectedSite.latestWorkSlip.bizDateYmd)}` : ' / まだ未登録'}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => router.push(buildSitePath(selectedSite.id))}
                        className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-black/40 dark:text-zinc-200 dark:hover:bg-zinc-900"
                      >
                        現場詳細
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push(buildSitePath(selectedSite.id, 'photos', { date: workSlipDate }))}
                        className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-black/40 dark:text-zinc-200 dark:hover:bg-zinc-900"
                      >
                        写真
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push(buildSitePath(selectedSite.id, 'reports', { date: workSlipDate }))}
                        className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-black/40 dark:text-zinc-200 dark:hover:bg-zinc-900"
                      >
                        報告書
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push(buildSitePath(selectedSite.id, 'folders'))}
                        className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-black/40 dark:text-zinc-200 dark:hover:bg-zinc-900"
                      >
                        フォルダ管理
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push('/accounting')}
                        className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-black/40 dark:text-zinc-200 dark:hover:bg-zinc-900"
                      >
                        会計
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className={`rounded-full border px-3 py-1 text-[11px] font-medium ${alertChipClass(selectedSite.invoiceIssuedThisMonth === false, 'rose')}`}>
                      {selectedSite.invoiceIssuedThisMonth === false ? '請求未' : '請求確認済'}
                    </span>
                    <span className={`rounded-full border px-3 py-1 text-[11px] font-medium ${alertChipClass(selectedSite.reportIssuedThisMonth === false, 'amber')}`}>
                      {selectedSite.reportIssuedThisMonth === false ? '報告未' : '報告確認済'}
                    </span>
                    <span className={`rounded-full border px-3 py-1 text-[11px] font-medium ${alertChipClass(selectedSite.unassignedThisMonth === true, 'sky')}`}>
                      {selectedSite.unassignedThisMonth === true ? '未配置あり' : '未配置なし'}
                    </span>
                    <span className={`rounded-full border px-3 py-1 text-[11px] font-medium ${alertChipClass(selectedSite.paceNotConsumedAlert === true, 'emerald')}`}>
                      {selectedSite.paceNotConsumedAlert === true ? 'ペース不足' : 'ペース内'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/70 px-4 py-3 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-black/20 dark:text-zinc-300">
                  現場を選択すると、このエリアから Excel 追加と関連画面への移動ができます。
                </div>
              )}
            </div>

            <div className="min-w-[280px] flex-1 rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm dark:border-white/10 dark:bg-black/30">
              <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">Excel 追加</div>
              <div className="mt-2 space-y-3">
                <label className="block text-[11px] text-zinc-600 dark:text-zinc-400">
                  伝票日
                  <input
                    type="date"
                    value={workSlipDate}
                    onChange={(event) => setWorkSlipDate(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs tabular-nums dark:border-zinc-800 dark:bg-black"
                  />
                </label>
                <button
                  type="button"
                  disabled={!selectedSiteId || uploadBusy}
                  onClick={() => uploadInputRef.current?.click()}
                  className="w-full rounded-2xl border border-sky-500 bg-sky-500 px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(14,165,233,0.2)] transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-400 dark:bg-sky-400 dark:text-slate-950 dark:hover:bg-sky-300"
                >
                  {uploadBusy ? 'アップロード中…' : 'Excel を追加'}
                </button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = event.currentTarget.files;
                    void uploadWorkSlips(files);
                    event.currentTarget.value = '';
                  }}
                />
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {selectedSite ? `${selectedSite.name} に最大20件まで一括追加できます。` : '先に現場を選択してください。'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {statusMsg ? (
          <div className="rounded-2xl border border-zinc-200 bg-white/80 px-4 py-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-black/40 dark:text-zinc-300">
            {statusMsg}
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
          <section className="rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm dark:border-zinc-800 dark:bg-black/40">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">現場一覧</div>
                <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  伝票の多い現場から並べています。検索で会社名、現場名、最新ファイル名も絞り込めます。
                </div>
              </div>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="現場名 / 会社名 / ファイル名"
                className="w-full max-w-xs rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-black"
              />
            </div>

            <div className="mt-4 space-y-2">
              {loading ? (
                <div className="text-xs text-zinc-500 dark:text-zinc-400">読み込み中…</div>
              ) : filteredSites.length === 0 ? (
                <div className="text-xs text-zinc-500 dark:text-zinc-400">該当する現場がありません。</div>
              ) : (
                filteredSites.map((site) => {
                  const selected = site.id === selectedSiteId;
                  return (
                    <button
                      key={site.id}
                      type="button"
                      onClick={() => setSelectedSiteId(site.id)}
                      className={`flex w-full items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                        selected
                          ? 'border-sky-400 bg-sky-50/70 shadow-sm dark:border-sky-500 dark:bg-sky-950/30'
                          : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-black/20 dark:hover:border-zinc-700'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`h-3 w-3 rounded-full ${scheduleLabelDotClass(site.scheduleLabelColor)}`} />
                          <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {site.companyName ? `${site.companyName} / ${site.name}` : site.name}
                          </div>
                        </div>
                        <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                          {site.latestWorkSlip
                            ? `最新 ${formatYmd(site.latestWorkSlip.bizDateYmd)} / ${site.latestWorkSlip.fileName}`
                            : '作業伝票はまだありません'}
                        </div>
                        {site.caution ? (
                          <div className="mt-2 line-clamp-2 text-[11px] text-zinc-600 dark:text-zinc-300">注意: {site.caution}</div>
                        ) : null}
                      </div>
                      <div className="shrink-0 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-right dark:border-zinc-700 dark:bg-zinc-900/70">
                        <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">slips</div>
                        <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{site.workSlipCount}</div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm dark:border-zinc-800 dark:bg-black/40">
            <div>
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">伝票一覧</div>
              <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                {selectedSite ? `${selectedSite.name} に保存された Excel 一覧です。` : '現場を選択すると一覧が表示されます。'}
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {!selectedSite ? (
                <div className="text-xs text-zinc-500 dark:text-zinc-400">現場を選択してください。</div>
              ) : workSlipsBusy ? (
                <div className="text-xs text-zinc-500 dark:text-zinc-400">読み込み中…</div>
              ) : workSlips.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-300 px-4 py-6 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  まだ作業伝票がありません。上の Excel 追加から登録できます。
                </div>
              ) : (
                workSlips.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-zinc-200 bg-white/70 px-4 py-3 dark:border-zinc-800 dark:bg-black/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100" title={item.fileName}>
                          {item.fileName}
                        </div>
                        <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                          {formatYmd(item.bizDateYmd)} / {formatDateTime(item.createdAt)} / {formatBytes(item.sizeBytes)}
                        </div>
                        {item.subject ? (
                          <div className="mt-2 text-[11px] text-zinc-600 dark:text-zinc-300">件名: {item.subject}</div>
                        ) : null}
                      </div>
                      <a
                        href={`/api/documents/${encodeURIComponent(item.id)}/download`}
                        className="shrink-0 rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-black/50 dark:text-zinc-200 dark:hover:bg-zinc-900"
                      >
                        ダウンロード
                      </a>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}