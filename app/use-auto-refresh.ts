'use client';

import { useEffect, useRef } from 'react';

// 表示中のタブだけ、一定間隔で callback を呼ぶ。非表示の間は止まり、表示に戻ったとき間隔を過ぎていれば1回すぐ呼ぶ。
// 共有フォルダ同期(5分おき)の結果を、開きっぱなしの画面へ反映するために使う。
export function useAutoRefresh(callback: () => void, intervalMs: number, enabled = true) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;
    let lastRunAt = Date.now();
    const run = () => {
      lastRunAt = Date.now();
      callbackRef.current();
    };
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      run();
    }, intervalMs);
    const onVisibilityChange = () => {
      if (document.hidden) return;
      if (Date.now() - lastRunAt >= intervalMs) run();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, intervalMs]);
}
