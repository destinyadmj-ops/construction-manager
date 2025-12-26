export type AccountingProviderKey = 'jdl';

export type AccountingSyncResult = {
  ok: true;
  message?: string;
  details?: Record<string, unknown>;
} | {
  ok: false;
  error: string;
};

export type WorkEntryForAccounting = {
  id: string;
  startAt: Date;
  endAt: Date | null;
  note: string | null;
  amount?: unknown;
  taxCategory?: string | null;
  summary?: string | null;
  department?: string | null;
  accountingType?: 'EXPENSE' | 'LABOR' | 'ACCOUNTS_RECEIVABLE' | null;
  accountingMeta?: unknown;
};

export type AccountingSyncOptions = {
  metaKeys?: string[];
};

export interface AccountingProvider {
  key: AccountingProviderKey;
  ping(): Promise<{ ok: true } | { ok: false; error: string }>;
  syncWorkEntries(entries: WorkEntryForAccounting[], options?: AccountingSyncOptions): Promise<AccountingSyncResult>;
}
