export default function SiteLedgerDetailLoading() {
  return (
    <main className="mx-auto w-full max-w-screen-lg px-4 py-4 lg:px-6">
      <div className="space-y-4 animate-pulse">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-2">
            <div className="h-4 w-32 rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-3 w-48 rounded bg-zinc-100 dark:bg-zinc-900" />
          </div>
          <div className="h-8 w-24 rounded bg-zinc-100 dark:bg-zinc-900" />
        </div>

        <div className="space-y-2">
          <div className="h-10 rounded-md bg-zinc-100 dark:bg-zinc-900" />
          <div className="h-10 rounded-md bg-zinc-100 dark:bg-zinc-900" />
          <div className="h-10 rounded-md bg-zinc-100 dark:bg-zinc-900" />
          <div className="h-24 rounded-md bg-zinc-100 dark:bg-zinc-900" />
        </div>

        <div className="rounded-md border border-zinc-200 bg-white/60 px-3 py-3 dark:border-zinc-800 dark:bg-black/60">
          <div className="h-4 w-28 rounded bg-zinc-100 dark:bg-zinc-900" />
          <div className="mt-3 space-y-2">
            <div className="h-10 rounded-md bg-zinc-100 dark:bg-zinc-900" />
            <div className="h-10 rounded-md bg-zinc-100 dark:bg-zinc-900" />
          </div>
        </div>
      </div>
    </main>
  );
}