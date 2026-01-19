'use client';

import { useEffect } from 'react';

export function useOutsidePointerDown({
  open,
  refs,
  onOutside,
  capture = true,
}: {
  open: boolean;
  refs: Array<React.RefObject<HTMLElement | null>>;
  onOutside: () => void;
  capture?: boolean;
}) {
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;

      for (const r of refs) {
        const el = r.current;
        if (!el) continue;
        if (el.contains(target)) return;
      }

      onOutside();
    };

    document.addEventListener('pointerdown', onPointerDown, capture);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, capture);
    };
  }, [capture, onOutside, open, refs]);
}
