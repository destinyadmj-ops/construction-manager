'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type PortalMenuProps = {
  anchorRef: React.RefObject<HTMLElement | null>;
  isOpen: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  width?: number;
  offset?: { x?: number; y?: number };
  className?: string;
  menuRef?: React.Ref<HTMLDivElement> | null;
  align?: 'left' | 'right';
};

export default function PortalMenu({ anchorRef, isOpen, onClose, children, width, offset, className, menuRef, align }: PortalMenuProps) {
  const container: HTMLElement | null = typeof document !== 'undefined'
    ? (() => {
        let el = document.getElementById('mh-portal-root') as HTMLElement | null;
        if (!el) {
          el = document.createElement('div');
          el.id = 'mh-portal-root';
          document.body.appendChild(el);
        }
        return el;
      })()
    : null;

  const [pos, setPos] = useState({ left: 0, top: 0, w: width ?? 320 });

  useEffect(() => {
    if (!isOpen) return;
    function update() {
      const anchor = anchorRef?.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const w = width ?? Math.min(420, Math.round(rect.width || 320));
      // default: align left to anchor.left
      let left = Math.max(8, Math.round(rect.left + (offset?.x ?? 0)));
      // if align right, align menu's right edge to anchor's right edge
      if (align === 'right') {
        left = Math.max(8, Math.round(rect.right - w + (offset?.x ?? 0)));
      }
      const top = Math.round(rect.bottom + (offset?.y ?? 0) + window.scrollY);
      setPos({ left, top, w });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [isOpen, anchorRef, width, offset, align]);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!container) return null;
  if (!isOpen) return null;

  const style: React.CSSProperties = {
    position: 'absolute',
    left: pos.left,
    top: pos.top,
    width: pos.w,
    zIndex: 12000,
  };

  return createPortal(
    <div ref={menuRef ?? undefined} style={style} className={className}>
      {children}
    </div>,
    container,
  );
}
