'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHeaderActions } from './header-actions';

import AccountingExportButton from './accounting-export-button';

type ExportFile = {
  fileName: string;
  sizeBytes: number;
  modifiedAt: string;
};

type PresetListItem = {
  key: string;
  name: string | null;
  updatedAt: string;
};

type SiteListItem = { id: string; companyName: string | null; name: string };

type PartnerListItem = { id: string; name: string; email: string | null };

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

type CsvColumnKey =
  | 'id'
  | 'date'
  | 'startAt'
  | 'endAt'
  | 'amount'
  | 'taxCategory'
  | 'summary'
  | 'department'
  | 'accountingType'
  | 'note';

const CSV_COLUMNS: Array<{ key: CsvColumnKey; label: string }> = [
  { key: 'date', label: '日付' },
  { key: 'summary', label: '摘要' },
  { key: 'amount', label: '金額' },
  { key: 'department', label: '部門' },
  { key: 'taxCategory', label: '税区分' },
  { key: 'accountingType', label: '種別' },
  { key: 'note', label: 'メモ' },
  { key: 'startAt', label: '開始' },
  { key: 'endAt', label: '終了' },
  { key: 'id', label: 'id' },
];

function asObject(v: unknown): JsonObject | null {
  return v && typeof v === 'object' ? (v as JsonObject) : null;
}

function getStringField(obj: unknown, key: string): string | null {
  const o = asObject(obj);
  const v = o?.[key];
  return typeof v === 'string' ? v : null;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0B';
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)}${units[i]}`;
}

async function downloadFromResponse(res: Response, fallbackName: string) {
  const blob = await res.blob();
  const disp = res.headers.get('content-disposition') ?? '';
  const m = disp.match(/filename\s*=\s*"([^"]+)"/i);
  const filename = m?.[1] || fallbackName;

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function AccountingTools(props: { selectedSiteLabel?: string | null }) {
  const { setAddAction, setSaveAction, setUndoAction, setRedoAction } = useHeaderActions();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedSiteLabel = props.selectedSiteLabel ?? null;
  const [effectiveSiteLabel, setEffectiveSiteLabel] = useState<string | null>(selectedSiteLabel);

  useEffect(() => {
    if (selectedSiteLabel) {
      setEffectiveSiteLabel(selectedSiteLabel);
      return;
    }
    try {
      const key = 'masterHub.lastSelectedSiteLabel';
      const v = window.localStorage.getItem(key);
      setEffectiveSiteLabel(v && v.trim().length > 0 ? v : null);
    } catch {
      setEffectiveSiteLabel(null);
    }
  }, [selectedSiteLabel]);

  const effectiveSiteLabelText = useMemo(() => {
    const v = effectiveSiteLabel?.trim() ?? '';
    return v.length > 0 ? v : '（未選択）';
  }, [effectiveSiteLabel]);

  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [mailStatusMsg, setMailStatusMsg] = useState<string | null>(null);
  const [sites, setSites] = useState<SiteListItem[]>([]);
  const [partners, setPartners] = useState<PartnerListItem[]>([]);
  const [mailLoadError, setMailLoadError] = useState<string | null>(null);
  const [mailSiteId, setMailSiteId] = useState<string>('');
  const [mailPartnerId, setMailPartnerId] = useState<string>('');
  const [mailKind, setMailKind] = useState<'report' | 'invoice'>('report');
  const [mailSending, setMailSending] = useState(false);

  const [mailLogs, setMailLogs] = useState<OutlookSendLogItem[]>([]);
  const [mailLogsError, setMailLogsError] = useState<string | null>(null);
  const [mailLogsLoading, setMailLogsLoading] = useState(false);

  const loadMailLists = useCallback(async () => {
    setMailLoadError(null);
    try {
      const [sitesRes, partnersRes] = await Promise.all([fetch('/api/sites'), fetch('/api/partners')]);
      const sitesJson = (await sitesRes.json().catch(() => null)) as unknown;
      const partnersJson = (await partnersRes.json().catch(() => null)) as unknown;
      const sitesObj = asObject(sitesJson);
      const partnersObj = asObject(partnersJson);
      if (!sitesRes.ok || sitesObj?.ok !== true) {
        throw new Error(getStringField(sitesObj, 'error') || `sites HTTP ${sitesRes.status}`);
      }
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
          if (!id || !name) return null;
          return { id, name, email } satisfies PartnerListItem;
        })
        .filter((x): x is PartnerListItem => !!x);

      setSites(parsedSites);
      setPartners(parsedPartners);

      if (!mailSiteId && parsedSites.length > 0) setMailSiteId(parsedSites[0].id);
      if (!mailPartnerId && parsedPartners.length > 0) setMailPartnerId(parsedPartners[0].id);
    } catch (e) {
      setMailLoadError(e instanceof Error ? e.message : 'DBの読み込みに失敗しました');
    }
  }, [mailPartnerId, mailSiteId]);

  useEffect(() => {
    void loadMailLists();
  }, [loadMailLists]);

  const loadMailLogs = useCallback(async () => {
    if (!mailSiteId || !mailPartnerId) {
      setMailLogs([]);
      return;
    }
    if (mailLogsLoading) return;
    setMailLogsLoading(true);
    setMailLogsError(null);
    try {
      const r = await fetch(
        `/api/outlook/send-logs?siteId=${encodeURIComponent(mailSiteId)}&partnerId=${encodeURIComponent(mailPartnerId)}&limit=20`,
      );
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = asObject(j);
      if (!r.ok || obj?.ok !== true) throw new Error(getStringField(obj, 'error') || `HTTP ${r.status}`);

      const raw = Array.isArray(obj.logs) ? obj.logs : [];
      const parsed = raw
        .map((x) => asObject(x))
        .map((o) => {
          const id = getStringField(o, 'id');
          const createdAt = getStringField(o, 'createdAt');
          const kind = getStringField(o, 'kind');
          const status = getStringField(o, 'status');
          const toEmail = getStringField(o, 'toEmail');
          const subject = getStringField(o, 'subject');
          const errorVal = o?.error;
          const error = typeof errorVal === 'string' ? errorVal : errorVal === null ? null : null;
          const siteObj = asObject(o?.site);
          const partnerObj = asObject(o?.partner);
          const siteId = getStringField(siteObj, 'id');
          const siteLabel = getStringField(siteObj, 'label');
          const partnerId = getStringField(partnerObj, 'id');
          const partnerName = getStringField(partnerObj, 'name');
          const partnerEmailVal = partnerObj?.email;
          const partnerEmail = typeof partnerEmailVal === 'string' ? partnerEmailVal : partnerEmailVal === null ? null : null;

          if (!id || !createdAt || !toEmail || !subject) return null;
          if (kind !== 'REPORT' && kind !== 'INVOICE') return null;
          if (status !== 'SENT' && status !== 'FAILED') return null;
          if (!siteId || !siteLabel || !partnerId || !partnerName) return null;

          return {
            id,
            createdAt,
            kind,
            status,
            toEmail,
            subject,
            error,
            site: { id: siteId, label: siteLabel },
            partner: { id: partnerId, name: partnerName, email: partnerEmail },
          } satisfies OutlookSendLogItem;
        })
        .filter((x): x is OutlookSendLogItem => !!x);

      setMailLogs(parsed);
    } catch (e) {
      setMailLogs([]);
      setMailLogsError(e instanceof Error ? e.message : '履歴の取得に失敗しました');
    } finally {
      setMailLogsLoading(false);
    }
  }, [mailLogsLoading, mailPartnerId, mailSiteId]);

  useEffect(() => {
    void loadMailLogs();
  }, [loadMailLogs]);

  const [exportsLoading, setExportsLoading] = useState(false);
  const [exportsError, setExportsError] = useState<string | null>(null);
  const [exportFiles, setExportFiles] = useState<ExportFile[]>([]);
  const [exportDeletingFile, setExportDeletingFile] = useState<string | null>(null);

  const [presetsLoading, setPresetsLoading] = useState(false);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [presets, setPresets] = useState<PresetListItem[]>([]);

  const [activePresetKey, setActivePresetKey] = useState<string>('default');
  const [activePresetName, setActivePresetName] = useState<string>('');
  const [activePresetBodyText, setActivePresetBodyText] = useState<string>('{}');
  const [presetSaveMsg, setPresetSaveMsg] = useState<string | null>(null);
  const [presetSaving, setPresetSaving] = useState(false);

  const [csvSelectedColumns, setCsvSelectedColumns] = useState<CsvColumnKey[]>(() =>
    CSV_COLUMNS.map((c) => c.key),
  );
  const [csvMetaKeysText, setCsvMetaKeysText] = useState<string>('');

  const csvMetaKeys = useMemo(() => {
    const raw = (csvMetaKeysText ?? '')
      .split(/[\n,]/g)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return Array.from(new Set(raw)).slice(0, 50);
  }, [csvMetaKeysText]);

  const presetJsonValid = useMemo(() => {
    try {
      JSON.parse(activePresetBodyText || '{}');
      return true;
    } catch {
      return false;
    }
  }, [activePresetBodyText]);

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

  const loadPing = useCallback(async () => {
    setStatusMsg(null);
    try {
      const r = await fetch('/api/accounting/ping');
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = asObject(j);
      if (!r.ok || obj?.ok !== true) throw new Error(getStringField(obj, 'error') || `HTTP ${r.status}`);
      setStatusMsg(`会計: provider=${getStringField(obj, 'provider') ?? 'unknown'}`);
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : 'ping failed');
    }
  }, []);

  const runSync = useCallback(async (scope: 'thisMonth' | 'lastMonth') => {
    setStatusMsg(null);
    try {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() + (scope === 'lastMonth' ? -1 : 0), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + (scope === 'lastMonth' ? 0 : 1), 1);
      const r = await fetch('/api/accounting/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ since: start.toISOString(), until: end.toISOString() }),
      });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = asObject(j);
      if (!r.ok || obj?.ok !== true) throw new Error(getStringField(obj, 'error') || `HTTP ${r.status}`);
      setStatusMsg(`sync OK: provider=${getStringField(obj, 'provider') ?? 'unknown'}`);
    } catch (e) {
      setStatusMsg(e instanceof Error ? e.message : 'sync failed');
    }
  }, []);

  const loadExports = useCallback(async () => {
    if (exportsLoading) return;
    setExportsLoading(true);
    setExportsError(null);
    try {
      const r = await fetch('/api/accounting/exports?limit=50');
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = asObject(j);
      if (!r.ok || obj?.ok !== true) throw new Error(getStringField(obj, 'error') || `HTTP ${r.status}`);

      const filesRaw = Array.isArray(obj.files) ? obj.files : [];
      const parsed = filesRaw
        .map((x) => {
          const o = asObject(x);
          const fileName = getStringField(o, 'fileName');
          const modifiedAt = getStringField(o, 'modifiedAt');
          const sizeBytes = typeof o?.sizeBytes === 'number' ? o.sizeBytes : null;
          if (!fileName || !modifiedAt || sizeBytes === null) return null;
          return { fileName, modifiedAt, sizeBytes } satisfies ExportFile;
        })
        .filter((x): x is ExportFile => !!x);
      setExportFiles(parsed);
    } catch (e) {
      setExportsError(e instanceof Error ? e.message : '一覧の取得に失敗しました');
    } finally {
      setExportsLoading(false);
    }
  }, [exportsLoading]);

  const deleteExport = useCallback(
    async (fileName: string) => {
      if (exportDeletingFile) return;
      const ok = window.confirm(`削除しますか？\n${fileName}`);
      if (!ok) return;

      setExportsError(null);
      setStatusMsg(null);
      setExportDeletingFile(fileName);
      try {
        const r = await fetch(`/api/accounting/exports/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
        const j = (await r.json().catch(() => null)) as unknown;
        const obj = asObject(j);
        if (!r.ok || obj?.ok !== true) throw new Error(getStringField(obj, 'error') || `HTTP ${r.status}`);
        setStatusMsg('削除しました');
        await loadExports();
      } catch (e) {
        setExportsError(e instanceof Error ? e.message : '削除に失敗しました');
      } finally {
        setExportDeletingFile(null);
      }
    },
    [exportDeletingFile, loadExports],
  );

  const loadPresetList = useCallback(async () => {
    if (presetsLoading) return;
    setPresetsLoading(true);
    setPresetsError(null);
    try {
      const r = await fetch('/api/accounting/export-presets');
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = asObject(j);
      if (!r.ok || obj?.ok !== true) throw new Error(getStringField(obj, 'error') || `HTTP ${r.status}`);

      const raw = Array.isArray(obj.presets) ? obj.presets : [];
      const parsed = raw
        .map((x) => {
          const o = asObject(x);
          const key = getStringField(o, 'key');
          const updatedAt = getStringField(o, 'updatedAt');
          const nameVal = o?.name;
          const name = typeof nameVal === 'string' ? nameVal : nameVal === null ? null : null;
          if (!key || !updatedAt) return null;
          return { key, updatedAt, name } satisfies PresetListItem;
        })
        .filter((x): x is PresetListItem => !!x);
      setPresets(parsed);
    } catch (e) {
      setPresetsError(e instanceof Error ? e.message : 'テンプレ一覧の取得に失敗しました');
    } finally {
      setPresetsLoading(false);
    }
  }, [presetsLoading]);

  const loadPreset = useCallback(async (key: string) => {
    setPresetSaveMsg(null);
    setActivePresetKey(key);
    try {
      const r = await fetch(`/api/accounting/export-preset?key=${encodeURIComponent(key)}`);
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = asObject(j);
      if (!r.ok || obj?.ok !== true) throw new Error(getStringField(obj, 'error') || `HTTP ${r.status}`);

      const presetObj = asObject(obj.preset);
      setActivePresetName(getStringField(presetObj, 'name') ?? '');
      setActivePresetBodyText(JSON.stringify(obj.body ?? {}, null, 2));
    } catch (e) {
      setPresetSaveMsg(e instanceof Error ? e.message : '読み込みに失敗しました');
    }
  }, []);

  const savePreset = useCallback(async () => {
    if (presetSaving) return;
    setPresetSaving(true);
    setPresetSaveMsg(null);
    try {
      let bodyObj: unknown = {};
      try {
        bodyObj = JSON.parse(activePresetBodyText || '{}');
      } catch {
        throw new Error('JSONが不正です');
      }

      const r = await fetch('/api/accounting/export-preset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: activePresetKey, name: activePresetName || null, body: bodyObj }),
      });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = asObject(j);
      if (!r.ok || obj?.ok !== true) throw new Error(getStringField(obj, 'error') || `HTTP ${r.status}`);
      setPresetSaveMsg('保存しました');
      await loadPresetList();
    } catch (e) {
      setPresetSaveMsg(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setPresetSaving(false);
    }
  }, [activePresetBodyText, activePresetKey, activePresetName, loadPresetList, presetSaving]);

  const newPresetDraft = useCallback(() => {
    const d = new Date();
    const key = `custom-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
    setPresetSaveMsg(null);
    setActivePresetKey(key);
    setActivePresetName('');
    setActivePresetBodyText('{}');
  }, []);

  useEffect(() => {
    setAddAction({ onClick: newPresetDraft, disabled: false, title: '追加（テンプレ下書き）' });
    setSaveAction({
      onClick: savePreset,
      disabled: presetSaving || !presetJsonValid,
      title: presetJsonValid ? '作業や入力（テンプレ保存）' : 'JSONが不正です（保存不可）',
    });
    return () => {
      setAddAction(undefined);
      setSaveAction(undefined);
    };
  }, [newPresetDraft, presetJsonValid, presetSaving, savePreset, setAddAction, setSaveAction]);

  const pdfLines = useMemo(() => {
    const lines: string[] = [];
    if (effectiveSiteLabel) lines.push(`現場: ${effectiveSiteLabel}`);
    return lines;
  }, [effectiveSiteLabel]);

  const downloadPdf = useCallback(
    async (kind: 'invoice' | 'report') => {
      setStatusMsg(null);
      try {
        const r = await fetch('/api/templates/pdf', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind,
            title: kind === 'report' ? '報告書' : '請求書',
            subtitle: 'Master Hub テンプレ（サンプル）',
            lines: pdfLines,
          }),
        });
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(text || `HTTP ${r.status}`);
        }
        await downloadFromResponse(r, `${kind}.pdf`);
      } catch (e) {
        setStatusMsg(e instanceof Error ? e.message : 'PDF生成に失敗しました');
      }
    },
    [pdfLines],
  );

  const smallBtn =
    'rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black';

  return (
    <div ref={rootRef} className="space-y-3">
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">現場: {effectiveSiteLabelText}</div>

      <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-black">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Outlook送信（請求書/報告書PDF）</div>
          <button type="button" className={smallBtn} onClick={() => void loadMailLists()}>
            再読込
          </button>
        </div>

        {mailLoadError ? <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{mailLoadError}</div> : null}

        <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-[140px_1fr]">
          <label className="text-[11px] text-zinc-600 dark:text-zinc-400">種類</label>
          <select
            value={mailKind}
            onChange={(e) => setMailKind(e.target.value === 'invoice' ? 'invoice' : 'report')}
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
          >
            <option value="report">報告書</option>
            <option value="invoice">請求書</option>
          </select>

          <label className="text-[11px] text-zinc-600 dark:text-zinc-400">現場</label>
          <select
            value={mailSiteId}
            onChange={(e) => setMailSiteId(e.target.value)}
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
          >
            {sites.map((s) => {
              const label = `${s.companyName ? `${s.companyName} ` : ''}${s.name}`.trim();
              return (
                <option key={s.id} value={s.id}>
                  {label}
                </option>
              );
            })}
          </select>

          <label className="text-[11px] text-zinc-600 dark:text-zinc-400">宛先（関係会社）</label>
          <select
            value={mailPartnerId}
            onChange={(e) => setMailPartnerId(e.target.value)}
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
          >
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.email ? ` <${p.email}>` : '（メール未設定）'}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            className={smallBtn}
            disabled={mailSending || !mailSiteId || !mailPartnerId}
            onClick={() => {
              void (async () => {
                if (mailSending) return;
                setMailStatusMsg(null);
                setMailSending(true);
                try {
                  const r = await fetch('/api/outlook/send-report', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ siteId: mailSiteId, partnerId: mailPartnerId, kind: mailKind }),
                  });
                  const j = (await r.json().catch(() => null)) as unknown;
                  const obj = asObject(j);
                  if (!r.ok || obj?.ok !== true) {
                    throw new Error(getStringField(obj, 'error') || `HTTP ${r.status}`);
                  }
                  setMailStatusMsg('送信しました');
                  void loadMailLogs();
                } catch (e) {
                  setMailStatusMsg(e instanceof Error ? e.message : '送信に失敗しました');
                  void loadMailLogs();
                } finally {
                  setMailSending(false);
                }
              })();
            }}
          >
            {mailSending ? '送信中…' : '送信'}
          </button>
          {mailStatusMsg ? <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{mailStatusMsg}</div> : null}
        </div>

        <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">送信履歴（選択中の現場/会社）</div>
            <button type="button" className={smallBtn} onClick={() => void loadMailLogs()} disabled={mailLogsLoading}>
              {mailLogsLoading ? '更新中…' : '更新'}
            </button>
          </div>
          {mailLogsError ? <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{mailLogsError}</div> : null}

          {mailLogs.length === 0 ? (
            <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">（履歴なし）</div>
          ) : (
            <div className="mt-2 space-y-1">
              {mailLogs.slice(0, 10).map((x) => (
                <div
                  key={x.id}
                  className="rounded-md border border-zinc-200 px-2 py-2 text-[11px] text-zinc-700 dark:border-zinc-800 dark:text-zinc-300"
                  title={x.error ?? ''}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1 truncate">
                      {x.createdAt.replace('T', ' ').replace('Z', '')}{' '}
                      <span className="ml-2 text-zinc-500 dark:text-zinc-400">
                        {x.kind === 'REPORT' ? '報告書' : '請求書'} / {x.status === 'SENT' ? '送信OK' : '失敗'}
                      </span>
                    </div>
                    <div className="truncate text-zinc-500 dark:text-zinc-400">{x.toEmail}</div>
                  </div>
                  <div className="mt-1 truncate text-zinc-500 dark:text-zinc-400">{x.subject}</div>
                  {x.status === 'FAILED' && x.error ? (
                    <div className="mt-1 truncate text-zinc-500 dark:text-zinc-400">{x.error}</div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-black">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={smallBtn} onClick={loadPing}>
            会計Ping
          </button>
          <button type="button" className={smallBtn} onClick={() => runSync('thisMonth')}>
            同期(今月)
          </button>
          <button type="button" className={smallBtn} onClick={() => runSync('lastMonth')}>
            同期(先月)
          </button>
          <button type="button" className={smallBtn} onClick={() => downloadPdf('invoice')}>
            請求書PDF
          </button>
          <button type="button" className={smallBtn} onClick={() => downloadPdf('report')}>
            報告書PDF
          </button>
        </div>
        {statusMsg ? <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{statusMsg}</div> : null}
      </div>

      <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-black">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">CSV出力（プリセット）</div>
          <div className="flex flex-wrap gap-2">
            <AccountingExportButton presetKey="expense" label="経費CSV" />
            <AccountingExportButton presetKey="labor" label="人件費CSV" />
            <AccountingExportButton presetKey="ar" label="売掛CSV" />
            <AccountingExportButton presetKey="default" label="既定CSV" />
          </div>
        </div>
      </div>

      <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-black">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">CSV出力（項目選択）</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={smallBtn}
              onClick={() => setCsvSelectedColumns(CSV_COLUMNS.map((c) => c.key))}
            >
              全選択
            </button>
            <button type="button" className={smallBtn} onClick={() => setCsvSelectedColumns([])}>
              全解除
            </button>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {CSV_COLUMNS.map((c) => {
            const checked = csvSelectedColumns.includes(c.key);
            return (
              <label
                key={c.key}
                className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 py-2 text-[11px] text-zinc-700 dark:border-zinc-800 dark:bg-black dark:text-zinc-300"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setCsvSelectedColumns((cur) =>
                      next ? Array.from(new Set([...cur, c.key])) : cur.filter((k) => k !== c.key),
                    );
                  }}
                />
                <span className="truncate">{c.label}</span>
              </label>
            );
          })}
        </div>

        <div className="mt-3">
          <div className="text-[11px] text-zinc-600 dark:text-zinc-400">追加列（accountingMeta）</div>
          <textarea
            value={csvMetaKeysText}
            onChange={(e) => setCsvMetaKeysText(e.target.value)}
            placeholder={'例: project\nclient\ninvoiceNo'}
            className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
            rows={3}
          />
          <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            出力列: {csvSelectedColumns.length || '（未選択）'} / metaKeys: {csvMetaKeys.length}
          </div>
        </div>

        <div className="mt-3">
          <AccountingExportButton
            label="CSVダウンロード（項目選択）"
            body={{
              columns: csvSelectedColumns,
              metaKeys: csvMetaKeys,
            }}
          />
        </div>
      </div>

      <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-black">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">出力一覧</div>
          <button type="button" className={smallBtn} onClick={loadExports} disabled={exportsLoading}>
            {exportsLoading ? '更新中…' : '一覧更新'}
          </button>
        </div>

        {exportsError ? <div className="mt-2 text-[11px] text-red-600 dark:text-red-400">{exportsError}</div> : null}

        {exportFiles.length === 0 ? (
          <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">（まだ出力がありません。同期を実行してください）</div>
        ) : (
          <div className="mt-2 space-y-1">
            {exportFiles.slice(0, 20).map((f) => (
              <div key={f.fileName} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 px-2 py-2 dark:border-zinc-800">
                <div className="min-w-0 flex-1 truncate text-[11px] text-zinc-700 dark:text-zinc-300" title={f.fileName}>
                  {f.fileName}
                  <span className="ml-2 text-zinc-500 dark:text-zinc-400">{formatBytes(f.sizeBytes)}</span>
                  <span className="ml-2 text-zinc-500 dark:text-zinc-400">{f.modifiedAt}</span>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    className={smallBtn}
                    href={`/api/accounting/exports/${encodeURIComponent(f.fileName)}`}
                  >
                    DL
                  </a>
                  <button
                    type="button"
                    className={smallBtn}
                    onClick={() => deleteExport(f.fileName)}
                    disabled={exportDeletingFile === f.fileName}
                  >
                    {exportDeletingFile === f.fileName ? '削除中…' : '削除'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-black">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">テンプレ（条件プリセット）</div>
          <button type="button" className={smallBtn} onClick={loadPresetList} disabled={presetsLoading}>
            {presetsLoading ? '更新中…' : '一覧更新'}
          </button>
        </div>
        {presetsError ? <div className="mt-2 text-[11px] text-red-600 dark:text-red-400">{presetsError}</div> : null}

        <div className="mt-2 flex flex-wrap gap-1">
          {presets.length === 0 ? (
            <button type="button" className={smallBtn} onClick={() => loadPreset('default')}>
              default を開く
            </button>
          ) : (
            presets.slice(0, 12).map((p) => (
              <button
                key={p.key}
                type="button"
                className={smallBtn}
                onClick={() => loadPreset(p.key)}
                aria-pressed={activePresetKey === p.key}
                title={p.name ?? p.key}
              >
                {p.key}
              </button>
            ))
          )}
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-[140px_1fr]">
          <label className="text-[11px] text-zinc-600 dark:text-zinc-400">key</label>
          <input
            value={activePresetKey}
            onChange={(e) => setActivePresetKey(e.target.value)}
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
          />

          <label className="text-[11px] text-zinc-600 dark:text-zinc-400">name</label>
          <input
            value={activePresetName}
            onChange={(e) => setActivePresetName(e.target.value)}
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
          />

          <label className="text-[11px] text-zinc-600 dark:text-zinc-400">body(JSON)</label>
          <textarea
            value={activePresetBodyText}
            onChange={(e) => setActivePresetBodyText(e.target.value)}
            rows={8}
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 font-mono text-[11px] dark:border-zinc-800 dark:bg-black"
          />
        </div>

        <div className="mt-2 flex items-center gap-2">
          <button type="button" className={smallBtn} onClick={savePreset} disabled={presetSaving || !presetJsonValid} title={!presetJsonValid ? 'JSONが不正です（保存不可）' : undefined}>
            {presetSaving ? '保存中…' : '保存'}
          </button>
          {presetSaveMsg ? <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{presetSaveMsg}</div> : null}
        </div>
      </div>
    </div>
  );
}
