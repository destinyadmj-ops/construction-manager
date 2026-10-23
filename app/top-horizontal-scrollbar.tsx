'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// 表(本体)が横にはみ出すときだけ、ツールバー側に出す横スクロールバーの状態とスクロール同期。
export function useTopHorizontalScrollbar(observeKey: string | number) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);
  const visualRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef<0 | 1>(0);
  const [maxScroll, setMaxScroll] = useState(0);

  const updateVisual = useCallback(() => {
    const scrollbar = topRef.current;
    const visual = visualRef.current;
    if (!scrollbar || !visual) return;

    const trackWidth = visual.clientWidth;
    const viewportWidth = scrollbar.clientWidth;
    const contentWidth = scrollbar.scrollWidth;
    const topMax = Math.max(0, contentWidth - viewportWidth);
    if (trackWidth <= 0 || viewportWidth <= 0 || contentWidth <= 0) return;

    const thumbWidth = topMax > 0 ? Math.max(48, Math.min(trackWidth, (viewportWidth / contentWidth) * trackWidth)) : trackWidth;
    const maxThumbOffset = Math.max(0, trackWidth - thumbWidth);
    const thumbOffset = topMax > 0 ? (scrollbar.scrollLeft / topMax) * maxThumbOffset : 0;

    visual.style.setProperty('--mh-top-scroll-thumb-w', `${thumbWidth}px`);
    visual.style.setProperty('--mh-top-scroll-thumb-x', `${thumbOffset}px`);
  }, []);

  useEffect(() => {
    const body = bodyRef.current;
    const content = body?.firstElementChild;
    if (!body || !(content instanceof HTMLElement)) return;

    const apply = () => {
      const next = Math.max(0, body.scrollWidth - body.clientWidth);
      setMaxScroll((prev) => (prev === next ? prev : next));
      window.requestAnimationFrame(updateVisual);
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(body);
    ro.observe(content);
    window.addEventListener('resize', apply);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, [observeKey, updateVisual]);

  useEffect(() => {
    const body = bodyRef.current;
    const top = topRef.current;
    if (body && top && top.scrollLeft !== body.scrollLeft) top.scrollLeft = body.scrollLeft;
    updateVisual();
  }, [maxScroll, updateVisual]);

  const syncFrom = useCallback(
    (from: HTMLDivElement | null, targets: Array<HTMLDivElement | null>) => {
      if (syncingRef.current || !from) return;
      syncingRef.current = 1;
      for (const target of targets) {
        if (target && target.scrollLeft !== from.scrollLeft) target.scrollLeft = from.scrollLeft;
      }
      updateVisual();
      window.requestAnimationFrame(() => {
        syncingRef.current = 0;
      });
    },
    [updateVisual],
  );

  const onHeaderScroll = useCallback(() => syncFrom(headerRef.current, [bodyRef.current, topRef.current]), [syncFrom]);
  const onBodyScroll = useCallback(() => syncFrom(bodyRef.current, [headerRef.current, topRef.current]), [syncFrom]);
  const onTopScroll = useCallback(() => syncFrom(topRef.current, [headerRef.current, bodyRef.current]), [syncFrom]);

  return {
    bodyRef,
    headerRef,
    topRef,
    visualRef,
    visible: maxScroll > 1,
    maxScroll,
    onHeaderScroll,
    onBodyScroll,
    onTopScroll,
  };
}

export type TopHorizontalScrollbarState = ReturnType<typeof useTopHorizontalScrollbar>;

// 見た目用の細いトラックを、透明な実スクロールバーの下に重ねる(月予定の既存方式)。
export function TopHorizontalScrollbar({ state, testId }: { state: TopHorizontalScrollbarState; testId: string }) {
  const { visible, maxScroll, visualRef, topRef, onTopScroll } = state;
  if (!visible) return null;
  return (
    <div className="relative ml-auto flex shrink-0 justify-end" style={{ width: 'min(48vw, 36rem)' }}>
      <div
        ref={visualRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-2 -translate-y-1/2 rounded-full bg-zinc-300/95 shadow-inner dark:bg-zinc-700/90"
        data-testid={`${testId}-visual`}
      >
        <div
          className="absolute left-0 top-0 h-full rounded-full bg-zinc-600/90 shadow-sm dark:bg-zinc-100/90"
          style={{ width: 'var(--mh-top-scroll-thumb-w, 48px)', transform: 'translateX(var(--mh-top-scroll-thumb-x, 0px))' }}
        />
      </div>
      <div
        ref={topRef}
        className="mh-scrollbar-visible relative z-20 h-5 w-full overflow-x-auto overflow-y-hidden rounded-full bg-transparent"
        onScroll={onTopScroll}
        data-testid={testId}
      >
        <div style={{ width: `calc(100% + ${maxScroll}px)`, height: '1px' }} />
      </div>
    </div>
  );
}
