'use client';

import { useEffect, useState } from 'react';
import { readColorEditMode, writeColorEditMode } from './color-edit';

export default function ColorEditOverlay() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const apply = () => setEnabled(readColorEditMode());
    apply();

    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key !== 'masterHub.ui:colorEditMode') return;
      apply();
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('masterHub:colorEditModeUpdated', apply as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('masterHub:colorEditModeUpdated', apply as EventListener);
    };
  }, []);

  useEffect(() => {
    const cls = 'mh-color-edit-mode';
    if (enabled) document.body.classList.add(cls);
    else document.body.classList.remove(cls);
    return () => document.body.classList.remove(cls);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) {
        writeColorEditMode(false);
        return;
      }

      // 編集UI（ポップオーバー/メニュー等）内は維持
      if (t.closest('[data-color-edit-keep]')) return;

      // 編集対象の選択（クリック）でも維持
      if (t.closest('[data-color-edit-slot]')) return;

      // 空白クリックは解除
      if (t === document.body || t === document.documentElement) {
        writeColorEditMode(false);
        return;
      }

      // それ以外も維持（全画面クリック式のため）
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-40 bg-zinc-200/35 dark:bg-zinc-900/35"
      aria-hidden
    />
  );
}
