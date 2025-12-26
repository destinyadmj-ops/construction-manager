'use client';

import { useEffect } from 'react';
import WeekHub from '../week-hub';

export default function MultiPage() {
  useEffect(() => {
    const t = window.setTimeout(() => {
      document.getElementById('mode-tabs')?.scrollIntoView({ block: 'start' });
    }, 50);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <main className="mx-auto max-w-5xl p-4">
      <div className="mb-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-black">
        <h1 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">マルチ</h1>
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          複数人の週/月/年をまとめて見られます。
        </div>
      </div>
      <WeekHub />
    </main>
  );
}
