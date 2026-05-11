'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readColorEditMode, writeColorEditMode } from './color-edit';
import { ColorRamp, normalizeThemeShade } from './color-ramp';
import {
  applyUiTheme,
  buildUiThemeSlotCssVars,
  readLocalUiTheme,
  readUiThemeSlot,
  type UiTheme,
  type UiThemeColor,
  type UiThemeEditableSlot,
} from './ui-theme';
import {
  mergeUiTheme,
  normalizePageThemeOverrides,
  pageThemeOverrideDbKey,
  readLocalPageThemeOverride,
  writeLocalPageThemeOverride,
  type PageThemeElementOverride,
  type PageThemeOverrides,
} from './page-theme';

type EditSlot = UiThemeEditableSlot;

type OpenState = {
  left: number;
  top: number;
  slot: EditSlot;
  targetKey: string | null;
  targetLabel: string;
};

const ELEMENT_THEME_VAR_NAMES = [
  '--mh-surface-bg-light',
  '--mh-surface-bg-dark',
  '--mh-panel-bg-light',
  '--mh-panel-bg-dark',
  '--mh-button-bg-light',
  '--mh-button-bg-dark',
  '--mh-button-border-light',
  '--mh-button-border-dark',
  '--mh-button-text-light',
  '--mh-button-text-dark',
  '--mh-cell-bg-light',
  '--mh-cell-bg-dark',
  '--mh-cell-text-light',
  '--mh-cell-text-dark',
  '--mh-border-line-light',
  '--mh-border-line-dark',
  '--mh-grid-line-light',
  '--mh-grid-line-dark',
] as const;

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function normalizeKeyToken(value: string | null | undefined, maxLength = 36): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim().replace(/[>|]/g, ' ');
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function getElementLabelSeed(el: Element): string | null {
  const attrSeeds = [
    el.getAttribute('data-color-edit-id'),
    el.getAttribute('aria-label'),
    el.getAttribute('title'),
    el.getAttribute('name'),
    el.getAttribute('href'),
    el.getAttribute('id'),
  ];

  for (const seed of attrSeeds) {
    const normalized = normalizeKeyToken(seed, 48);
    if (normalized) return normalized;
  }

  const text = normalizeKeyToken(el.textContent, 48);
  if (text) return text;

  return normalizeKeyToken(el.tagName.toLowerCase(), 24);
}

function sameSlotSiblingIndex(el: Element): number {
  let index = 0;
  let prev = el.previousElementSibling;
  while (prev) {
    if (prev.tagName === el.tagName && prev.getAttribute('data-color-edit-slot') === el.getAttribute('data-color-edit-slot')) {
      index += 1;
    }
    prev = prev.previousElementSibling;
  }
  return index;
}

function describeElementSegment(el: Element): string {
  const labelSeed = getElementLabelSeed(el);
  const slot = normalizeKeyToken(el.getAttribute('data-color-edit-slot'), 16);
  const label = labelSeed ? `:${labelSeed}` : '';
  const slotPart = slot ? `[${slot}]` : '';
  return `${el.tagName.toLowerCase()}${slotPart}${label}#${sameSlotSiblingIndex(el)}`;
}

function buildElementThemeKey(el: HTMLElement, slot: EditSlot): string {
  const segments: string[] = [slot];
  let cursor: Element | null = el;
  let depth = 0;

  while (cursor && cursor !== document.body && depth < 6) {
    segments.unshift(describeElementSegment(cursor));
    cursor = cursor.parentElement;
    depth += 1;
  }

  segments.unshift('body');
  return segments.join('>');
}

function describeEditableTarget(el: HTMLElement, slot: EditSlot): string {
  if (slot === 'surface') return 'ページ背景';
  return getElementLabelSeed(el) ?? slotLabel(slot);
}

function resolveElementForSlot(source: Element, slot: EditSlot): HTMLElement | null {
  switch (slot) {
    case 'surface':
      return document.body;
    case 'button':
      return (source.closest('[data-color-edit-slot="button"]') ?? source.closest('button')) as HTMLElement | null;
    case 'panel':
    case 'cellBg':
    case 'cellText':
    case 'border':
    case 'grid':
      return source.closest(`[data-color-edit-slot='${slot}']`) as HTMLElement | null;
  }
}

function clearElementThemeVars(el: HTMLElement): void {
  for (const name of ELEMENT_THEME_VAR_NAMES) {
    el.style.removeProperty(name);
  }
  delete el.dataset.colorEditElementTheme;
}

function findCandidateElements(slot: EditSlot): HTMLElement[] {
  switch (slot) {
    case 'surface':
      return [document.body];
    case 'button':
      return Array.from(document.querySelectorAll<HTMLElement>('[data-color-edit-slot="button"], button'));
    case 'panel':
    case 'cellBg':
    case 'cellText':
    case 'border':
    case 'grid':
      return Array.from(document.querySelectorAll<HTMLElement>(`[data-color-edit-slot='${slot}']`));
  }
}

function findElementByOverrideKey(slot: EditSlot, targetKey: string): HTMLElement | null {
  for (const candidate of findCandidateElements(slot)) {
    const resolved = resolveElementForSlot(candidate, slot);
    if (!resolved) continue;
    if (buildElementThemeKey(resolved, slot) === targetKey) return resolved;
  }
  return null;
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

function resolveEditableTarget(source: Element): {
  slot: EditSlot;
  element: HTMLElement;
  targetKey: string | null;
  targetLabel: string;
} | null {
  const slot = inferSlotFromTarget(source);
  const element = resolveElementForSlot(source, slot);
  if (!element) return null;

  return {
    slot,
    element,
    targetKey: slot === 'surface' ? null : buildElementThemeKey(element, slot),
    targetLabel: describeEditableTarget(element, slot),
  };
}

function normalizeElementOverrideAgainstBase(
  base: { color: UiThemeColor; shade: number },
  next: PageThemeElementOverride,
): PageThemeElementOverride | null {
  const normalizedColor = next.color && next.color !== base.color ? next.color : undefined;
  const normalizedShade = typeof next.shade === 'number' && next.shade !== base.shade ? next.shade : undefined;

  if (!normalizedColor && typeof normalizedShade !== 'number') return null;

  return {
    slot: next.slot,
    ...(normalizedColor ? { color: normalizedColor } : null),
    ...(typeof normalizedShade === 'number' ? { shade: normalizedShade } : null),
    ...(next.label ? { label: next.label } : null),
  };
}

export default function ColorEditController() {
  const pathname = usePathname() || '/';
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState<OpenState | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [override, setOverride] = useState<PageThemeOverrides>(() => ({ schemaVersion: 2, overrides: {}, elements: {} }));
  const userIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pendingOverrideRef = useRef<PageThemeOverrides | null>(null);
  const overrideRef = useRef<PageThemeOverrides>(override);

  const openEditorAt = useCallback((slot: EditSlot, targetKey: string | null, targetLabel: string, x: number, y: number) => {
    const margin = 8;
    const left = Math.min(Math.max(margin, Math.round(x)), Math.max(margin, window.innerWidth - 296));
    const top = Math.min(Math.max(margin, Math.round(y)), Math.max(margin, window.innerHeight - 196));
    setOpen({ left, top, slot, targetKey, targetLabel });
  }, []);

  const applyElementOverrides = useCallback((pageTheme: UiTheme, nextOverride: PageThemeOverrides) => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-color-edit-element-theme]'))) {
      clearElementThemeVars(el);
    }

    for (const [targetKey, elementOverride] of Object.entries(nextOverride.elements)) {
      const target = findElementByOverrideKey(elementOverride.slot, targetKey);
      if (!target) continue;

      const baseSlot = readUiThemeSlot(pageTheme, elementOverride.slot);
      const color = elementOverride.color ?? baseSlot.color;
      const shade = typeof elementOverride.shade === 'number' ? elementOverride.shade : baseSlot.shade;
      const vars = buildUiThemeSlotCssVars(elementOverride.slot, color, shade);
      if (!Object.keys(vars).length) continue;

      clearElementThemeVars(target);
      for (const [name, value] of Object.entries(vars)) {
        target.style.setProperty(name, value);
      }
      target.dataset.colorEditElementTheme = 'true';
    }
  }, []);

  const applyThemeOverride = useCallback(
    (nextOverride: PageThemeOverrides) => {
      const base = readLocalUiTheme(userIdRef.current);
      const merged = mergeUiTheme(base, nextOverride);
      applyUiTheme(merged);
      applyElementOverrides(merged, nextOverride);
    },
    [applyElementOverrides],
  );

  const queueSave = useCallback(
    (next: PageThemeOverrides) => {
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
    overrideRef.current = override;
  }, [override]);

  useEffect(() => {
    applyThemeOverride(override);

    let rafId: number | null = null;
    const observer = new MutationObserver(() => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        applyThemeOverride(overrideRef.current);
      });
    });

    if (document.body) {
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['id', 'name', 'title', 'href', 'aria-label', 'data-color-edit-slot'],
      });
    }

    return () => {
      observer.disconnect();
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [applyThemeOverride, override, pathname]);

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

      if (e.button !== 0) return;

      // While edit mode is enabled, regular left-clicks should not trigger the underlying UI.
      e.preventDefault();
      e.stopPropagation();
    };

    const onContextMenu = (e: MouseEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;

      if (t.closest('[data-color-edit-ui]')) return;

      e.preventDefault();
      e.stopPropagation();

      const target = resolveEditableTarget(t);
      if (!target) return;
      openEditorAt(target.slot, target.targetKey, target.targetLabel, e.clientX, e.clientY);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [enabled, openEditorAt]);

  const current = useMemo(() => {
    const base = readLocalUiTheme(userId);
    return mergeUiTheme(base, override);
  }, [override, userId]);

  const setSlotColor = useCallback(
    (slot: EditSlot, targetKey: string | null, targetLabel: string, nextColor: UiThemeColor) => {
      setOverride((cur) => {
        let next: PageThemeOverrides;

        if (targetKey) {
          const merged = mergeUiTheme(readLocalUiTheme(userIdRef.current), cur);
          const baseSlot = readUiThemeSlot(merged, slot);
          const prevElement = cur.elements[targetKey] ?? { slot, label: targetLabel };
          const nextElement = normalizeElementOverrideAgainstBase(baseSlot, {
            ...prevElement,
            slot,
            label: targetLabel,
            color: nextColor,
          });

          const elements = { ...cur.elements };
          if (nextElement) elements[targetKey] = nextElement;
          else delete elements[targetKey];

          next = normalizePageThemeOverrides({
            schemaVersion: 2,
            overrides: cur.overrides,
            elements,
          });
        } else {
          next = normalizePageThemeOverrides({
            schemaVersion: 2,
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
            elements: cur.elements,
          });
        }

        writeLocalPageThemeOverride(userIdRef.current, pathname, next);
        applyThemeOverride(next);
        queueSave(next);
        return next;
      });
    },
    [applyThemeOverride, pathname, queueSave],
  );

  const setSlotShade = useCallback(
    (slot: EditSlot, targetKey: string | null, targetLabel: string, nextShade: number) => {
      const shade = normalizeThemeShade(nextShade, 0);
      setOverride((cur) => {
        let next: PageThemeOverrides;

        if (targetKey) {
          const merged = mergeUiTheme(readLocalUiTheme(userIdRef.current), cur);
          const baseSlot = readUiThemeSlot(merged, slot);
          const prevElement = cur.elements[targetKey] ?? { slot, label: targetLabel };
          const nextElement = normalizeElementOverrideAgainstBase(baseSlot, {
            ...prevElement,
            slot,
            label: targetLabel,
            shade,
          });

          const elements = { ...cur.elements };
          if (nextElement) elements[targetKey] = nextElement;
          else delete elements[targetKey];

          next = normalizePageThemeOverrides({
            schemaVersion: 2,
            overrides: cur.overrides,
            elements,
          });
        } else {
          next = normalizePageThemeOverrides({
            schemaVersion: 2,
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
            elements: cur.elements,
          });
        }

        writeLocalPageThemeOverride(userIdRef.current, pathname, next);
        applyThemeOverride(next);
        queueSave(next);
        return next;
      });
    },
    [applyThemeOverride, pathname, queueSave],
  );

  const resetElementOverride = useCallback(() => {
    const targetKey = open?.targetKey;
    if (!targetKey) return;

    setOverride((cur) => {
      if (!cur.elements[targetKey]) return cur;

      const elements = { ...cur.elements };
      delete elements[targetKey];

      const next = normalizePageThemeOverrides({
        schemaVersion: 2,
        overrides: cur.overrides,
        elements,
      });

      writeLocalPageThemeOverride(userIdRef.current, pathname, next);
      applyThemeOverride(next);
      queueSave(next);
      return next;
    });
  }, [applyThemeOverride, open, pathname, queueSave]);

  if (!enabled || !open) return null;

  const slot = open.slot;
  const baseSlot = readUiThemeSlot(current, slot);
  const elementOverride = open.targetKey ? override.elements[open.targetKey] : null;
  const colorValue: UiThemeColor = elementOverride?.color ?? baseSlot.color;
  const shadeValue: number = typeof elementOverride?.shade === 'number' ? elementOverride.shade : baseSlot.shade;

  return (
    <div
      className="fixed z-50"
      style={{ left: open.left, top: open.top }}
      data-color-edit-keep
      data-color-edit-ui
    >
      <div className="w-[280px] rounded-md border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-800 dark:bg-black">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200">カラー編集: {slotLabel(slot)}</div>
            <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">対象: {open.targetLabel}</div>
          </div>
          <div className="flex items-center gap-1">
            {open.targetKey ? (
              <button
                type="button"
                onClick={resetElementOverride}
                className="rounded-md border border-zinc-200 bg-white/60 px-2 py-1 text-[11px] text-zinc-700 hover:bg-white dark:border-zinc-800 dark:bg-black/60 dark:text-zinc-200 dark:hover:bg-black"
              >
                共通に戻す
              </button>
            ) : null}
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
        </div>

        <div className="mt-2">
          <ColorRamp
            label={slotLabel(slot)}
            value={colorValue}
            shade={shadeValue}
            onChangeColor={(c) => setSlotColor(slot, open.targetKey, open.targetLabel, c)}
            onChangeShade={(s) => setSlotShade(slot, open.targetKey, open.targetLabel, s)}
          />
        </div>

        <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          {open.targetKey
            ? `※ この要素だけ保存（ページ: ${pathname} / アカウント別）`
            : `※ このページ（${pathname}）にだけ保存（アカウント別）`}
        </div>
      </div>
    </div>
  );
}
