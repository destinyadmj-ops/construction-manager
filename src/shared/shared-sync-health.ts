// 共有フォルダ同期の「止まっていないか」を判定する(web/worker 共通の純粋関数)。
export const SCHEDULE_STALE_MS = 15 * 60_000;
export const LEDGER_STALE_MS = 90 * 60_000;

export type SyncRunSnapshot = {
  at: string;
  result: 'success' | 'failed' | 'skipped';
  message?: string | null;
  lastSuccessAt?: string | null;
};

export type PollerTickSnapshot = {
  at: string;
  reason: 'enqueued' | 'no-sources' | 'previous-pending' | 'error';
  message?: string | null;
};

// warn の主因。worker/Redis が見えない(no-worker)のか、共有フォルダが見えない(folder-unreachable)のかを画面で言い分ける。
export type SharedSyncCause = 'no-worker' | 'folder-unreachable' | 'no-files' | 'pending' | 'poller-error' | 'sync-failed' | 'unknown';

export type SharedSyncHealth = { level: 'ok' | 'warn'; reasons: string[]; cause?: SharedSyncCause };

// 共有フォルダの読み取り失敗メッセージ(MASTER_HUB_SHARED_SOURCE_DIR が未設定=既定の UNC のままか、設定済みパスが見えないかで案内を変える)。
export function describeSharedFolderAccessFailure(input: { dir: string; code: string; usingDefaultDir: boolean }): string {
  const base = `共有フォルダにアクセスできません: ${input.dir} (${input.code})`;
  if (input.usingDefaultDir) {
    return `${base} / MASTER_HUB_SHARED_SOURCE_DIR が未設定で既定の UNC パスを参照しています。本番(Docker)では MASTER_HUB_SHARED_SOURCE_DIR=/shared-source と SHARED_SOURCE_HOST_PATH が必要です`;
  }
  return `${base} / 設定済みのフォルダが存在しないか権限がありません。ホストの共有フォルダが ${input.dir} にマウントされているか(SHARED_SOURCE_HOST_PATH)を確認してください`;
}

function minutesAgo(nowMs: number, iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : Math.floor((nowMs - t) / 60_000);
}

// 本番で共有フォルダの設定が無い(=既定の UNC を参照する)と同期が静かに止まるため、worker 起動時に1回だけ警告する。
export function getSharedSourceDirConfigWarning(env: { NODE_ENV?: string; MASTER_HUB_SHARED_SOURCE_DIR?: string }): string | null {
  if (env.NODE_ENV !== 'production') return null;
  if (String(env.MASTER_HUB_SHARED_SOURCE_DIR ?? '').trim()) return null;
  return 'MASTER_HUB_SHARED_SOURCE_DIR が未設定です(既定の UNC パスを参照し、本番では共有フォルダを読めません)。.env.production に MASTER_HUB_SHARED_SOURCE_DIR=/shared-source と SHARED_SOURCE_HOST_PATH を設定し、worker を再作成してください。';
}

export function evaluateSharedSyncHealth(input: {
  scope: 'schedule' | 'ledger';
  run: SyncRunSnapshot | null;
  poller: PollerTickSnapshot | null;
  nowMs: number;
  staleMs?: number;
}): SharedSyncHealth {
  const staleMs = input.staleMs ?? (input.scope === 'schedule' ? SCHEDULE_STALE_MS : LEDGER_STALE_MS);
  const { run, poller, nowMs } = input;
  const lastSuccessAt = run?.lastSuccessAt ?? (run?.result === 'success' ? run.at : null) ?? null;
  const successAgeMs = lastSuccessAt ? minutesAgo(nowMs, lastSuccessAt) * 60_000 : null;
  if (successAgeMs != null && successAgeMs <= staleMs) return { level: 'ok', reasons: [] };

  const pollerFresh = !!poller && minutesAgo(nowMs, poller.at) * 60_000 <= staleMs;
  // 起動直後など、まだ成功記録が無いだけで同期ジョブは投入済みの間は警告しない
  if (successAgeMs == null && pollerFresh && poller?.reason === 'enqueued' && run?.result !== 'failed') return { level: 'ok', reasons: [] };

  const reasons: string[] = [];
  let cause: SharedSyncCause = 'unknown';
  if (!poller) {
    cause = 'no-worker';
    reasons.push('ポーラーの記録がありません(worker が停止している、または Redis に接続できていない可能性)');
  } else if (!pollerFresh) {
    cause = 'no-worker';
    reasons.push(`ポーラーが ${minutesAgo(nowMs, poller.at)} 分間動いていません(worker 停止・Redis 未接続の可能性)`);
  } else if (poller.reason === 'no-sources') {
    // worker は動いている。共有フォルダ自体が読めないのか、フォルダは読めるがファイルが無いのかを分ける
    cause = poller.message?.includes('アクセスできません') ? 'folder-unreachable' : 'no-files';
    reasons.push(
      cause === 'folder-unreachable'
        ? `worker は動作中ですが共有フォルダが見えません: ${poller.message}`
        : `共有フォルダは読めますが同期元のファイルがありません: ${poller.message ?? '作業表☆/作業伝票なし'}`,
    );
  } else if (poller.reason === 'previous-pending') {
    cause = 'pending';
    reasons.push('前回のジョブが完了していません(滞留)');
  } else if (poller.reason === 'error') {
    cause = 'poller-error';
    reasons.push(`ポーラーでエラー: ${poller.message ?? '原因不明'}`);
  }
  if (run?.result === 'failed') {
    if (cause === 'unknown') cause = 'sync-failed';
    reasons.push(`直近の同期が失敗: ${run.message ?? '原因不明'}`);
  }
  if (run?.result === 'skipped' && run.message) reasons.push(run.message);
  if (reasons.length === 0) reasons.push('原因不明(worker のログを確認してください)');

  const since = lastSuccessAt ? `最終成功から ${minutesAgo(nowMs, lastSuccessAt)} 分経過` : '成功実績なし';
  return { level: 'warn', reasons: [since, ...reasons], cause };
}
