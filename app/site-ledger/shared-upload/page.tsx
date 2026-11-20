'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useSchedulePermissions } from '../../user-gate';

const btn =
  'rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800';

// 会社PCの自動送信が止まったときの緊急用。作業表☆(Excel)を選んで送ると、自動送信と同じ受け口に保存され、週予定へ反映される。
export default function SharedUploadPage() {
  const { hasScheduleEditPermission, loaded } = useSchedulePermissions();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMsg('ファイルを選択してください。');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/sites/shared-sync/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-file-name': encodeURIComponent(file.name),
          'x-source-mtime': String(file.lastModified || Date.now()),
        },
        body: file,
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; changed?: boolean; error?: string } | null;
      if (!r.ok || !j?.ok) {
        setMsg(`アップロードに失敗しました: ${j?.error ?? r.status}`);
        return;
      }
      const sync = await fetch('/api/sites/shared-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const sj = (await sync.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      setMsg(
        sync.ok && sj?.ok !== false
          ? `${j.changed ? '受信しました' : '内容が同じため保存は更新していません'}。週予定へ反映しました。`
          : `${j.changed ? '受信しました' : '受信済みの内容と同じです'}が、反映に失敗しました: ${sj?.error ?? sync.status}(5分以内に自動反映を再試行します)`,
      );
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      setMsg(e instanceof Error ? `アップロードに失敗しました: ${e.message}` : 'アップロードに失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">作業表☆ 手動アップロード</h1>
        <Link href="/site-ledger" className="text-xs text-sky-700 underline dark:text-sky-300">
          現場台帳へ戻る
        </Link>
      </div>
      <p className="text-xs text-zinc-600 dark:text-zinc-300">
        会社PCの自動送信が止まっているときの緊急用です。「作業表☆」で始まる Excel(.xlsx/.xls)を選んで送信すると、週予定へ反映します。元のファイルは変更されません。
      </p>
      {loaded && !hasScheduleEditPermission ? (
        <div className="text-xs text-amber-700 dark:text-amber-300">編集権限が必要です。</div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" disabled={busy || !loaded} className="text-xs" data-testid="shared-upload-file" />
          <button type="button" className={btn} disabled={busy || !loaded} onClick={() => void upload()}>
            {busy ? '送信中…' : '送信して反映'}
          </button>
        </div>
      )}
      {msg ? <div className="text-xs text-zinc-700 dark:text-zinc-200" data-testid="shared-upload-msg">{msg}</div> : null}
    </div>
  );
}
