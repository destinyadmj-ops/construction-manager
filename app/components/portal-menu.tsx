'use client';

import React, { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const PORTAL_ROOT_ID = 'mh-portal-root';
const PORTAL_ROOT_Z_INDEX = 12000;

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

function getOrCreatePortalRoot() {
  let el = document.getElementById(PORTAL_ROOT_ID) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement('div');
    el.id = PORTAL_ROOT_ID;
    document.body.appendChild(el);
  }

  el.style.position = 'fixed';
  el.style.inset = '0';
  el.style.zIndex = String(PORTAL_ROOT_Z_INDEX);
  el.style.pointerEvents = 'none';

  return el;
}

export default function PortalMenu({ anchorRef, isOpen, onClose, children, width, offset, className, menuRef, align }: PortalMenuProps) {
  const [container] = useState<HTMLElement | null>(() => (typeof document === 'undefined' ? null : getOrCreatePortalRoot()));

  const [pos, setPos] = useState({ left: 0, top: 0, w: width ?? 320 });

  useLayoutEffect(() => {
    if (!isOpen) return;

    function update() {
      const anchor = anchorRef?.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const preferredWidth = width ?? Math.min(420, Math.round(rect.width || 320));
      const w = Math.min(preferredWidth, Math.max(160, viewportWidth - 16));
      let left = rect.left + (offset?.x ?? 0);

      if (align === 'right') {
        left = rect.right - w + (offset?.x ?? 0);
      }

      const clampedLeft = Math.min(Math.max(8, Math.round(left)), Math.max(8, viewportWidth - w - 8));
      const top = Math.max(8, Math.round(rect.bottom + (offset?.y ?? 0)));
      setPos({ left: clampedLeft, top, w });
    }

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
    position: 'fixed',
    left: pos.left,
    top: pos.top,
    width: pos.w,
    zIndex: PORTAL_ROOT_Z_INDEX + 1,
    pointerEvents: 'auto',
  };

  return createPortal(
    <div ref={menuRef ?? undefined} style={style} className={className}>
      {children}
    </div>,
    container,
  );
}
