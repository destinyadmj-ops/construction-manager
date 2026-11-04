'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSchedulePermissions } from '../../user-gate';
import { gzipIfSupported } from '@/shared/gzip-client';
import type { WorkSlipBookSnapshot } from '@/shared/work-slip-book-convert';
import type { WorkSlipBookEditorHandle } from './work-slip-book-editor';

// Univer は巨大なのでブラウザでのみ遅延読み込みする
const WorkSlipBookEditor = dynamic(() => import('./work-slip-book-editor'), {
  ssr: false,
  loading: () => <div className="p-6 text-sm text-zinc-500">エディタを読み込み中…</div>,
});

type Meta = { version: number; updatedAt: string; updatedByName: string | null; source: string; sourceFileName: string | null };

const SOURCE_LABEL: Record<string, string> = { import: '共有フォルダ取込', upload: 'Excelアップロード', edit: '編集', restore: '履歴から復元' };
const btn =
  'rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800';

export default function WorkSlipBookPage() {
  const { hasScheduleEditPermission, loaded } = useSchedulePermissions();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [snapshot, setSnapshot] = useState<WorkSlipBookSnapshot | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [sharedMissing, setSharedMissing] = useState(false);
  const [versions, setVersions] = useState<number[]>([]);
  const [restoreVersion, setRestoreVersion] = useState('');
  const handleRef = useRef<WorkSlipBookEditorHandle | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, v] = await Promise.all([
        fetch('/api/work-slip-book', { cache: 'no-store' }),
        fetch('/api/work-slip-book/versions', { cache: 'no-store' }),
      ]);
      const j = (await r.json().catch(() => null)) as { ok?: boolean; meta?: Meta | null; snapshot?: WorkSlipBookSnapshot | null; error?: string } | null;
      if (!r.ok || !j?.ok) {
        setMsg(r.status === 403 ? '編集権限が必要です。' : `読み込みに失敗しました: ${j?.error ?? r.status}`);
        return;
      }
      handleRef.current = null;
      setMeta(j.meta ?? null);
      setSnapshot(j.snapshot ?? null);
      setEditorKey((k) => k + 1);
      setDirty(false);
      setConflict(false);
      const vj = (await v.json().catch(() => null)) as { versions?: number[] } | null;
      setVersions(vj?.versions ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loaded && hasScheduleEditPermission) void load();
    else if (loaded) setLoading(false);
  }, [loaded, hasScheduleEditPermission, load]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const save = useCallback(async () => {
    const data = handleRef.current?.getSnapshot();
    if (!data || !meta || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const json = new Blob([JSON.stringify({ baseVersion: meta.version, snapshot: data })], { type: 'application/json' });
      const { blob, gzipped } = await gzipIfSupported(json);
      const r = await fetch('/api/work-slip-book', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(gzipped ? { 'X-Body-Encoding': 'gzip' } : {}) },
        body: blob,
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; meta?: Meta; error?: string } | null;
      if (r.status === 409) {
        setConflict(true);
        setMsg('他の人が先に保存しました。最新を読み込み直すと、この画面の未保存の変更は破棄されます。');
        return;
      }
      if (!r.ok || !j?.ok || !j.meta) {
        setMsg(`保存に失敗しました: ${j?.error ?? (r.status === 413 ? '413 送信サイズが大きすぎます（サーバー前段の上限）' : r.status)}`);
        return;
      }
      setMeta(j.meta);
      setDirty(false);
      setVersions((prev) => [j.meta!.version, ...prev]);
      setMsg('保存しました。現場台帳・関係会社へ反映中です。');
    } finally {
      setBusy(false);
    }
  }, [busy, meta]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const post = useCallback(
    async (url: string, init: RequestInit, done: string) => {
      setBusy(true);
      setMsg(null);
      setSharedMissing(false);
      try {
        const r = await fetch(url, init);
        const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!r.ok || !j?.ok) {
          setSharedMissing(r.status === 404 && url.endsWith('/import') && !init.body);
          setMsg(`失敗しました: ${j?.error ?? (r.status === 413 ? '413 送信サイズが大きすぎます（サーバー前段の上限）' : r.status)}`);
          return;
        }
        await load();
        setMsg(done);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const confirmDiscard = () => !dirty || window.confirm('未保存の変更があります。破棄して続けますか？');

  if (loaded && !hasScheduleEditPermission) {
    return (
      <main className="mx-auto max-w-screen-md px-4 py-10 text-sm" data-testid="work-slip-book-denied">
        作業伝票ブックは編集権限を持つ方のみ開けます。
        <div className="mt-3">
          <Link href="/site-ledger" className="text-sky-600 underline">現場台帳へ戻る</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-[calc(100dvh-4rem)] w-full max-w-screen-2xl flex-col gap-2 px-4 py-3 lg:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/site-ledger" className="text-xs text-sky-600 underline">← 現場台帳</Link>
        <h1 className="text-sm font-semibold">作業伝票ブック（第32期・全体）</h1>
        {meta ? (
          <span className="text-[11px] text-zinc-500" data-testid="work-slip-book-meta">
            v{meta.version} / {new Date(meta.updatedAt).toLocaleString('ja-JP')} / {meta.updatedByName ?? '不明'} / {SOURCE_LABEL[meta.source] ?? meta.source}
            {dirty ? ' / 未保存の変更あり' : ''}
          </span>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" className={btn} disabled={!dirty || busy || !meta || conflict} onClick={() => void save()}>保存 (Ctrl+S)</button>
          <a className={`${btn} ${meta ? '' : 'pointer-events-none opacity-50'}`} href="/api/work-slip-book/download">Excelでダウンロード</a>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={async (e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (!f || !confirmDiscard()) return;
              if (meta && !window.confirm('現在のブックをこのExcelで置き換えます（履歴に残ります）。よろしいですか？')) return;
              const { blob, gzipped } = await gzipIfSupported(f);
              const fd = new FormData();
              fd.append('file', blob, f.name);
              if (gzipped) fd.append('encoding', 'gzip');
              void post('/api/work-slip-book/import', { method: 'POST', body: fd }, 'Excelで置き換えました。');
            }}
          />
          <button type="button" className={btn} disabled={busy} onClick={() => fileRef.current?.click()}>Excelで置き換え</button>
          <button
            type="button"
            className={btn}
            disabled={busy}
            onClick={() => {
              if (!confirmDiscard()) return;
              if (meta && !window.confirm('共有フォルダの作業伝票で現在のブックを置き換えます（履歴に残ります）。よろしいですか？')) return;
              void post('/api/work-slip-book/import', { method: 'POST' }, '共有フォルダの作業伝票を取り込みました。');
            }}
          >
            共有フォルダから取込
          </button>
          <select className={btn} value={restoreVersion} onChange={(e) => setRestoreVersion(e.target.value)} aria-label="履歴の版">
            <option value="">履歴…</option>
            {versions.map((v) => <option key={v} value={v}>v{v}{v === meta?.version ? '（現在）' : ''}</option>)}
          </select>
          <button
            type="button"
            className={btn}
            disabled={busy || !restoreVersion || Number(restoreVersion) === meta?.version}
            onClick={() => {
              if (!confirmDiscard() || !window.confirm(`v${restoreVersion} を新しい版として復元します。よろしいですか？`)) return;
              void post('/api/work-slip-book/versions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: Number(restoreVersion) }) }, `v${restoreVersion} を復元しました。`);
            }}
          >
            復元
          </button>
          {conflict ? (
            <button type="button" className={btn} onClick={() => void load()}>最新を読み込む</button>
          ) : null}
        </div>
      </div>
      {msg ? <div className="text-xs text-zinc-600 dark:text-zinc-300" role="status">{msg}</div> : null}
      {sharedMissing ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100" data-testid="work-slip-book-shared-missing">
          <span>このPCから共有フォルダ（\\192.168.0.210\guest\共有フォルダ）の「第32期作業伝票」を直接選んで作成できます。</span>
          <button type="button" className={btn} disabled={busy} onClick={() => fileRef.current?.click()}>
            このPCのExcelを選んで作成
          </button>
        </div>
      ) : null}
      <div className="text-[11px] text-zinc-500">
        共有フォルダは取込元（一方向）で、このブックが正本です。保存すると現場台帳・関係会社へ自動反映されます。書式（色・罫線・フォント）は取り込み時に引き継がれません。
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
        {loading ? (
          <div className="p-6 text-sm text-zinc-500">読み込み中…</div>
        ) : snapshot ? (
          <WorkSlipBookEditor
            key={editorKey}
            snapshot={snapshot}
            onDirty={() => setDirty(true)}
            onReady={(h) => {
              handleRef.current = h;
            }}
          />
        ) : (
          <div className="p-6 text-sm">
            まだブックがありません。
            <button type="button" className={`${btn} ml-2`} disabled={busy} onClick={() => void post('/api/work-slip-book/import', { method: 'POST' }, '共有フォルダの作業伝票を取り込みました。')}>
              共有フォルダの作業伝票から作成
            </button>
            <button type="button" className={`${btn} ml-2`} disabled={busy} onClick={() => fileRef.current?.click()}>
              Excelファイルを選んで作成
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
