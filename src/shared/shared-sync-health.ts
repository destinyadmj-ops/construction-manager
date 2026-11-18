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

export type SharedSyncHealth = { level: 'ok' | 'warn'; reasons: string[] };

function minutesAgo(nowMs: number, iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : Math.floor((nowMs - t) / 60_000);
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
  if (!poller) {
    reasons.push('ポーラーの記録がありません(worker が停止している可能性)');
  } else if (!pollerFresh) {
    reasons.push(`ポーラーが ${minutesAgo(nowMs, poller.at)} 分間動いていません(worker 停止・Redis 未接続の可能性)`);
  } else if (poller.reason === 'no-sources') {
    reasons.push(`同期元が見つかりません: ${poller.message ?? '共有フォルダにファイルなし/アクセス不可'}`);
  } else if (poller.reason === 'previous-pending') {
    reasons.push('前回のジョブが完了していません(滞留)');
  } else if (poller.reason === 'error') {
    reasons.push(`ポーラーでエラー: ${poller.message ?? '原因不明'}`);
  }
  if (run?.result === 'failed') reasons.push(`直近の同期が失敗: ${run.message ?? '原因不明'}`);
  if (run?.result === 'skipped' && run.message) reasons.push(run.message);
  if (reasons.length === 0) reasons.push('原因不明(worker のログを確認してください)');

  const since = lastSuccessAt ? `最終成功から ${minutesAgo(nowMs, lastSuccessAt)} 分経過` : '成功実績なし';
  return { level: 'warn', reasons: [since, ...reasons] };
}
