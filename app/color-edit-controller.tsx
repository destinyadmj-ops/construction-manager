'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readColorEditMode, writeColorEditMode } from './color-edit';
import { ColorRamp, normalizeThemeShade } from './color-ramp';
import { applyUiTheme, readLocalUiTheme, type UiThemeColor } from './ui-theme';
import {
  mergeUiTheme,
  normalizePageThemeOverrides,
  pageThemeOverrideDbKey,
  readLocalPageThemeOverride,
  writeLocalPageThemeOverride,
  type PageThemeOverridesV1,
} from './page-theme';

type EditSlot =
  | 'surface'
  | 'panel'
  | 'button'
  | 'cellBg'
  | 'cellText'
  | 'border'
  | 'grid';

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function slotLabel(slot: EditSlot): string {
  switch (slot) {
    case 'surface':
      return '背景';
    case 'panel':
      return 'パネル';
    case 'button':
      return 'ボタン';
    case 'cellBg':
      return 'セル背景';
    case 'cellText':
      return 'セル文字';
    case 'border':
      return '枠線';
    case 'grid':
      return 'グリッド線';
  }
}

function inferSlotFromTarget(t: Element): EditSlot {
  const explicit = t.closest('[data-color-edit-slot]')?.getAttribute('data-color-edit-slot');

  // Most specific slots should always win, even inside a <button>.
  if (explicit === 'cellBg' || explicit === 'cellText' || explicit === 'grid') {
    return explicit;
  }

  // Buttons should be editable even when wrapped by border/panel containers.
  if (explicit === 'button' || t.closest('button')) {
    return 'button';
  }

  // Border/panel/surface are the fallback group.
  if (explicit === 'border' || explicit === 'panel' || explicit === 'surface') {
    return explicit;
  }

  const header = t.closest('header');
  if (header) return 'panel';

  return 'panel';
}

export default function ColorEditController() {
  const pathname = usePathname() || '/';
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState<null | { left: number; top: number; slot: EditSlot }>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [override, setOverride] = useState<PageThemeOverridesV1>(() => ({ schemaVersion: 1, overrides: {} }));
  const userIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pendingOverrideRef = useRef<PageThemeOverridesV1 | null>(null);

  const applyMerged = useCallback(
    (override: PageThemeOverridesV1) => {
      const base = readLocalUiTheme(userIdRef.current);
      applyUiTheme(mergeUiTheme(base, override));
    },
    [],
  );

  const queueSave = useCallback(
    (next: PageThemeOverridesV1) => {
      pendingOverrideRef.current = next;

      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        const userId = userIdRef.current;
        const pending = pendingOverrideRef.current;
        saveTimerRef.current = null;
        if (!userId || !pending) return;
        void fetch('/api/ui-settings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId, key: pageThemeOverrideDbKey(pathname), value: pending }),
        }).catch(() => null);
      }, 450);
    },
    [pathname],
  );

  useEffect(() => {
    const apply = () => {
      const nextEnabled = readColorEditMode();
      setEnabled(nextEnabled);
      if (!nextEnabled) setOpen(null);
    };
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
    let cancelled = false;
    void (async () => {
      try {
        const meRes = await fetch('/api/auth/me');
        const meJson = (await meRes.json().catch(() => null)) as unknown;
        const meObj = asObject(meJson);
        const userObj = asObject(meObj?.user);
        const userId = typeof userObj?.id === 'string' ? (userObj.id as string) : null;
        if (cancelled) return;
        userIdRef.current = userId;
        setUserId(userId);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Keep local override in state so UI controls (range input, etc.) behave as controlled components.
    setOverride(readLocalPageThemeOverride(userIdRef.current, pathname));
  }, [pathname, userId]);

  useEffect(() => {
    const onUpdated = (e: Event) => {
      const ce = e as CustomEvent<unknown>;
      const detail = asObject(ce.detail);
      const detailPath = typeof detail?.pathname === 'string' ? (detail.pathname as string) : null;
      const detailUser = typeof detail?.userId === 'string' ? (detail.userId as string) : null;

      if (detailPath && detailPath !== pathname) return;
      if (detailUser && detailUser !== (userIdRef.current ?? 'anon')) return;

      setOverride(readLocalPageThemeOverride(userIdRef.current, pathname));
    };

    window.addEventListener('masterHub:pageThemeOverrideUpdated', onUpdated as EventListener);
    return () => window.removeEventListener('masterHub:pageThemeOverrideUpdated', onUpdated as EventListener);
  }, [pathname]);

  useEffect(() => {
    if (!enabled) return;

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;

      // Settings / editor UI should remain clickable
      if (t.closest('[data-color-edit-ui]')) return;

      // Allow selecting edit target while keeping the mode.
      e.preventDefault();
      e.stopPropagation();

      const slot = inferSlotFromTarget(t);
      setOpen({ left: Math.max(8, Math.round(e.clientX)), top: Math.max(8, Math.round(e.clientY)), slot });
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [enabled]);

  const current = useMemo(() => {
    const base = readLocalUiTheme(userId);
    return mergeUiTheme(base, override);
  }, [override, userId]);

  const setSlotColor = useCallback(
    (slot: EditSlot, nextColor: UiThemeColor) => {
      setOverride((cur) => {
        const next = normalizePageThemeOverrides({
          schemaVersion: 1,
          overrides: {
            ...cur.overrides,
            ...(slot === 'surface' ? { surfaceColor: nextColor } : null),
            ...(slot === 'panel' ? { panelColor: nextColor } : null),
            ...(slot === 'button' ? { buttonColor: nextColor } : null),
            ...(slot === 'cellBg' ? { cellBgColor: nextColor } : null),
            ...(slot === 'cellText' ? { cellTextColor: nextColor } : null),
            ...(slot === 'border' ? { borderColor: nextColor } : null),
            ...(slot === 'grid' ? { gridColor: nextColor } : null),
          },
        });

        writeLocalPageThemeOverride(userIdRef.current, pathname, next);
        applyMerged(next);
        queueSave(next);
        return next;
      });
    },
    [applyMerged, pathname, queueSave],
  );

  const setSlotShade = useCallback(
    (slot: EditSlot, nextShade: number) => {
      const shade = normalizeThemeShade(nextShade, 0);
      setOverride((cur) => {
        const next = normalizePageThemeOverrides({
          schemaVersion: 1,
          overrides: {
            ...cur.overrides,
            ...(slot === 'surface' ? { surfaceShade: shade } : null),
            ...(slot === 'panel' ? { panelShade: shade } : null),
            ...(slot === 'button' ? { buttonShade: shade } : null),
            ...(slot === 'cellBg' ? { cellBgShade: shade } : null),
            ...(slot === 'cellText' ? { cellTextShade: shade } : null),
            ...(slot === 'border' ? { borderShade: shade } : null),
            ...(slot === 'grid' ? { gridShade: shade } : null),
          },
        });

        writeLocalPageThemeOverride(userIdRef.current, pathname, next);
        applyMerged(next);
        queueSave(next);
        return next;
      });
    },
    [applyMerged, pathname, queueSave],
  );

  if (!enabled || !open) return null;

  const slot = open.slot;
  const colorValue: UiThemeColor =
    slot === 'surface'
      ? current.surfaceColor
      : slot === 'panel'
        ? current.panelColor
        : slot === 'button'
          ? current.buttonColor
          : slot === 'cellBg'
            ? current.cellBgColor
            : slot === 'cellText'
              ? current.cellTextColor
              : slot === 'border'
                ? current.borderColor
                : current.gridColor;

  const shadeValue: number =
    slot === 'surface'
      ? current.surfaceShade
      : slot === 'panel'
        ? current.panelShade
        : slot === 'button'
          ? current.buttonShade
          : slot === 'cellBg'
            ? current.cellBgShade
            : slot === 'cellText'
              ? current.cellTextShade
              : slot === 'border'
                ? current.borderShade
                : current.gridShade;

  return (
    <div
      className="fixed z-50"
      style={{ left: open.left, top: open.top }}
      data-color-edit-keep
      data-color-edit-ui
    >
      <div className="w-[280px] rounded-md border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-800 dark:bg-black">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200">カラー編集: {slotLabel(slot)}</div>
          <button
            type="button"
            onClick={() => {
              setOpen(null);
              writeColorEditMode(false);
            }}
            className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] text-zinc-700 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:text-zinc-200 dark:hover:bg-black"
          >
            終了
          </button>
        </div>

        <div className="mt-2">
          <ColorRamp
            label={slotLabel(slot)}
            value={colorValue}
            shade={shadeValue}
            onChangeColor={(c) => setSlotColor(slot, c)}
            onChangeShade={(s) => setSlotShade(slot, s)}
          />
        </div>

        <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          ※ このページ（{pathname}）にだけ保存（アカウント別）
        </div>
      </div>
    </div>
  );
}
