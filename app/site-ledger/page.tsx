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

type PhotoFolderSummary = {
  siteId: string;
  name: string;
  companyName: string | null;
  latestDate: string | null;
  photoCount: number;
};

type AuthMeUser = {
  id: string;
  canEditSchedule: boolean;
  canGrantScheduleEdit: boolean;
};

function generateDateSearchTokens(dateYmd: string | null | undefined): string[] {
  if (!dateYmd) return [];
  const match = dateYmd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return [dateYmd];
  const [, year, month, day] = match;
  const monthNum = String(Number(month));
  const dayNum = String(Number(day));
  const tokens = new Set<string>();
  const push = (value: string | null | undefined) => {
    if (value) tokens.add(value);
  };

  push(`${year}-${month}-${day}`);
  push(`${year}-${monthNum}-${dayNum}`);
  push(`${year}/${month}/${day}`);
  push(`${year}/${monthNum}/${dayNum}`);
  push(`${year}年${month}月${day}日`);
  push(`${year}年${monthNum}月${dayNum}日`);
  push(`${month}/${day}`);
  push(`${monthNum}/${dayNum}`);
  push(`${month}/${dayNum}`);
  push(`${monthNum}/${day}`);
  push(`${month}月${day}日`);
  push(`${monthNum}月${dayNum}日`);
  push(`${month}月${dayNum}日`);
  push(`${monthNum}月${day}日`);
  return Array.from(tokens);
}

function formatPhotoDateLabel(dateYmd: string | null | undefined): string {
  if (!dateYmd) return '日付未設定';
  const match = dateYmd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateYmd;
  const [, year, month, day] = match;
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function todayYmd(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function SiteLedgerPage() {
  const { setAddAction, setUndoAction, setRedoAction } = useHeaderActions();
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [authMeUser, setAuthMeUser] = useState<AuthMeUser | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sites, setSites] = useState<ApiSite[]>([]);
  const [q, setQ] = useState('');

  const [photoSites, setPhotoSites] = useState<PhotoFolderSummary[]>([]);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoStatusMsg, setPhotoStatusMsg] = useState<string | null>(null);
  const [photoQuery, setPhotoQuery] = useState('');
  const [selectedPhotoSiteId, setSelectedPhotoSiteId] = useState<string | null>(null);
  const [selectedSiteDates, setSelectedSiteDates] = useState<string[]>([]);
  const [datesLoading, setDatesLoading] = useState(false);
  const [datesError, setDatesError] = useState<string | null>(null);

  const [isImporting, setIsImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  // 削除機能関連のstate
  const [selectedSites, setSelectedSites] = useState<Set<string>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [deprMonth, setDeprMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [deprMap, setDeprMap] = useState<Record<string, DeprItem>>({});
  const [deprStatus, setDeprStatus] = useState<string | null>(null);

  const [newCompanyName, setNewCompanyName] = useState('');
  const [newName, setNewName] = useState('');
  const [newThreshold, setNewThreshold] = useState('10');
  const canEditSite = useMemo(() => !!(authMeUser?.canEditSchedule || authMeUser?.canGrantScheduleEdit), [authMeUser]);

  useEffect(() => {
    let mounted = true;
    fetch('/api/auth/me')
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as unknown;
        const o = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        if (!mounted || o?.ok !== true) return;
        const raw = o.user && typeof o.user === 'object' ? (o.user as Record<string, unknown>) : null;
        if (!raw || typeof raw.id !== 'string') {
          setAuthMeUser(null);
          return;
        }
        setAuthMeUser({
          id: raw.id,
          canEditSchedule: raw.canEditSchedule === true,
          canGrantScheduleEdit: raw.canGrantScheduleEdit === true,
        });
      })
      .catch(() => {
        if (mounted) setAuthMeUser(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

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

  const loadPhotoSites = useCallback(async () => {
    setPhotoStatusMsg(null);
    setPhotoLoading(true);
    try {
      const r = await fetch('/api/sites/photos/summary');
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) {
        throw new Error((obj?.error as string) || `HTTP ${r.status}`);
      }
      const raw = Array.isArray(obj.sites) ? (obj.sites as unknown[]) : [];
      const parsed = raw
        .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null))
        .map((o) => {
          if (!o) return null;
          const siteId = typeof o.siteId === 'string' ? o.siteId : '';
          const name = typeof o.name === 'string' ? o.name : '';
          const companyName = typeof o.companyName === 'string' ? o.companyName : o.companyName === null ? null : null;
          const latestDate = typeof o.latestDate === 'string' ? o.latestDate : null;
          const photoCount = typeof o.photoCount === 'number' ? o.photoCount : 0;
          if (!siteId || !name) return null;
          return { siteId, name, companyName, latestDate, photoCount } as PhotoFolderSummary;
        })
        .filter((x): x is PhotoFolderSummary => !!x);
      parsed.sort((a, b) => {
        if (!a.latestDate && !b.latestDate) return 0;
        if (!a.latestDate) return 1;
        if (!b.latestDate) return -1;
        return b.latestDate.localeCompare(a.latestDate);
      });
      setPhotoSites(parsed);
      setSelectedPhotoSiteId((prev) => {
        if (prev && parsed.some((item) => item.siteId === prev)) return prev;
        if (parsed.length === 0) {
          setSelectedSiteDates([]);
          return null;
        }
        return parsed[0].siteId;
      });
    } catch (e) {
      setPhotoSites([]);
      setSelectedPhotoSiteId(null);
      setSelectedSiteDates([]);
      setPhotoStatusMsg(e instanceof Error ? `写真フォルダの取得に失敗: ${e.message}` : '写真フォルダの取得に失敗しました');
    } finally {
      setPhotoLoading(false);
    }
  }, []);

  const openPhotoFolder = useCallback(
    (siteId: string, dateYmd?: string | null) => {
      const target = dateYmd ?? todayYmd();
      router.push(
        `/site-ledger/${encodeURIComponent(siteId)}/photos?date=${encodeURIComponent(target)}`,
      );
    },
    [router],
  );

  useEffect(() => {
    void loadSites();
  }, [loadSites]);
  useEffect(() => {
    void loadPhotoSites();
  }, [loadPhotoSites]);
  useEffect(() => {
    if (!selectedPhotoSiteId) {
      setSelectedSiteDates([]);
      setDatesError(null);
      setDatesLoading(false);
      return;
    }
    let canceled = false;
    setDatesLoading(true);
    setDatesError(null);
    (async () => {
      try {
        const r = await fetch(`/api/sites/${encodeURIComponent(selectedPhotoSiteId)}/folder/dates`);
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        if (!r.ok || obj?.ok !== true) {
          throw new Error((obj?.error as string) || `HTTP ${r.status}`);
        }
        const rawDates = Array.isArray(obj.dates) ? (obj.dates as unknown[]) : [];
        const parsedDates = rawDates
          .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null))
          .map((o) => (typeof o?.dateYmd === 'string' ? o.dateYmd : null))
          .filter((d): d is string => !!d);
        if (!canceled) setSelectedSiteDates(parsedDates);
      } catch (e) {
        if (!canceled) {
          setDatesError(e instanceof Error ? `日付一覧の取得に失敗: ${e.message}` : '日付一覧の取得に失敗しました');
          setSelectedSiteDates([]);
        }
      } finally {
        if (!canceled) {
          setDatesLoading(false);
        }
      }
    })();
    return () => {
      canceled = true;
    };
  }, [selectedPhotoSiteId]);

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

  useEffect(() => {
    for (const site of visibleSites.slice(0, 12)) {
      router.prefetch(`/site-ledger/${encodeURIComponent(site.id)}?month=${encodeURIComponent(deprMonth)}`);
    }
  }, [deprMonth, router, visibleSites]);

      const filteredPhotoSites = useMemo(() => {
        const needle = photoQuery.trim().toLowerCase();
        if (!needle) return photoSites;
        return photoSites.filter((site) => {
          const tokens = [site.name, site.companyName ?? '', ...generateDateSearchTokens(site.latestDate)].map((token) =>
            token.toLowerCase(),
          );
          return tokens.some((token) => token.includes(needle));
        });
      }, [photoQuery, photoSites]);

      const selectedPhotoSite = useMemo(() => {
        if (!selectedPhotoSiteId) return null;
        return photoSites.find((site) => site.siteId === selectedPhotoSiteId) ?? null;
      }, [photoSites, selectedPhotoSiteId]);

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
        const matched = typeof obj?.matched === 'number' ? (obj.matched as number) : 0;
        const updated = typeof obj?.updated === 'number' ? (obj.updated as number) : 0;
        const total = typeof obj?.total === 'number' ? (obj.total as number) : 0;
        const partnersCreated = typeof obj?.partnersCreated === 'number' ? (obj.partnersCreated as number) : 0;
        const companyBackfilled = typeof obj?.companyBackfilled === 'number' ? (obj.companyBackfilled as number) : 0;
        setImportMsg(
          `予定取り込み: 現場 ${created}件追加 / 既存 ${matched}件 / 詳細更新 ${updated}件 / 会社 ${partnersCreated}件連携 / 会社補完 ${companyBackfilled}件 / ${total}件抽出`,
        );
        await loadSites();
      } catch (e) {
        setImportMsg(e instanceof Error ? `予定取り込みに失敗: ${e.message}` : '予定取り込みに失敗しました');
      } finally {
        setIsImporting(false);
      }
    },
    [loadSites],
  );

  // 削除関連の関数
  const handleSelectSite = useCallback((siteId: string, selected: boolean) => {
    setSelectedSites(prev => {
      const next = new Set(prev);
      if (selected) {
        next.add(siteId);
      } else {
        next.delete(siteId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedSites(new Set(visibleSites.map(s => s.id)));
  }, [visibleSites]);

  const handleDeselectAll = useCallback(() => {
    setSelectedSites(new Set());
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    const idsToDelete = Array.from(selectedSites);
    if (idsToDelete.length === 0) return;

    setIsDeleting(true);
    try {
      const promises = idsToDelete.map(id =>
        fetch(`/api/sites/${id}`, { method: 'DELETE' })
      );
      const results = await Promise.allSettled(promises);
      const failed = results.filter(r => r.status === 'rejected').length;
      const succeeded = results.length - failed;

      if (failed > 0) {
        setStatusMsg(`削除に失敗: ${succeeded}件成功 / ${failed}件失敗`);
      } else {
        setStatusMsg(`${succeeded}件の現場を削除しました`);
      }

      setSelectedSites(new Set());
      setShowDeleteDialog(false);
      await loadSites();
    } catch (e) {
      setStatusMsg(e instanceof Error ? `削除に失敗: ${e.message}` : '削除に失敗しました');
    } finally {
      setIsDeleting(false);
    }
  }, [selectedSites, loadSites]);

  const handleDeleteAll = useCallback(async () => {
    const idsToDelete = visibleSites.map(s => s.id);
    if (idsToDelete.length === 0) return;

    setIsDeleting(true);
    try {
      const promises = idsToDelete.map(id =>
        fetch(`/api/sites/${id}`, { method: 'DELETE' })
      );
      const results = await Promise.allSettled(promises);
      const failed = results.filter(r => r.status === 'rejected').length;
      const succeeded = results.length - failed;

      if (failed > 0) {
        setStatusMsg(`削除に失敗: ${succeeded}件成功 / ${failed}件失敗`);
      } else {
        setStatusMsg(`${succeeded}件の現場を削除しました`);
      }

      setSelectedSites(new Set());
      setShowDeleteDialog(false);
      await loadSites();
    } catch (e) {
      setStatusMsg(e instanceof Error ? `削除に失敗: ${e.message}` : '削除に失敗しました');
    } finally {
      setIsDeleting(false);
    }
  }, [visibleSites, loadSites]);

  useEffect(() => {
    setAddAction(canEditSite ? { onClick: addSite, disabled: !newName.trim(), title: '追加（現場）' } : undefined);
    return () => {
      setAddAction(undefined);
    };
  }, [addSite, canEditSite, newName, setAddAction]);

  useEffect(() => {
    if (!canEditSite) {
      setSelectedSites(new Set());
      setShowDeleteDialog(false);
    }
  }, [canEditSite]);

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
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">現場名で検索して詳細へ移動できます。Excel 取込は請求先=会社名、件名=現場名、人数=人数欄、作業月=ペース、条件1-4/種別=詳細です。</div>
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
              {canEditSite ? (
                <button
                  type="button"
                  disabled={isImporting}
                  onClick={() => importInputRef.current?.click()}
                  className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                  title="予定表（Excel）の請求先/件名/人数/作業月/条件/種別を現場詳細へ取り込み"
                >
                  予定取り込み
                </button>
              ) : null}
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
        {!canEditSite ? (
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
            詳細の閲覧と打刻は利用できます。追加・予定取り込み・削除は編集権限保持者のみ利用できます。
          </div>
        ) : null}
        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm dark:border-zinc-800 dark:bg-black/40">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">写真フォルダ</div>
              <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                エクスプローラ風アイコンをダブルクリックで写真画面へ。現場をクリックするとアップ日一覧が表示されます。
              </div>
              <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                {photoSites.length === 0
                  ? 'まだアップ済みの写真フォルダがありません'
                  : `アップ済み現場 ${photoSites.length}件（最新 ${formatPhotoDateLabel(photoSites[0]?.latestDate)}）`}
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
              <input
                value={photoQuery}
                onChange={(e) => setPhotoQuery(e.target.value)}
                placeholder="現場名や日付（2026/03/18・2026年3月18日・3/18）"
                className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-black"
              />
              <button
                type="button"
                disabled={photoLoading}
                onClick={() => void loadPhotoSites()}
                className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
              >
                {photoLoading ? '更新中…' : '最新を読み込み'}
              </button>
            </div>
          </div>
          {photoStatusMsg ? (
            <div className="mt-2 text-[11px] text-red-600 dark:text-red-400">{photoStatusMsg}</div>
          ) : null}
          <div className="mt-4 space-y-3">
            {photoLoading ? (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">写真フォルダ一覧を読み込み中…</div>
            ) : filteredPhotoSites.length === 0 ? (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">該当する現場がありません</div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {filteredPhotoSites.map((site) => (
                  <button
                    key={`photo-site-${site.siteId}`}
                    type="button"
                    onClick={() => setSelectedPhotoSiteId(site.siteId)}
                    onDoubleClick={() => openPhotoFolder(site.siteId, site.latestDate)}
                    className={`group flex w-full items-stretch gap-3 rounded-2xl border px-3 py-3 text-left transition ${
                      selectedPhotoSiteId === site.siteId
                        ? 'border-indigo-400 bg-indigo-50/60 dark:border-indigo-500/70 dark:bg-indigo-900/40'
                        : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-black/40 dark:hover:border-zinc-600'
                    }`}
                  >
                    <div className="relative h-12 w-14 flex-shrink-0">
                      <div className="absolute left-0 top-1 h-5 w-12 rounded-t-xl bg-gradient-to-br from-amber-300 to-amber-400" />
                      <div className="absolute bottom-0 left-0 h-9 w-14 rounded-b-xl rounded-tr-xl bg-gradient-to-br from-amber-400 to-amber-500 shadow-[0_6px_10px_rgba(0,0,0,0.18)]" />
                      <div className="absolute -right-1 top-0 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-amber-600 shadow-md">
                        {site.photoCount}
                      </div>
                    </div>
                    <div className="flex flex-1 flex-col gap-0.5">
                      <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{site.name}</div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {(site.companyName ? `${site.companyName} / ` : '') + formatPhotoDateLabel(site.latestDate)}
                      </div>
                      <div className="text-[10px] text-zinc-400 dark:text-zinc-500">
                        {site.latestDate ?? '日付情報なし'}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50/60 p-3 text-[11px] dark:border-zinc-800 dark:bg-black/30">
            <div className="flex items-center justify-between">
              <div className="font-medium text-zinc-700 dark:text-zinc-300">
                {selectedPhotoSite ? `${selectedPhotoSite.name} のアップ日一覧` : '現場を選択して日付を表示'}
              </div>
              <div className="text-[10px] text-zinc-500 dark:text-zinc-400">クリックで写真画面へ</div>
            </div>
            {datesError ? <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">{datesError}</div> : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {selectedPhotoSiteId ? (
                datesLoading ? (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">読み込み中…</div>
                ) : selectedSiteDates.length === 0 ? (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">アップ済みの写真がありません</div>
                ) : (
                  selectedSiteDates.slice(0, 20).map((date) => (
                    <button
                      key={`photo-date-${date}`}
                      type="button"
                      onClick={() => openPhotoFolder(selectedPhotoSiteId, date)}
                      className="rounded-full border border-zinc-300 px-3 py-1 text-[11px] text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-200"
                    >
                      {formatPhotoDateLabel(date)}{' '}
                      <span className="text-[10px] text-zinc-400 dark:text-zinc-500">({date})</span>
                    </button>
                  ))
                )
              ) : (
                <div className="text-xs text-zinc-500 dark:text-zinc-400">現場を選択してください</div>
              )}
            </div>
          </div>
        </div>
        <h1 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">現場台帳</h1>
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {canEditSite ? '一覧/追加/編集/削除が利用できます。' : '一覧と詳細参照が利用できます。'}
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

        {canEditSite ? (
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
        ) : null}

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
            <div className="flex items-center gap-2">
              {canEditSite && visibleSites.length > 0 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="text-[10px] text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                  >
                    全選択
                  </button>
                  <span className="text-zinc-300 dark:text-zinc-600">|</span>
                  <button
                    type="button"
                    onClick={handleDeselectAll}
                    className="text-[10px] text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                  >
                    全解除
                  </button>
                </div>
              )}
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {visibleSites.length}件 {selectedSites.size > 0 && `(${selectedSites.size}選択中)`}
              </div>
            </div>
          </div>

          {visibleSites.length === 0 ? (
            <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">（データがありません）</div>
          ) : (
            <div className="mt-2 max-h-64 overflow-auto">
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-8">
                {visibleSites.map((s) => (
                  <div key={`grid-${s.id}`} className="relative">
                    {canEditSite ? (
                      <input
                        type="checkbox"
                        checked={selectedSites.has(s.id)}
                        onChange={(e) => handleSelectSite(s.id, e.target.checked)}
                        onClick={(e) => e.stopPropagation()}
                        className="absolute -left-1 -top-1 z-10 h-3 w-3 rounded border border-zinc-300 bg-white dark:border-zinc-600 dark:bg-black"
                      />
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        router.push(`/site-ledger/${encodeURIComponent(s.id)}?month=${encodeURIComponent(deprMonth)}`)
                      }
                      className="relative w-full rounded border border-zinc-200 bg-white/60 px-2 py-2 pr-10 text-[10px] text-zinc-700 dark:border-zinc-800 dark:bg-black/40 dark:text-zinc-300"
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
                  </div>
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

      {/* 右下固定の削除ボタン */}
      {canEditSite && selectedSites.size > 0 && (
        <div className="fixed bottom-4 right-4 z-50">
          <button
            type="button"
            onClick={() => setShowDeleteDialog(true)}
            className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 shadow-sm hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900"
          >
            <span>削除 ({selectedSites.size}件)</span>
          </button>
        </div>
      )}

      {/* 削除確認ダイアログ */}
      {canEditSite && showDeleteDialog && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-black">
            <div className="text-center">
              <div className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">現場削除の確認</div>
              <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                選択した現場を削除します。この操作は取り消せません。
              </div>
              <div className="mt-4 text-sm text-zinc-700 dark:text-zinc-300">
                削除対象: {selectedSites.size}件
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteDialog(false)}
                disabled={isDeleting}
                className="flex-1 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:bg-black dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={isDeleting}
                className="flex-1 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 shadow-sm hover:bg-red-100 disabled:opacity-60 dark:border-red-800 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900"
              >
                {isDeleting ? '削除中...' : '選択削除'}
              </button>
              <button
                type="button"
                onClick={handleDeleteAll}
                disabled={isDeleting}
                className="flex-1 rounded-lg border border-red-600 bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-60"
              >
                {isDeleting ? '削除中...' : '一括削除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
