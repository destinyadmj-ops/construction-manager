import { SharedSyncError, runSharedSync } from '@/server/shared-excel-sync';

// 保存のたびに台帳・関係会社へ反映する(応答は待たない)。台帳反映(ledger)だけを対象にし、週予定の同期(5分おき)とはロックを共有しない。
// ledger が実行中(BUSY)の場合は次の定期反映(30分)が反映する。
export function reflectBookToLedgerInBackground() {
  void (async () => {
    for (const kind of ['NORMAL', 'DAILY'] as const) {
      try {
        await runSharedSync({ kind, scope: 'ledger' });
      } catch (error) {
        if (error instanceof SharedSyncError && error.code === 'BUSY') return;
        console.error(`[work-slip-book] reflect failed: kind=${kind} error=${error instanceof Error ? error.message : String(error)}`);
      }
    }
  })();
}
