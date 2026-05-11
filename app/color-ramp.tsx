'use client';

import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UI_THEME_COLORS, type UiThemeColor, uiThemeColorLabel } from './ui-theme';

export const UI_THEME_SHADE_MIN = 0;
export const UI_THEME_SHADE_MAX = 100;

function clampInt(n: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function normalizeThemeShade(raw: unknown, fallback: number): number {
  return clampInt(typeof raw === 'number' ? raw : NaN, UI_THEME_SHADE_MIN, UI_THEME_SHADE_MAX, fallback);
}

export function shadeToStop(shade: number): 0 | 25 | 50 | 75 | 100 {
  const s = clampInt(shade, 0, 100, 0);
  if (s <= 12) return 0;
  if (s <= 37) return 25;
  if (s <= 62) return 50;
  if (s <= 87) return 75;
  return 100;
}

function swatchClass(c: UiThemeColor): string {
  switch (c) {
    case 'default':
      return 'bg-zinc-300 dark:bg-zinc-600';
    case 'red':
      return 'bg-red-500';
    case 'orange':
      return 'bg-orange-500';
    case 'amber':
      return 'bg-amber-400';
    case 'yellow':
      return 'bg-yellow-400';
    case 'lime':
      return 'bg-lime-400';
    case 'green':
      return 'bg-green-500';
    case 'emerald':
      return 'bg-emerald-500';
    case 'teal':
      return 'bg-teal-500';
    case 'cyan':
      return 'bg-cyan-500';
    case 'sky':
      return 'bg-sky-500';
    case 'blue':
      return 'bg-blue-500';
    case 'indigo':
      return 'bg-indigo-500';
    case 'violet':
      return 'bg-violet-500';
    case 'purple':
      return 'bg-purple-500';
    case 'pink':
      return 'bg-pink-500';
    case 'rose':
      return 'bg-rose-500';
  }
}

export function ColorRamp(props: {
  label: string;
  value: UiThemeColor;
  shade?: number;
  onChangeColor: (next: UiThemeColor) => void;
  onChangeShade?: (next: number) => void;
}): ReactElement {
  const { label, value, shade, onChangeColor, onChangeShade } = props;

  const canShade = typeof shade === 'number' && !!onChangeShade;
  const shadeLabel = useMemo(() => {
    if (!canShade) return '';
    return `${clampInt(shade ?? 0, 0, 100, 0)}%`;
  }, [canShade, shade]);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target && el.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const onClickColor = useCallback(
    (c: UiThemeColor) => {
      if (c === value) {
        if (canShade) setOpen((v) => !v);
        return;
      }
      onChangeColor(c);
      if (canShade) setOpen(true);
    },
    [canShade, onChangeColor, value],
  );

  return (
    <div ref={rootRef} className="relative">
      <div className="flex flex-wrap items-center gap-1">
        {UI_THEME_COLORS.map((c) => {
          const active = c === value;
          return (
            <button
              key={c}
              type="button"
              aria-label={`${label}: ${uiThemeColorLabel(c)}`}
              onClick={() => onClickColor(c)}
              className={`h-7 w-7 rounded-md border ${
                active
                  ? 'border-zinc-400 bg-white dark:border-zinc-600 dark:bg-black'
                  : 'border-zinc-200 bg-white/60 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:hover:bg-black'
              }`}
            >
              <span className={`mx-auto block h-3 w-3 rounded ${swatchClass(c)}`} aria-hidden />
            </button>
          );
        })}

        {canShade ? (
          <button
            type="button"
            className="ml-1 rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] text-zinc-700 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:text-zinc-200 dark:hover:bg-black"
            onClick={() => setOpen((v) => !v)}
            aria-label={`${label}: 濃淡`}
          >
            {shadeLabel || '濃淡'}
          </button>
        ) : null}
      </div>

      {open && canShade ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-[220px] rounded-md border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-800 dark:bg-black">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] text-zinc-600 dark:text-zinc-300">濃淡</div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{shadeLabel}</div>
          </div>
          <input
            type="range"
            min={UI_THEME_SHADE_MIN}
            max={UI_THEME_SHADE_MAX}
            value={clampInt(shade ?? 0, 0, 100, 0)}
            onChange={(e) => onChangeShade?.(clampInt(Number(e.target.value), 0, 100, 0))}
            className="mt-2 w-full"
          />
          <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">※ 表示は段階的に反映されます</div>
        </div>
      ) : null}
    </div>
  );
}
