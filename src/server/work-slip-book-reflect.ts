import { SharedSyncError, runSharedSync } from '@/server/shared-excel-sync';
import { recordSharedSyncStatus } from '@/server/shared-sync-status';

// 保存のたびに台帳・関係会社へ反映する(応答は待たない)。台帳反映(ledger)だけを対象にし、週予定の同期(5分おき)とはロックを共有しない。
// 失敗は runSharedSync が状態へ記録する。ledger が実行中(BUSY)の場合は次の定期反映(30分)に任せ、その旨を状態とログに残す。
export function reflectBookToLedgerInBackground() {
  void (async () => {
    for (const kind of ['NORMAL', 'DAILY'] as const) {
      try {
        await runSharedSync({ kind, scope: 'ledger' });
      } catch (error) {
        if (error instanceof SharedSyncError && error.code === 'BUSY') {
          console.warn(`[work-slip-book] reflect skipped (busy): kind=${kind}`);
          await recordSharedSyncStatus('ledger', {
            kind,
            at: new Date().toISOString(),
            result: 'skipped',
            durationMs: 0,
            message: '台帳反映が実行中のため、次の周期の台帳反映(30分)に任せます',
          });
          continue;
        }
        console.error(`[work-slip-book] reflect failed: kind=${kind} error=${error instanceof Error ? error.message : String(error)}`);
      }
    }
  })();
}
