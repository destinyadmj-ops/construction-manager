import AccountingTools from '../accounting-tools';

export default function AccountingPage() {
  return (
    <main className="mx-auto w-full max-w-screen-2xl px-4 py-4 lg:px-6">
      <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-black">
        <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">会計（請求書/報告書）</div>
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          一覧・PDF・CSV・テンプレ実行をまとめています。
        </div>
        <div className="mt-2">
          <AccountingTools selectedSiteLabel={null} />
        </div>
      </div>
    </main>
  );
}
