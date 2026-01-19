import AccountingTools from '../accounting-tools';

export default function AccountingPage() {
  return (
    <main className="mx-auto w-full max-w-screen-2xl px-4 py-4 lg:px-6" data-color-edit-slot="panel">
      <div className="space-y-2">
        <h1 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">会計（請求書/報告書）</h1>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">一覧・PDF・CSV・テンプレ実行をまとめています。</div>
        <div>
          <AccountingTools selectedSiteLabel={null} />
        </div>
      </div>
    </main>
  );
}
