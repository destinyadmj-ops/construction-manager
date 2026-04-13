'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useHeaderActions } from '../../header-actions';
import { buildRepeatRuleWithPace, formatPaceFromMonths, formatPaceText, parseRepeatRule, type RepeatRule } from '@/shared/pace';

const DOW = ['月', '火', '水', '木', '金', '土', '日'] as const;

const SITE_LABEL_COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const;
type SiteLabelColor = (typeof SITE_LABEL_COLORS)[number];

function isSiteLabelColor(v: unknown): v is SiteLabelColor {
  return typeof v === 'string' && (SITE_LABEL_COLORS as readonly string[]).includes(v);
}

function siteLabelDotClass(color: SiteLabelColor | null | undefined): string {
  const c = color ?? 'default';
  if (c === 'default') return 'bg-zinc-300 dark:bg-zinc-700';
  switch (c) {
    case 'red':
      return 'bg-red-500 dark:bg-red-400';
    case 'orange':
      return 'bg-orange-500 dark:bg-orange-400';
    case 'yellow':
      return 'bg-yellow-400 dark:bg-yellow-300';
    case 'green':
      return 'bg-green-500 dark:bg-green-400';
    case 'blue':
      return 'bg-blue-500 dark:bg-blue-400';
    case 'purple':
      return 'bg-purple-500 dark:bg-purple-400';
    case 'pink':
      return 'bg-pink-500 dark:bg-pink-400';
    default:
      return 'bg-zinc-300 dark:bg-zinc-700';
  }
}

function ymdInTokyo(d: Date) {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function formatClockTimeTokyo(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(11, 16) || '—';
  }
  try {
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return value.slice(11, 16) || '—';
  }
}

type ApiSite = {
  id: string;
  companyName: string | null;
  name: string;
  address: string | null;
  pace: string | null;
  amount: string | number | null;
  detail: string | null;
  peopleCount: number | null;
  caution: string | null;
  scheduleLabelColor: 'default' | 'red' | string | null;
  depreciationThreshold: number;
  alertsEnabled: boolean;
  repeatRule: unknown;
  kind: 'NORMAL' | 'DAILY' | string;
  createdAt: string;
  updatedAt: string;
};

type SiteMonthAlert = {
  invoiceMissing: boolean;
  reportMissing: boolean;
  unassigned: boolean;
};

type PhotoItem = {
  id: string;
  createdAt: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  bizDateYmd: string | null;
};

type ReportItem = {
  id: string;
  createdAt: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

type TimeClockItem = {
  id: string;
  inAt: string;
  outAt: string | null;
  note: string | null;
};

type AuthMeUser = {
  id: string;
  canEditSchedule: boolean;
  canGrantScheduleEdit: boolean;
};

export default function SiteLedgerDetailPage() {
  const { setSaveAction } = useHeaderActions();
  const router = useRouter();
  const params = useParams<{ siteId: string }>();
  const searchParams = useSearchParams();

  const siteId = useMemo(() => {
    const v = (params?.siteId ?? '').trim();
    return v;
  }, [params]);

  const month = useMemo(() => {
    const m = searchParams?.get('month');
    return m && /^\d{4}-\d{2}$/.test(m) ? m : null;
  }, [searchParams]);

  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [authMeUser, setAuthMeUser] = useState<AuthMeUser | null>(null);
  const [site, setSite] = useState<ApiSite | null>(null);
  const [monthAlert, setMonthAlert] = useState<SiteMonthAlert | null>(null);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [folderDate, setFolderDate] = useState(() => ymdInTokyo(new Date()));
  const [folderBusy, setFolderBusy] = useState(false);
  const [timeClocks, setTimeClocks] = useState<TimeClockItem[]>([]);
  const [punchBusy, setPunchBusy] = useState(false);
  const [photoFiles, setPhotoFiles] = useState<FileList | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const [folderExplorerOpen, setFolderExplorerOpen] = useState(false);
  const [folderDatesBusy, setFolderDatesBusy] = useState(false);
  const [folderDates, setFolderDates] = useState<
    Array<{ dateYmd: string; photoCount: number; reportCount: number; scheduleCount: number }>
  >([]);

  const [companyName, setCompanyName] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [pace, setPace] = useState('');
  const [peopleCount, setPeopleCount] = useState('');
  const [detail, setDetail] = useState('');
  const [caution, setCaution] = useState('');
  const [scheduleLabelColor, setScheduleLabelColor] = useState<SiteLabelColor>('default');
  const [threshold, setThreshold] = useState('10');
  const [alertsEnabled, setAlertsEnabled] = useState(true);

  const [paceSettingOpen, setPaceSettingOpen] = useState(false);
  const [repeatRule, setRepeatRule] = useState<RepeatRule>({
    intervalMonths: 1,
    weekdays: [],
    monthDays: [],
    monthsOfYear: [],
  });
  const [isSavingRule, setIsSavingRule] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const canEditSite = useMemo(() => !!(authMeUser?.canEditSchedule || authMeUser?.canGrantScheduleEdit), [authMeUser]);
  const canSave = useMemo(() => canEditSite && name.trim().length > 0 && !!siteId, [canEditSite, name, siteId]);

  const updatePace = useCallback((nextValue: string) => {
    setPace(nextValue);
    setRepeatRule((current) => ({
      ...current,
      monthsOfYear: buildRepeatRuleWithPace(current, nextValue).monthsOfYear,
    }));
  }, []);

  const commitPaceFormat = useCallback(() => {
    const formatted = formatPaceText(pace);
    setPace(formatted);
    setRepeatRule((current) => ({
      ...current,
      monthsOfYear: buildRepeatRuleWithPace(current, formatted).monthsOfYear,
    }));
  }, [pace]);

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

  const load = useCallback(async () => {
    if (!siteId) return;
    setStatusMsg(null);
    setLoading(true);
    try {
      const r = await fetch(`/api/sites/${encodeURIComponent(siteId)}`);
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) {
        throw new Error((obj?.error as string) || `HTTP ${r.status}`);
      }
      const raw = obj?.site && typeof obj.site === 'object' ? (obj.site as Record<string, unknown>) : null;
      const parsed: ApiSite | null = raw
        ? {
            id: typeof raw.id === 'string' ? raw.id : siteId,
            companyName:
              typeof raw.companyName === 'string' ? raw.companyName : raw.companyName === null ? null : null,
            name: typeof raw.name === 'string' ? raw.name : '',
            address: typeof raw.address === 'string' ? raw.address : raw.address === null ? null : null,
            pace: typeof raw.pace === 'string' ? raw.pace : raw.pace === null ? null : null,
            amount:
              typeof raw.amount === 'string'
                ? raw.amount
                : typeof raw.amount === 'number'
                  ? raw.amount
                  : raw.amount === null
                    ? null
                    : null,
            detail: typeof raw.detail === 'string' ? raw.detail : raw.detail === null ? null : null,
            peopleCount: typeof raw.peopleCount === 'number' ? raw.peopleCount : raw.peopleCount === null ? null : null,
            caution: typeof raw.caution === 'string' ? raw.caution : raw.caution === null ? null : null,
            scheduleLabelColor:
              typeof raw.scheduleLabelColor === 'string'
                ? raw.scheduleLabelColor
                : raw.scheduleLabelColor === null
                  ? null
                  : null,
            depreciationThreshold: typeof raw.depreciationThreshold === 'number' ? raw.depreciationThreshold : 10,
            alertsEnabled: typeof raw.alertsEnabled === 'boolean' ? raw.alertsEnabled : true,
            repeatRule: raw.repeatRule,
            kind: typeof raw.kind === 'string' ? raw.kind : 'NORMAL',
            createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
            updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
          }
        : null;

      if (!parsed || !parsed.name) {
        throw new Error('Not found');
      }

      const parsedRule = parseRepeatRule(parsed.repeatRule);
      const formattedPace = formatPaceText(parsed.pace ?? formatPaceFromMonths(parsedRule.monthsOfYear));

      setSite(parsed);
      setCompanyName(parsed.companyName ?? '');
      setName(parsed.name);
      setAddress(parsed.address ?? '');
      setAmount(parsed.amount === null || parsed.amount === undefined ? '' : String(parsed.amount));
      setPace(formattedPace);
      setPeopleCount(parsed.peopleCount === null || parsed.peopleCount === undefined ? '' : String(parsed.peopleCount));
      setDetail(parsed.detail ?? '');
      setCaution(parsed.caution ?? '');
      setScheduleLabelColor(isSiteLabelColor(parsed.scheduleLabelColor) ? parsed.scheduleLabelColor : 'default');
      setThreshold(String(parsed.depreciationThreshold ?? 10));
      setAlertsEnabled(!!parsed.alertsEnabled);

      setRepeatRule(parsedRule);
    } catch (e) {
      setSite(null);
      setStatusMsg(e instanceof Error ? `読み込みに失敗: ${e.message}` : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [siteId]);
  const loadFolder = useCallback(async () => {
    if (!siteId) return;
    setFolderBusy(true);
    try {
      const r = await fetch(
        `/api/sites/${encodeURIComponent(siteId)}/folder?date=${encodeURIComponent(folderDate)}`,
        { cache: 'no-store' },
      );
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) {
        setPhotos([]);
        setReports([]);
        return;
      }

      const rawPhotos = Array.isArray(obj?.photos) ? (obj!.photos as unknown[]) : [];
      const parsedPhotos: PhotoItem[] = rawPhotos
        .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null))
        .map((o) => {
          if (!o) return null;
          const id = typeof o.id === 'string' ? o.id : '';
          const createdAt = typeof o.createdAt === 'string' ? o.createdAt : '';
          const fileName = typeof o.fileName === 'string' ? o.fileName : '';
          const mimeType = typeof o.mimeType === 'string' ? o.mimeType : '';
          const sizeBytes = typeof o.sizeBytes === 'number' ? o.sizeBytes : 0;
          if (!id || !fileName) return null;
          return { id, createdAt, fileName, mimeType, sizeBytes, bizDateYmd: folderDate } satisfies PhotoItem;
        })
        .filter((x): x is PhotoItem & { bizDateYmd: string } => !!x);

      const rawReports = Array.isArray(obj?.reports) ? (obj!.reports as unknown[]) : [];
      const parsedReports: ReportItem[] = rawReports
        .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null))
        .map((o) => {
          if (!o) return null;
          const id = typeof o.id === 'string' ? o.id : '';
          const createdAt = typeof o.createdAt === 'string' ? o.createdAt : '';
          const fileName = typeof o.fileName === 'string' ? o.fileName : '';
          const mimeType = typeof o.mimeType === 'string' ? o.mimeType : '';
          const sizeBytes = typeof o.sizeBytes === 'number' ? o.sizeBytes : 0;
          if (!id || !fileName) return null;
          return { id, createdAt, fileName, mimeType, sizeBytes } satisfies ReportItem;
        })
        .filter((x): x is ReportItem => !!x);

      setPhotos(parsedPhotos);
      setReports(parsedReports);
    } catch {
      setPhotos([]);
      setReports([]);
    } finally {
      setFolderBusy(false);
    }
  }, [folderDate, siteId]);

  const loadTimeClocks = useCallback(async () => {
    if (!siteId) return;
    try {
      const r = await fetch(
        `/api/time-clocks?siteId=${encodeURIComponent(siteId)}&date=${encodeURIComponent(folderDate)}`,
        { cache: 'no-store' },
      );
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) {
        setTimeClocks([]);
        return;
      }
      const items = Array.isArray(obj?.items) ? (obj!.items as unknown[]) : [];
      const parsed: TimeClockItem[] = items
        .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null))
        .map((o) => {
          if (!o) return null;
          const id = typeof o.id === 'string' ? o.id : '';
          const inAt = typeof o.inAt === 'string' ? o.inAt : '';
          const outAt = typeof o.outAt === 'string' ? o.outAt : o.outAt === null ? null : null;
          const note = typeof o.note === 'string' ? o.note : o.note === null ? null : null;
          if (!id || !inAt) return null;
          return { id, inAt, outAt, note } satisfies TimeClockItem;
        })
        .filter((x): x is TimeClockItem => !!x);
      setTimeClocks(parsed);
    } catch {
      setTimeClocks([]);
    }
  }, [folderDate, siteId]);
  const uploadPhotos = useCallback(async (filesArg?: FileList | null) => {
    if (!siteId) return;
    const files = filesArg ?? photoFiles;
    if (!files || files.length === 0) return;
    setPhotoBusy(true);
    setStatusMsg(null);
    try {
      const fd = new FormData();
      Array.from(files)
        .slice(0, 30)
        .forEach((f) => fd.append('files', f));
      const r = await fetch(`/api/sites/${encodeURIComponent(siteId)}/photos?date=${encodeURIComponent(folderDate)}`,
        {
        method: 'POST',
        body: fd,
      });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) {
        throw new Error((obj?.error as string) || `HTTP ${r.status}`);
      }
      setStatusMsg('写真をアップロードしました');
      setPhotoFiles(null);
      await loadFolder();
    } catch (e) {
      setStatusMsg(e instanceof Error ? `写真アップロードに失敗: ${e.message}` : '写真アップロードに失敗しました');
    } finally {
      setPhotoBusy(false);
    }
  }, [folderDate, loadFolder, photoFiles, siteId]);

  const loadFolderDates = useCallback(async () => {
    if (!siteId) return;
    setFolderDatesBusy(true);
    try {
      const r = await fetch(`/api/sites/${encodeURIComponent(siteId)}/folder/dates?scope=history`, {
        cache: 'no-store',
      });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) {
        setFolderDates([]);
        return;
      }
      const raw = Array.isArray(obj?.dates) ? (obj!.dates as unknown[]) : [];
      const parsed = raw
        .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null))
        .map((o) => {
          if (!o) return null;
          const dateYmd = typeof o.dateYmd === 'string' ? o.dateYmd : '';
          const photoCount = typeof o.photoCount === 'number' ? o.photoCount : 0;
          const reportCount = typeof o.reportCount === 'number' ? o.reportCount : 0;
          const scheduleCount = typeof o.scheduleCount === 'number' ? o.scheduleCount : 0;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return null;
          return { dateYmd, photoCount, reportCount, scheduleCount };
        })
        .filter((x): x is { dateYmd: string; photoCount: number; reportCount: number; scheduleCount: number } => !!x)
        .slice(0, 120);
      setFolderDates(parsed);
    } catch {
      setFolderDates([]);
    } finally {
      setFolderDatesBusy(false);
    }
  }, [siteId]);

  const punch = useCallback(
    async (action: 'IN' | 'OUT') => {
      if (!siteId) return;
      setPunchBusy(true);
      setStatusMsg(null);
      try {
        const r = await fetch('/api/time-clocks/punch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, siteId }),
        });
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        if (!r.ok || obj?.ok !== true) {
          throw new Error((obj?.error as string) || `HTTP ${r.status}`);
        }
        setStatusMsg(action === 'IN' ? '入を打刻しました' : '出を打刻しました');
        await loadTimeClocks();
      } catch (e) {
        setStatusMsg(e instanceof Error ? `打刻に失敗: ${e.message}` : '打刻に失敗しました');
      } finally {
        setPunchBusy(false);
      }
    },
    [loadTimeClocks, siteId],
  );

  const save = useCallback(async () => {
    if (!siteId) return;
    const nm = name.trim();
    if (!nm) return;
    const normalizedPace = formatPaceText(pace);
    const nextRepeatRule = buildRepeatRuleWithPace(repeatRule, normalizedPace);

    setStatusMsg(null);
    try {
      const th = Number(threshold);
      const r = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: siteId,
          name: nm,
          companyName: companyName.trim() || null,
          address: address.trim() || null,
          pace: normalizedPace || null,
          amount: amount.trim() || null,
          peopleCount: (() => {
            const v = peopleCount.trim();
            if (!v) return null;
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
          })(),
          detail: detail.trim() || null,
          caution: caution.trim() || null,
          scheduleLabelColor,
          depreciationThreshold: Number.isFinite(th) ? th : undefined,
          alertsEnabled: !!alertsEnabled,
          repeatRule: nextRepeatRule,
        }),
      });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) {
        throw new Error((obj?.error as string) || `HTTP ${r.status}`);
      }
      setPace(normalizedPace);
      setStatusMsg('保存しました');
      await load();
    } catch (e) {
      setStatusMsg(e instanceof Error ? `保存に失敗: ${e.message}` : '保存に失敗しました');
    }
  }, [address, alertsEnabled, amount, caution, companyName, detail, load, name, pace, peopleCount, repeatRule, scheduleLabelColor, siteId, threshold]);

  const remove = useCallback(async () => {
    if (!siteId || !site) return;
    const ok = window.confirm(`削除しますか？\n${(site.companyName ? `${site.companyName} / ` : '') + site.name}`);
    if (!ok) return;

    setStatusMsg(null);
    try {
      const r = await fetch(`/api/sites/${encodeURIComponent(siteId)}`, { method: 'DELETE' });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) {
        throw new Error((obj?.error as string) || `HTTP ${r.status}`);
      }
      router.push('/site-ledger');
    } catch (e) {
      setStatusMsg(e instanceof Error ? `削除に失敗: ${e.message}` : '削除に失敗しました');
    }
  }, [router, site, siteId]);

  const saveRepeatRule = useCallback(async () => {
    if (!siteId) return;
    const normalizedPace = formatPaceText(pace);
    const nextRepeatRule = buildRepeatRuleWithPace(repeatRule, normalizedPace);
    setIsSavingRule(true);
    setStatusMsg(null);
    try {
      const r = await fetch('/api/sites/repeat-rule', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteId, pace: normalizedPace || null, repeatRule: nextRepeatRule }),
      });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) {
        throw new Error((obj?.error as string) || `HTTP ${r.status}`);
      }
      setPace(normalizedPace);
      setStatusMsg('ペース（リピート）を保存しました');
      await load();
    } catch (e) {
      setStatusMsg(e instanceof Error ? `保存に失敗: ${e.message}` : '保存に失敗しました');
    } finally {
      setIsSavingRule(false);
    }
  }, [load, pace, repeatRule, siteId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadFolder();
    void loadTimeClocks();
  }, [loadFolder, loadTimeClocks]);

  useEffect(() => {
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    );
    setIsMobile(isMobileDevice);
  }, []);

  useEffect(() => {
    const m = month;
    if (!m || !siteId) {
      setMonthAlert(null);
      return;
    }
    let canceled = false;
    async function run(monthStr: string) {
      try {
        const r = await fetch(`/api/sites?month=${encodeURIComponent(monthStr)}`, { cache: 'no-store' });
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
        if (!r.ok || obj?.ok !== true) {
          if (!canceled) setMonthAlert(null);
          return;
        }
        const sites = Array.isArray(obj.sites) ? (obj.sites as Array<Record<string, unknown>>) : [];
        const found = sites.find((x) => x?.id === siteId);
        if (!canceled) {
          setMonthAlert(
            found
              ? {
                  invoiceMissing: found.invoiceIssuedThisMonth === false,
                  reportMissing: found.reportIssuedThisMonth === false,
                  unassigned: found.unassignedThisMonth === true,
                }
              : null,
          );
        }
      } catch {
        if (!canceled) setMonthAlert(null);
      }
    }
    void run(m);
    return () => {
      canceled = true;
    };
  }, [month, siteId]);

  useEffect(() => {
    setSaveAction(canEditSite ? { onClick: save, disabled: !canSave, title: '現場詳細を保存' } : undefined);
    return () => setSaveAction(undefined);
  }, [canEditSite, canSave, save, setSaveAction]);

  return (
    <main className="mx-auto w-full max-w-screen-lg px-4 py-4 lg:px-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {canEditSite ? '現場詳細（編集）' : '現場詳細'}
              </h1>
              {monthAlert ? (
                <div className="flex items-center gap-1">
                  {monthAlert.invoiceMissing ? (
                    <span className="h-2 w-2 rounded-full bg-red-500" title="請求書未発行（当月）" />
                  ) : null}
                  {monthAlert.reportMissing ? (
                    <span className="h-2 w-2 rounded-full bg-yellow-500" title="報告書未発行（当月）" />
                  ) : null}
                  {monthAlert.unassigned ? (
                    <span className="h-2 w-2 rounded-full bg-green-500" title="当月 現場未配置" />
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">ID: {siteId || '—'}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push('/site-ledger')}
              className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
            >
              一覧へ戻る
            </button>
            {canEditSite ? (
              <button
                type="button"
                onClick={() => void save()}
                disabled={!canSave}
                className="mh-btn-primary"
              >
                保存
              </button>
            ) : null}
          </div>
        </div>

        {!canEditSite ? (
          <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
            金額は編集権限保持者のみに表示されます。編集・削除・写真アップロードは編集権限保持者のみ利用できます。
          </div>
        ) : null}

        {statusMsg ? <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{statusMsg}</div> : null}
        {loading ? <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">読み込み中…</div> : null}

        <div className="mt-4 space-y-2">
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            readOnly={!canEditSite}
            placeholder="会社名（任意）"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
          />
          <div className="flex items-stretch gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              readOnly={!canEditSite}
              placeholder="現場名"
              className="flex-1 rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
            />
            <div className="flex shrink-0 items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${siteLabelDotClass(scheduleLabelColor)}`} aria-hidden />
              <select
                value={scheduleLabelColor}
                onChange={(e) => setScheduleLabelColor(isSiteLabelColor(e.target.value) ? e.target.value : 'default')}
                disabled={!canEditSite}
                className="rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
              >
                <option value="default">通常</option>
                <option value="red">赤</option>
                <option value="orange">橙</option>
                <option value="yellow">黄</option>
                <option value="green">緑</option>
                <option value="blue">青</option>
                <option value="purple">紫</option>
                <option value="pink">桃</option>
              </select>
            </div>
          </div>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            readOnly={!canEditSite}
            placeholder="現場住所"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {canEditSite && !isMobile ? (
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="金額"
                inputMode="numeric"
                className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
              />
            ) : null}
          </div>

          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/40">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">ペース設定（リピート）</div>
                <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  月スパン/曜日/日付を指定して、当月の未消化判定に使います。
                </div>
                {pace ? (
                  <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">月指定: {formatPaceText(pace)}</div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setPaceSettingOpen((v) => !v)}
                className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
              >
                {paceSettingOpen ? '閉じる' : 'ペースボタン'}
              </button>
            </div>

            {paceSettingOpen ? (
              <div className="mt-3 space-y-3">
                <div>
                  <div className="text-xs text-zinc-600 dark:text-zinc-400">月スパン（1〜12ヶ月）</div>
                  <select
                    value={repeatRule.intervalMonths}
                    onChange={(e) => setRepeatRule((r) => ({ ...r, intervalMonths: Number(e.target.value) || 1 }))}
                    disabled={!siteId || !canEditSite}
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
                  <div className="text-xs text-zinc-600 dark:text-zinc-400">ペース（月指定）</div>
                  <input
                    value={pace}
                    onChange={(e) => updatePace(e.target.value)}
                    onBlur={commitPaceFormat}
                    readOnly={!canEditSite}
                    placeholder="1月、3月、5月 / 毎月"
                    className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
                  />
                  <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    1,3,5 のような入力でも保存時に 1月、3月、5月 へ整形します。
                  </div>
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
                          disabled={!canEditSite}
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
                          disabled={!canEditSite}
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
                  disabled={!siteId || isSavingRule || !canEditSite}
                  onClick={() => void saveRepeatRule()}
                  className="w-full rounded-lg border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
                >
                  {isSavingRule ? '保存中…' : 'リピートを保存'}
                </button>
              </div>
            ) : null}
          </div>
          <input
            value={peopleCount}
            onChange={(e) => setPeopleCount(e.target.value)}
            readOnly={!canEditSite}
            placeholder="人数"
            inputMode="numeric"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
          />
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            readOnly={!canEditSite}
            placeholder="詳細"
            rows={4}
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
          />
          <textarea
            value={caution}
            onChange={(e) => setCaution(e.target.value)}
            readOnly={!canEditSite}
            placeholder="注意事項"
            rows={4}
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
          />

          <input
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            readOnly={!canEditSite}
            placeholder="月回数"
            inputMode="numeric"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
          />

          <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={alertsEnabled}
              onChange={(e) => setAlertsEnabled(e.target.checked)}
              disabled={!canEditSite}
              className="h-4 w-4"
            />
            アラートを有効にする（OFFで意図しないアラートを抑制）
          </label>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => void remove()}
              disabled={!site || !canEditSite}
              className="mh-btn-danger"
            >
              削除
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">過去（予定 / 報告書 / 写真）</div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              予定セル入力・報告書・写真アップロードで作られた日付を一覧できます。
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={folderDate}
              onChange={(e) => setFolderDate(e.target.value)}
              className="rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs tabular-nums dark:border-zinc-800 dark:bg-black"
            />
            <button
              type="button"
              onClick={() => {
                const next = !folderExplorerOpen;
                setFolderExplorerOpen(next);
                if (next) void loadFolderDates();
              }}
              className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
              title="過去データを表示"
            >
              過去
            </button>
          </div>
        </div>

        {folderExplorerOpen ? (
          <div className="mt-3 rounded-md bg-zinc-50 px-3 py-3 dark:bg-zinc-900/40">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">過去一覧</div>
              <button
                type="button"
                onClick={() => void loadFolderDates()}
                disabled={folderDatesBusy}
                className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
              >
                更新
              </button>
            </div>

            <div className="mt-2">
              {folderDatesBusy ? (
                <div className="text-xs text-zinc-500 dark:text-zinc-400">読み込み中…</div>
              ) : folderDates.length === 0 ? (
                <div className="text-xs text-zinc-500 dark:text-zinc-400">過去の日付データがありません。</div>
              ) : (
                <div className="flex flex-col gap-1">
                  {folderDates.map((d) => (
                    <div
                      key={d.dateYmd}
                      data-color-edit-slot="border"
                      className="group flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white/60 px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black/60"
                      title="カーソルを合わせるとメニューが出ます"
                    >
                      <div className="min-w-0 flex-1 truncate tabular-nums">
                        {d.dateYmd}（予定 {d.scheduleCount} / 写真 {d.photoCount} / 報告書 {d.reportCount}）
                      </div>
                      <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
                        <button
                          type="button"
                          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                          onClick={() => setFolderDate(d.dateYmd)}
                        >
                          当日
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                          onClick={() =>
                            router.push(
                              `/site-ledger/${encodeURIComponent(siteId)}/photos?date=${encodeURIComponent(d.dateYmd)}`,
                            )
                          }
                        >
                          写真
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                          onClick={() =>
                            router.push(
                              `/site-ledger/${encodeURIComponent(siteId)}/reports?date=${encodeURIComponent(d.dateYmd)}`,
                            )
                          }
                        >
                          報告書
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div
          id="punch"
          data-color-edit-slot="border"
          className="mt-3 scroll-mt-20 rounded-md border border-zinc-200 bg-white/60 px-3 py-3 dark:border-zinc-800 dark:bg-black/60"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">打刻（入 / 出）</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={punchBusy || !siteId}
                onClick={() => void punch('IN')}
                className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
              >
                入
              </button>
              <button
                type="button"
                disabled={punchBusy || !siteId}
                onClick={() => void punch('OUT')}
                className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
              >
                出
              </button>
            </div>
          </div>

          <div className="mt-2">
            {timeClocks.length === 0 ? (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{folderDate} の打刻はありません。</div>
            ) : (
              <div className="flex flex-col gap-1">
                {timeClocks.map((t) => (
                  <div
                    key={t.id}
                    data-color-edit-slot="border"
                    className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white/60 px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black/60"
                  >
                    <div className="min-w-0 flex-1 truncate">
                      入: {formatClockTimeTokyo(t.inAt)} / 出: {formatClockTimeTokyo(t.outAt)}
                      {t.note ? ` / ${t.note}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div
          data-color-edit-slot="border"
          className="mt-3 rounded-md border border-zinc-200 bg-white/60 px-3 py-3 dark:border-zinc-800 dark:bg-black/60"
        >
          <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">報告書</div>
          <div className="mt-2">
            {reports.length === 0 ? (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{folderDate} の報告書はありません。</div>
            ) : (
              <div className="flex flex-col gap-1">
                {reports.map((p) => (
                  <div
                    key={p.id}
                    data-color-edit-slot="border"
                    className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white/60 px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black/60"
                  >
                    <div className="min-w-0 flex-1 truncate" title={p.fileName}>
                      {p.fileName}
                    </div>
                    <a
                      href={`/api/documents/${encodeURIComponent(p.id)}/download`}
                      className="shrink-0 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                    >
                      ダウンロード
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {canEditSite ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-blue-500 bg-blue-500 px-3 py-2 text-xs text-white hover:bg-blue-600"
              onClick={() => router.push(`/site-ledger/${encodeURIComponent(siteId)}/folders`)}
            >
              フォルダ管理
            </button>
          </div>
        ) : null}

        <div
          id="photos"
          data-color-edit-slot="border"
          className="mt-3 scroll-mt-20 rounded-md border border-zinc-200 bg-white/60 px-3 py-3 dark:border-zinc-800 dark:bg-black/60"
        >
          <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">写真</div>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">複数ファイルを一括アップロードできます。</div>
          <div className="mt-3 flex flex-col gap-2">
            <button
              type="button"
              disabled={!canEditSite || photoBusy || !siteId}
              onClick={() => {
                try {
                  photoInputRef.current?.click();
                } catch {
                  // ignore
                }
              }}
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
            >
              {photoBusy ? 'アップロード中…' : '写真アップロード'}
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              multiple
              disabled={!canEditSite}
              onChange={(e) => {
                const files = e.target.files;
                setPhotoFiles(files);
                void uploadPhotos(files);
                e.currentTarget.value = '';
              }}
              className="hidden"
            />
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {canEditSite ? 'ファイルを選択すると自動でアップロードします。' : '写真アップロードは編集権限保持者のみ利用できます。'}
            </div>
          </div>
          <div className="mt-3">
            {folderBusy ? (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">読み込み中…</div>
            ) : photos.length === 0 ? (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{folderDate} の写真はありません。</div>
            ) : (
              <div className="flex flex-col gap-1">
                {photos.map((p) => (
                  <div
                    key={p.id}
                    data-color-edit-slot="border"
                    className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white/60 px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black/60"
                  >
                    <div className="min-w-0 flex-1 truncate" title={p.fileName}>
                      {p.fileName}
                    </div>
                    <a
                      href={`/api/documents/${encodeURIComponent(p.id)}/download`}
                      className="shrink-0 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] hover:bg-zinc-50 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
                    >
                      ダウンロード
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
