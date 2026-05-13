'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

type PhotoItem = {
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

export default function SitePhotosPage() {
  const router = useRouter();
  const params = useParams<{ siteId: string }>();
  const searchParams = useSearchParams();

  const siteId = useMemo(() => (params?.siteId ?? '').trim(), [params]);
  const scheduleKind = useMemo(() => {
    const kindParam = (searchParams?.get('kind') ?? '').trim().toLowerCase();
    return kindParam === 'daily' ? 'daily' : 'normal';
  }, [searchParams]);
  const monthParam = useMemo(() => {
    const value = (searchParams?.get('month') ?? '').trim();
    return /^\d{4}-\d{2}$/.test(value) ? value : null;
  }, [searchParams]);

  const dateParam = useMemo(() => {
    const v = (searchParams?.get('date') ?? '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  }, [searchParams]);

  const detailHref = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set('kind', scheduleKind);
    if (monthParam) sp.set('month', monthParam);
    return `/site-ledger/${encodeURIComponent(siteId)}?${sp.toString()}`;
  }, [monthParam, scheduleKind, siteId]);

  const buildPhotosHref = useCallback(
    (date: string) => {
      const sp = new URLSearchParams();
      sp.set('kind', scheduleKind);
      if (monthParam) sp.set('month', monthParam);
      sp.set('date', date);
      return `/site-ledger/${encodeURIComponent(siteId)}/photos?${sp.toString()}`;
    },
    [monthParam, scheduleKind, siteId],
  );

  const [dateYmd, setDateYmd] = useState(() => dateParam ?? ymdInTokyo(new Date()));
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<FileList | null>(null);
  const [subject, setSubject] = useState('');
  const [tags, setTags] = useState('');

  useEffect(() => {
    if (!dateParam) return;
    setDateYmd((cur) => (cur === dateParam ? cur : dateParam));
  }, [dateParam]);

  const load = useCallback(async () => {
    if (!siteId) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const r = await fetch(`/api/sites/${encodeURIComponent(siteId)}/folder?date=${encodeURIComponent(dateYmd)}`, {
        cache: 'no-store',
      });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) {
        setPhotos([]);
        return;
      }
      const raw = Array.isArray(obj?.photos) ? (obj!.photos as unknown[]) : [];
      const parsed: PhotoItem[] = raw
        .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : null))
        .map((o) => {
          if (!o) return null;
          const id = typeof o.id === 'string' ? o.id : '';
          const createdAt = typeof o.createdAt === 'string' ? o.createdAt : '';
          const fileName = typeof o.fileName === 'string' ? o.fileName : '';
          const mimeType = typeof o.mimeType === 'string' ? o.mimeType : '';
          const sizeBytes = typeof o.sizeBytes === 'number' ? o.sizeBytes : 0;
          if (!id || !fileName) return null;
          return { id, createdAt, fileName, mimeType, sizeBytes } satisfies PhotoItem;
        })
        .filter((x): x is PhotoItem => !!x);
      setPhotos(parsed);
    } catch {
      setPhotos([]);
    } finally {
      setBusy(false);
    }
  }, [dateYmd, siteId]);

  const upload = useCallback(async () => {
    if (!siteId) return;
    if (!files || files.length === 0) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const fd = new FormData();
      Array.from(files)
        .slice(0, 30)
        .forEach((f) => fd.append('files', f));
      if (subject.trim()) fd.append('subject', subject.trim());
      if (tags.trim()) fd.append('tags', tags.trim());

      const r = await fetch(`/api/sites/${encodeURIComponent(siteId)}/photos?date=${encodeURIComponent(dateYmd)}`, {
        method: 'POST',
        body: fd,
      });
      const j = (await r.json().catch(() => null)) as unknown;
      const obj = j && typeof j === 'object' ? (j as Record<string, unknown>) : null;
      if (!r.ok || obj?.ok !== true) {
        throw new Error((obj?.error as string) || `HTTP ${r.status}`);
      }
      setStatusMsg('写真をアップロードしました');
      setFiles(null);
      setSubject('');
      setTags('');
      if (inputRef.current) inputRef.current.value = '';
      await load();
    } catch (e) {
      setStatusMsg(e instanceof Error ? `写真アップロードに失敗: ${e.message}` : '写真アップロードに失敗しました');
    } finally {
      setBusy(false);
    }
  }, [dateYmd, files, load, siteId, subject, tags]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="mx-auto w-full max-w-screen-lg px-4 py-4 lg:px-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">写真</h1>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">現場ID: {siteId || '—'}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push(detailHref)}
              className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black"
            >
              現場詳細へ戻る
            </button>
          </div>
        </div>

        {statusMsg ? <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{statusMsg}</div> : null}

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={dateYmd}
            onChange={(e) => {
              const v = e.target.value;
              setDateYmd(v);
              router.replace(buildPhotosHref(v));
            }}
            className="rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs tabular-nums dark:border-zinc-800 dark:bg-black"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              try {
                inputRef.current?.click();
              } catch {
                // ignore
              }
            }}
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black dark:hover:bg-zinc-900"
          >
            写真アップロード（選択）
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFiles(e.target.files)}
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
          />
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="タイトル（任意）"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
          />
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="工程・タグ（カンマ区切り可・任意）"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs dark:border-zinc-800 dark:bg-black"
          />
          <button
            type="button"
            onClick={() => void upload()}
            disabled={busy || !files || files.length === 0}
            className="rounded-md border border-zinc-200 bg-white/60 px-3 py-2 text-xs hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-black dark:hover:bg-black"
          >
            {busy ? 'アップロード中…' : 'アップロード'}
          </button>
        </div>

        <div
          data-color-edit-slot="border"
          className="mt-4 rounded-md border border-zinc-200 bg-white/60 px-3 py-3 dark:border-zinc-800 dark:bg-black/60"
        >
          <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">一覧</div>
          <div className="mt-2">
            {busy ? (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">読み込み中…</div>
            ) : photos.length === 0 ? (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{dateYmd} の写真はありません。</div>
            ) : (
              <div className="flex flex-col gap-2">
                {/* 日付ごとにグループ化 */}
                {Object.entries(
                  photos.reduce((acc, p) => {
                    const d = p.createdAt.slice(0, 10);
                    if (!acc[d]) acc[d] = [];
                    acc[d].push(p);
                    return acc;
                  }, {} as Record<string, PhotoItem[]>)
                ).map(([date, items]) => (
                  <div key={date} className="mb-2">
                    <div className="mb-1 text-xs font-bold text-zinc-700 dark:text-zinc-300">{date}</div>
                    <div className="flex flex-col gap-1">
                      {items.map((p) => (
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
