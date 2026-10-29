// 現場台帳・関係会社の引用元にする作業伝票のタブ(当該月 + 作業伝票オリジナル)を解決する。

export const WORK_SLIP_ORIGINAL_TAB = '作業伝票オリジナル';

function normalizeSheetName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, '');
}

export function workSlipMonthTabName(year: number, month: number): string {
  return `作業伝票${year}年${month}月`;
}

export type WorkSlipLedgerSheets = {
  /** 当該月(YYYY-MM) */
  targetYm: string;
  /** 実際のシート名(ブック上の表記)。見つからなければ null */
  monthSheet: string | null;
  originalSheet: string | null;
  warnings: string[];
};

export function resolveWorkSlipLedgerSheets(sheetNames: string[], asOfYmd: string): WorkSlipLedgerSheets {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(asOfYmd);
  if (!match) throw new Error(`asOfYmd must be YYYY-MM-DD: ${asOfYmd}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const wantMonth = normalizeSheetName(workSlipMonthTabName(year, month));
  const wantOriginal = normalizeSheetName(WORK_SLIP_ORIGINAL_TAB);

  let monthSheet: string | null = null;
  let originalSheet: string | null = null;
  for (const sheetName of sheetNames) {
    const normalized = normalizeSheetName(sheetName);
    if (monthSheet == null && normalized === wantMonth) monthSheet = sheetName;
    if (originalSheet == null && normalized === wantOriginal) originalSheet = sheetName;
  }

  const warnings: string[] = [];
  if (!monthSheet) warnings.push(`当該月のタブ「${workSlipMonthTabName(year, month)}」が作業伝票に見つかりません。`);
  if (!originalSheet) warnings.push(`タブ「${WORK_SLIP_ORIGINAL_TAB}」が作業伝票に見つかりません。`);

  return { targetYm: `${match[1]}-${match[2]}`, monthSheet, originalSheet, warnings };
}
