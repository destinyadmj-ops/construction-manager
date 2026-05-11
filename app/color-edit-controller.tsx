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
  emptyPageThemeOverrides,
  globalThemeOverrideDbKey,
  mergeUiTheme,
  normalizePageThemeOverrides,
  pageThemeOverrideDbKey,
  readLocalGlobalThemeOverride,
  readLocalPageThemeOverride,
  writeLocalGlobalThemeOverride,
  writeLocalPageThemeOverride,
  type PageThemeElementOverride,
  type PageThemeOverrides,
} from './page-theme';

type EditSlot = UiThemeEditableSlot;
type EditScope = 'page' | 'global';

type OpenState = {
  left: number;
  top: number;
  scope: EditScope;
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

function inferEditScope(element: HTMLElement, slot: EditSlot): EditScope {
  if (slot === 'button' && element.closest('header')) return 'global';
  return 'page';
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
  scope: EditScope;
  slot: EditSlot;
  element: HTMLElement;
  targetKey: string | null;
  targetLabel: string;
} | null {
  const slot = inferSlotFromTarget(source);
  const element = resolveElementForSlot(source, slot);
  if (!element) return null;

  return {
    scope: inferEditScope(element, slot),
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
  const [pageOverride, setPageOverride] = useState<PageThemeOverrides>(() => emptyPageThemeOverrides());
  const [globalOverride, setGlobalOverride] = useState<PageThemeOverrides>(() => emptyPageThemeOverrides());
  const userIdRef = useRef<string | null>(null);
  const pageSaveTimerRef = useRef<number | null>(null);
  const globalSaveTimerRef = useRef<number | null>(null);
  const pendingPageOverrideRef = useRef<PageThemeOverrides | null>(null);
  const pendingGlobalOverrideRef = useRef<PageThemeOverrides | null>(null);
  const pageOverrideRef = useRef<PageThemeOverrides>(pageOverride);
  const globalOverrideRef = useRef<PageThemeOverrides>(globalOverride);

  const openEditorAt = useCallback((scope: EditScope, slot: EditSlot, targetKey: string | null, targetLabel: string, x: number, y: number) => {
    const margin = 8;
    const left = Math.min(Math.max(margin, Math.round(x)), Math.max(margin, window.innerWidth - 296));
    const top = Math.min(Math.max(margin, Math.round(y)), Math.max(margin, window.innerHeight - 196));
    setOpen({ left, top, scope, slot, targetKey, targetLabel });
  }, []);

  const applyElementOverrides = useCallback((pageTheme: UiTheme, nextPageOverride: PageThemeOverrides, nextGlobalOverride: PageThemeOverrides) => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-color-edit-element-theme]'))) {
      clearElementThemeVars(el);
    }

    const mergedElementOverrides = { ...nextPageOverride.elements, ...nextGlobalOverride.elements };

    for (const [targetKey, elementOverride] of Object.entries(mergedElementOverrides)) {
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
    (nextPageOverride: PageThemeOverrides, nextGlobalOverride: PageThemeOverrides) => {
      const base = readLocalUiTheme(userIdRef.current);
      const merged = mergeUiTheme(mergeUiTheme(base, nextGlobalOverride), nextPageOverride);
      applyUiTheme(merged);
      applyElementOverrides(merged, nextPageOverride, nextGlobalOverride);
    },
    [applyElementOverrides],
  );

  const queuePageSave = useCallback(
    (next: PageThemeOverrides) => {
      pendingPageOverrideRef.current = next;

      if (pageSaveTimerRef.current) window.clearTimeout(pageSaveTimerRef.current);
      pageSaveTimerRef.current = window.setTimeout(() => {
        const userId = userIdRef.current;
        const pending = pendingPageOverrideRef.current;
        pageSaveTimerRef.current = null;
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

  const queueGlobalSave = useCallback((next: PageThemeOverrides) => {
    pendingGlobalOverrideRef.current = next;

    if (globalSaveTimerRef.current) window.clearTimeout(globalSaveTimerRef.current);
    globalSaveTimerRef.current = window.setTimeout(() => {
      const userId = userIdRef.current;
      const pending = pendingGlobalOverrideRef.current;
      globalSaveTimerRef.current = null;
      if (!userId || !pending) return;
      void fetch('/api/ui-settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, key: globalThemeOverrideDbKey(), value: pending }),
      }).catch(() => null);
    }, 450);
  }, []);

  useEffect(() => {
    pageOverrideRef.current = pageOverride;
  }, [pageOverride]);

  useEffect(() => {
    globalOverrideRef.current = globalOverride;
  }, [globalOverride]);

  useEffect(() => {
    return () => {
      if (pageSaveTimerRef.current) window.clearTimeout(pageSaveTimerRef.current);
      if (globalSaveTimerRef.current) window.clearTimeout(globalSaveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    applyThemeOverride(pageOverride, globalOverride);

    let rafId: number | null = null;
    const observer = new MutationObserver(() => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        applyThemeOverride(pageOverrideRef.current, globalOverrideRef.current);
      });
    });

    if (document.body) {
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['id', 'name', 'title', 'href', 'aria-label', 'data-color-edit-id', 'data-color-edit-slot'],
      });
    }

    return () => {
      observer.disconnect();
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [applyThemeOverride, globalOverride, pageOverride, pathname]);

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
    setPageOverride(readLocalPageThemeOverride(userIdRef.current, pathname));
    setGlobalOverride(readLocalGlobalThemeOverride(userIdRef.current));
  }, [pathname, userId]);

  useEffect(() => {
    const onPageUpdated = (e: Event) => {
      const ce = e as CustomEvent<unknown>;
      const detail = asObject(ce.detail);
      const detailPath = typeof detail?.pathname === 'string' ? (detail.pathname as string) : null;
      const detailUser = typeof detail?.userId === 'string' ? (detail.userId as string) : null;

      if (detailPath && detailPath !== pathname) return;
      if (detailUser && detailUser !== (userIdRef.current ?? 'anon')) return;

      setPageOverride(readLocalPageThemeOverride(userIdRef.current, pathname));
    };

    const onGlobalUpdated = (e: Event) => {
      const ce = e as CustomEvent<unknown>;
      const detail = asObject(ce.detail);
      const detailUser = typeof detail?.userId === 'string' ? (detail.userId as string) : null;

      if (detailUser && detailUser !== (userIdRef.current ?? 'anon')) return;

      setGlobalOverride(readLocalGlobalThemeOverride(userIdRef.current));
    };

    window.addEventListener('masterHub:pageThemeOverrideUpdated', onPageUpdated as EventListener);
    window.addEventListener('masterHub:globalThemeOverrideUpdated', onGlobalUpdated as EventListener);
    return () => {
      window.removeEventListener('masterHub:pageThemeOverrideUpdated', onPageUpdated as EventListener);
      window.removeEventListener('masterHub:globalThemeOverrideUpdated', onGlobalUpdated as EventListener);
    };
  }, [pathname]);

  useEffect(() => {
    const currentPageOverride = readLocalPageThemeOverride(userIdRef.current, pathname);
    const currentGlobalOverride = readLocalGlobalThemeOverride(userIdRef.current);
    const nextPageElements = { ...currentPageOverride.elements };
    const nextGlobalElements = { ...currentGlobalOverride.elements };
    let pageChanged = false;
    let globalChanged = false;

    for (const [targetKey, elementOverride] of Object.entries(currentPageOverride.elements)) {
      if (elementOverride.slot !== 'button') continue;
      const target = findElementByOverrideKey(elementOverride.slot, targetKey);
      if (!target || inferEditScope(target, elementOverride.slot) !== 'global') continue;

      if (!nextGlobalElements[targetKey]) {
        nextGlobalElements[targetKey] = elementOverride;
        globalChanged = true;
      }

      delete nextPageElements[targetKey];
      pageChanged = true;
    }

    if (!pageChanged && !globalChanged) return;

    const nextPageOverride = pageChanged
      ? normalizePageThemeOverrides({
          schemaVersion: 2,
          overrides: currentPageOverride.overrides,
          elements: nextPageElements,
        })
      : currentPageOverride;
    const nextGlobalOverride = globalChanged
      ? normalizePageThemeOverrides({
          schemaVersion: 2,
          overrides: currentGlobalOverride.overrides,
          elements: nextGlobalElements,
        })
      : currentGlobalOverride;

    if (pageChanged) {
      pageOverrideRef.current = nextPageOverride;
      writeLocalPageThemeOverride(userIdRef.current, pathname, nextPageOverride);
      queuePageSave(nextPageOverride);
    }

    if (globalChanged) {
      globalOverrideRef.current = nextGlobalOverride;
      writeLocalGlobalThemeOverride(userIdRef.current, nextGlobalOverride);
      queueGlobalSave(nextGlobalOverride);
    }

    applyThemeOverride(nextPageOverride, nextGlobalOverride);
  }, [applyThemeOverride, pathname, queueGlobalSave, queuePageSave, userId]);

  useEffect(() => {
    if (!enabled) return;

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;

      // Keep panels (settings, popup, etc.) should remain normally clickable.
      if (t.closest('[data-color-edit-ui], [data-color-edit-keep]')) return;

      if (e.button !== 0) return;

      // While edit mode is enabled, regular left-clicks should not trigger the underlying UI.
      e.preventDefault();
      e.stopPropagation();
    };

    const onContextMenu = (e: MouseEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t) return;

      if (t.closest('[data-color-edit-ui], [data-color-edit-ignore-contextmenu]')) return;

      e.preventDefault();
      e.stopPropagation();

      const target = resolveEditableTarget(t);
      if (!target) return;
      openEditorAt(target.scope, target.slot, target.targetKey, target.targetLabel, e.clientX, e.clientY);
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
    return mergeUiTheme(mergeUiTheme(base, globalOverride), pageOverride);
  }, [globalOverride, pageOverride, userId]);

  const commitPageOverride = useCallback(
    (next: PageThemeOverrides) => {
      pageOverrideRef.current = next;
      setPageOverride(next);
      writeLocalPageThemeOverride(userIdRef.current, pathname, next);
      applyThemeOverride(next, globalOverrideRef.current);
      queuePageSave(next);
    },
    [applyThemeOverride, pathname, queuePageSave],
  );

  const commitGlobalOverride = useCallback(
    (next: PageThemeOverrides) => {
      globalOverrideRef.current = next;
      setGlobalOverride(next);
      writeLocalGlobalThemeOverride(userIdRef.current, next);
      applyThemeOverride(pageOverrideRef.current, next);
      queueGlobalSave(next);
    },
    [applyThemeOverride, queueGlobalSave],
  );

  const setSlotColor = useCallback(
    (scope: EditScope, slot: EditSlot, targetKey: string | null, targetLabel: string, nextColor: UiThemeColor) => {
      if (targetKey && scope === 'global') {
        const currentGlobal = globalOverrideRef.current;
        const merged = mergeUiTheme(readLocalUiTheme(userIdRef.current), currentGlobal);
        const baseSlot = readUiThemeSlot(merged, slot);
        const prevElement = currentGlobal.elements[targetKey] ?? { slot, label: targetLabel };
        const nextElement = normalizeElementOverrideAgainstBase(baseSlot, {
          ...prevElement,
          slot,
          label: targetLabel,
          color: nextColor,
        });

        const nextGlobal = normalizePageThemeOverrides({
          schemaVersion: 2,
          overrides: currentGlobal.overrides,
          elements: {
            ...currentGlobal.elements,
            ...(nextElement ? { [targetKey]: nextElement } : null),
          },
        });

        if (!nextElement) delete nextGlobal.elements[targetKey];

        const currentPage = pageOverrideRef.current;
        if (currentPage.elements[targetKey]) {
          const nextPageElements = { ...currentPage.elements };
          delete nextPageElements[targetKey];
          commitPageOverride(
            normalizePageThemeOverrides({
              schemaVersion: 2,
              overrides: currentPage.overrides,
              elements: nextPageElements,
            }),
          );
        }

        commitGlobalOverride(nextGlobal);
        return;
      }

      const currentPage = pageOverrideRef.current;

      if (targetKey) {
        const merged = mergeUiTheme(mergeUiTheme(readLocalUiTheme(userIdRef.current), globalOverrideRef.current), currentPage);
        const baseSlot = readUiThemeSlot(merged, slot);
        const prevElement = currentPage.elements[targetKey] ?? { slot, label: targetLabel };
        const nextElement = normalizeElementOverrideAgainstBase(baseSlot, {
          ...prevElement,
          slot,
          label: targetLabel,
          color: nextColor,
        });

        const nextPage = normalizePageThemeOverrides({
          schemaVersion: 2,
          overrides: currentPage.overrides,
          elements: {
            ...currentPage.elements,
            ...(nextElement ? { [targetKey]: nextElement } : null),
          },
        });

        if (!nextElement) delete nextPage.elements[targetKey];
        commitPageOverride(nextPage);
        return;
      }

      commitPageOverride(
        normalizePageThemeOverrides({
          schemaVersion: 2,
          overrides: {
            ...currentPage.overrides,
            ...(slot === 'surface' ? { surfaceColor: nextColor } : null),
            ...(slot === 'panel' ? { panelColor: nextColor } : null),
            ...(slot === 'button' ? { buttonColor: nextColor } : null),
            ...(slot === 'cellBg' ? { cellBgColor: nextColor } : null),
            ...(slot === 'cellText' ? { cellTextColor: nextColor } : null),
            ...(slot === 'border' ? { borderColor: nextColor } : null),
            ...(slot === 'grid' ? { gridColor: nextColor } : null),
          },
          elements: currentPage.elements,
        }),
      );
    },
    [commitGlobalOverride, commitPageOverride],
  );

  const setSlotShade = useCallback(
    (scope: EditScope, slot: EditSlot, targetKey: string | null, targetLabel: string, nextShade: number) => {
      const shade = normalizeThemeShade(nextShade, 0);
      if (targetKey && scope === 'global') {
        const currentGlobal = globalOverrideRef.current;
        const merged = mergeUiTheme(readLocalUiTheme(userIdRef.current), currentGlobal);
        const baseSlot = readUiThemeSlot(merged, slot);
        const prevElement = currentGlobal.elements[targetKey] ?? { slot, label: targetLabel };
        const nextElement = normalizeElementOverrideAgainstBase(baseSlot, {
          ...prevElement,
          slot,
          label: targetLabel,
          shade,
        });

        const nextGlobal = normalizePageThemeOverrides({
          schemaVersion: 2,
          overrides: currentGlobal.overrides,
          elements: {
            ...currentGlobal.elements,
            ...(nextElement ? { [targetKey]: nextElement } : null),
          },
        });

        if (!nextElement) delete nextGlobal.elements[targetKey];

        const currentPage = pageOverrideRef.current;
        if (currentPage.elements[targetKey]) {
          const nextPageElements = { ...currentPage.elements };
          delete nextPageElements[targetKey];
          commitPageOverride(
            normalizePageThemeOverrides({
              schemaVersion: 2,
              overrides: currentPage.overrides,
              elements: nextPageElements,
            }),
          );
        }

        commitGlobalOverride(nextGlobal);
        return;
      }

      const currentPage = pageOverrideRef.current;

      if (targetKey) {
        const merged = mergeUiTheme(mergeUiTheme(readLocalUiTheme(userIdRef.current), globalOverrideRef.current), currentPage);
        const baseSlot = readUiThemeSlot(merged, slot);
        const prevElement = currentPage.elements[targetKey] ?? { slot, label: targetLabel };
        const nextElement = normalizeElementOverrideAgainstBase(baseSlot, {
          ...prevElement,
          slot,
          label: targetLabel,
          shade,
        });

        const nextPage = normalizePageThemeOverrides({
          schemaVersion: 2,
          overrides: currentPage.overrides,
          elements: {
            ...currentPage.elements,
            ...(nextElement ? { [targetKey]: nextElement } : null),
          },
        });

        if (!nextElement) delete nextPage.elements[targetKey];
        commitPageOverride(nextPage);
        return;
      }

      commitPageOverride(
        normalizePageThemeOverrides({
          schemaVersion: 2,
          overrides: {
            ...currentPage.overrides,
            ...(slot === 'surface' ? { surfaceShade: shade } : null),
            ...(slot === 'panel' ? { panelShade: shade } : null),
            ...(slot === 'button' ? { buttonShade: shade } : null),
            ...(slot === 'cellBg' ? { cellBgShade: shade } : null),
            ...(slot === 'cellText' ? { cellTextShade: shade } : null),
            ...(slot === 'border' ? { borderShade: shade } : null),
            ...(slot === 'grid' ? { gridShade: shade } : null),
          },
          elements: currentPage.elements,
        }),
      );
    },
    [commitGlobalOverride, commitPageOverride],
  );

  const resetElementOverride = useCallback(() => {
    const targetKey = open?.targetKey;
    if (!targetKey) return;

    if (open?.scope === 'global') {
      const currentGlobal = globalOverrideRef.current;
      if (!currentGlobal.elements[targetKey]) return;

      const elements = { ...currentGlobal.elements };
      delete elements[targetKey];

      commitGlobalOverride(
        normalizePageThemeOverrides({
          schemaVersion: 2,
          overrides: currentGlobal.overrides,
          elements,
        }),
      );
      return;
    }

    const currentPage = pageOverrideRef.current;
    if (!currentPage.elements[targetKey]) return;

    const elements = { ...currentPage.elements };
    delete elements[targetKey];

    commitPageOverride(
      normalizePageThemeOverrides({
        schemaVersion: 2,
        overrides: currentPage.overrides,
        elements,
      }),
    );
  }, [commitGlobalOverride, commitPageOverride, open]);

  if (!enabled || !open) return null;

  const slot = open.slot;
  const baseSlot = readUiThemeSlot(current, slot);
  const elementOverride = open.targetKey
    ? open.scope === 'global'
      ? globalOverride.elements[open.targetKey] ?? pageOverride.elements[open.targetKey]
      : pageOverride.elements[open.targetKey] ?? globalOverride.elements[open.targetKey]
    : null;
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
            onChangeColor={(c) => setSlotColor(open.scope, slot, open.targetKey, open.targetLabel, c)}
            onChangeShade={(s) => setSlotShade(open.scope, slot, open.targetKey, open.targetLabel, s)}
          />
        </div>

        <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          {open.targetKey
            ? open.scope === 'global'
              ? '※ このヘッダーボタンだけ全ページで保存（アカウント別）'
              : `※ この要素だけ保存（ページ: ${pathname} / アカウント別）`
            : `※ このページ（${pathname}）にだけ保存（アカウント別）`}
        </div>
      </div>
    </div>
  );
}
