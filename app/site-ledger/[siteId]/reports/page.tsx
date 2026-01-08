'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

type ReportItem = {
  id: string;
  createdAt: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

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

export default function SiteReportsPage() {
  const router = useRouter();
  const params = useParams<{ siteId: string }>();
  const searchParams = useSearchParams();

  const siteId = useMemo(() => (params?.siteId ?? '').trim(), [params]);

  const dateParam = useMemo(() => {
    const v = (searchParams?.get('date') ?? '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  }, [searchParams]);

  const [dateYmd, setDateYmd] = useState(() => dateParam ?? ymdInTokyo(new Date()));
  const [busy, setBusy] = useState(false);
  const [reports, setReports] = useState<ReportItem[]>([]);

  useEffect(() => {
    if (!dateParam) return;
    setDateYmd((cur) => (cur === dateParam ? cur : dateParam));
  }, [dateParam]);

  const load = useCallback(async () => {
    if (!siteId) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/sites/${encodeURIComponent(siteId)}/folder?date=${encodeURIComponent(dateYmd)}`, {
        cache: 'no-store',
      });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) {
        setReports([]);
        return;
      }
      const raw = Array.isArray(obj?.reports) ? (obj!.reports as unknown[]) : [];
      const parsed: ReportItem[] = raw
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
      setReports(parsed);
    } catch {
      setReports([]);
    } finally {
      setBusy(false);
    }
  }, [dateYmd, siteId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto w-full max-w-screen-lg px-4 py-4 lg:px-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">報告書</h1>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">現場ID: {siteId || '—'}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push(`/site-ledger/${encodeURIComponent(siteId)}`)}
              className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
            >
              現場詳細へ戻る
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={dateYmd}
            onChange={(e) => {
              const v = e.target.value;
              setDateYmd(v);
              router.replace(`/site-ledger/${encodeURIComponent(siteId)}/reports?date=${encodeURIComponent(v)}`);
            }}
            className="rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs tabular-nums dark:border-zinc-800 dark:bg-black"
          />
        </div>

        <div
          data-color-edit-slot="border"
          className="mt-4 rounded-md border border-zinc-200 bg-white/60 px-3 py-3 dark:border-zinc-800 dark:bg-black/60"
        >
          <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">一覧</div>
          <div className="mt-2">
            {busy ? (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">読み込み中…</div>
            ) : reports.length === 0 ? (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{dateYmd} の報告書はありません。</div>
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
      </div>
    </main>
  );
}
