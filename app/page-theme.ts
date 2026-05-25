'use client';

import { normalizeUiTheme, type UiTheme, type UiThemeColor, type UiThemeEditableSlot, UI_THEME_COLORS } from './ui-theme';
import { normalizeThemeShade } from './color-ramp';

export const PAGE_THEME_OVERRIDE_DB_KEY_PREFIX = 'ui.page-theme.v1:';
export const GLOBAL_THEME_OVERRIDE_DB_KEY = 'ui.page-theme.global.v1';

export type PageThemeElementOverride = {
  slot: UiThemeEditableSlot;
  color?: UiThemeColor;
  shade?: number;
  label?: string;
};

export type PageThemeOverrides = {
  schemaVersion: 2;
  overrides: Partial<Omit<UiTheme, 'schemaVersion'>>;
  elements: Record<string, PageThemeElementOverride>;
};

export function emptyPageThemeOverrides(): PageThemeOverrides {
  return { schemaVersion: 2, overrides: {}, elements: {} };
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pickColor(v: unknown): UiThemeColor | undefined {
  return UI_THEME_COLORS.includes(v as UiThemeColor) ? (v as UiThemeColor) : undefined;
}

function pickSlot(v: unknown): UiThemeEditableSlot | undefined {
  switch (v) {
    case 'surface':
    case 'panel':
    case 'button':
    case 'cellBg':
    case 'cellText':
    case 'border':
    case 'grid':
      return v;
    default:
      return undefined;
  }
}

function pickBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function pickShade(v: unknown): number | undefined {
  if (typeof v !== 'number') return undefined;
  if (!Number.isFinite(v)) return undefined;
  return normalizeThemeShade(v, 0);
}

function canonicalizePageThemeElementKey(key: string): string {
  return key.trim().replace(/header-action-save/g, 'header-action-add');
}

function normalizePageThemeElementOverride(value: unknown): PageThemeElementOverride | null {
  const raw = asObject(value);
  if (!raw) return null;

  const slot = pickSlot(raw.slot);
  if (!slot) return null;

  const color = pickColor(raw.color);
  const shade = pickShade(raw.shade);
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 80) : undefined;

  if (!color && typeof shade !== 'number') return null;

  return {
    slot,
    ...(color ? { color } : null),
    ...(typeof shade === 'number' ? { shade } : null),
    ...(label ? { label } : null),
  };
}

export function normalizePageThemeOverrides(value: unknown): PageThemeOverrides {
  const o = asObject(value);

  const rawOverrides = asObject(o?.overrides) ?? {};
  const rawElements = asObject(o?.elements) ?? {};

  const overrides: PageThemeOverrides['overrides'] = {};
  const elements: PageThemeOverrides['elements'] = {};

  const gridStrongLines = pickBool(rawOverrides.gridStrongLines);
  const borderStrong = pickBool(rawOverrides.borderStrong);
  if (typeof gridStrongLines === 'boolean') overrides.gridStrongLines = gridStrongLines;
  if (typeof borderStrong === 'boolean') overrides.borderStrong = borderStrong;

  const surfaceColor = pickColor(rawOverrides.surfaceColor);
  const panelColor = pickColor(rawOverrides.panelColor);
  const buttonColor = pickColor(rawOverrides.buttonColor);
  const cellBgColor = pickColor(rawOverrides.cellBgColor);
  const cellTextColor = pickColor(rawOverrides.cellTextColor);
  const gridColor = pickColor(rawOverrides.gridColor);
  const borderColor = pickColor(rawOverrides.borderColor);

  if (surfaceColor) overrides.surfaceColor = surfaceColor;
  if (panelColor) overrides.panelColor = panelColor;
  if (buttonColor) overrides.buttonColor = buttonColor;
  if (cellBgColor) overrides.cellBgColor = cellBgColor;
  if (cellTextColor) overrides.cellTextColor = cellTextColor;
  if (gridColor) overrides.gridColor = gridColor;
  if (borderColor) overrides.borderColor = borderColor;

  const surfaceShade = pickShade(rawOverrides.surfaceShade);
  const panelShade = pickShade(rawOverrides.panelShade);
  const buttonShade = pickShade(rawOverrides.buttonShade);
  const cellBgShade = pickShade(rawOverrides.cellBgShade);
  const cellTextShade = pickShade(rawOverrides.cellTextShade);
  const gridShade = pickShade(rawOverrides.gridShade);
  const borderShade = pickShade(rawOverrides.borderShade);

  if (typeof surfaceShade === 'number') overrides.surfaceShade = surfaceShade;
  if (typeof panelShade === 'number') overrides.panelShade = panelShade;
  if (typeof buttonShade === 'number') overrides.buttonShade = buttonShade;
  if (typeof cellBgShade === 'number') overrides.cellBgShade = cellBgShade;
  if (typeof cellTextShade === 'number') overrides.cellTextShade = cellTextShade;
  if (typeof gridShade === 'number') overrides.gridShade = gridShade;
  if (typeof borderShade === 'number') overrides.borderShade = borderShade;

  for (const [key, rawElement] of Object.entries(rawElements)) {
    const normalized = normalizePageThemeElementOverride(rawElement);
    if (!normalized) continue;
    const trimmedKey = canonicalizePageThemeElementKey(key);
    if (!trimmedKey) continue;
    elements[trimmedKey] = normalized;
  }

  return { schemaVersion: 2, overrides, elements };
}

export function globalThemeOverrideDbKey(): string {
  return GLOBAL_THEME_OVERRIDE_DB_KEY;
}

export function pageThemeOverrideDbKey(pathname: string): string {
  const p = (pathname || '/').trim() || '/';
  return `${PAGE_THEME_OVERRIDE_DB_KEY_PREFIX}${p}`;
}

export function globalThemeOverrideLocalKey(): string {
  return `masterHub.ui:globalThemeOverride`;
}

export function pageThemeOverrideLocalKey(userId: string | null, pathname: string): string {
  const p = (pathname || '/').trim() || '/';
  return `masterHub.ui:pageThemeOverride:${userId ?? 'anon'}:${p}`;
}

export function readLocalGlobalThemeOverride(): PageThemeOverrides {
  try {
    const raw = window.localStorage.getItem(globalThemeOverrideLocalKey());
    if (!raw) return emptyPageThemeOverrides();
    return normalizePageThemeOverrides(JSON.parse(raw) as unknown);
  } catch {
    return emptyPageThemeOverrides();
  }
}

export function readLocalPageThemeOverride(userId: string | null, pathname: string): PageThemeOverrides {
  try {
    const raw = window.localStorage.getItem(pageThemeOverrideLocalKey(userId, pathname));
    if (!raw) return emptyPageThemeOverrides();
    return normalizePageThemeOverrides(JSON.parse(raw) as unknown);
  } catch {
    return emptyPageThemeOverrides();
  }
}

export function writeLocalGlobalThemeOverride(next: PageThemeOverrides): void {
  try {
    window.localStorage.setItem(globalThemeOverrideLocalKey(), JSON.stringify(next));
    window.dispatchEvent(
      new CustomEvent('masterHub:globalThemeOverrideUpdated', {
        detail: { userId: 'global' },
      }),
    );
  } catch {
    // ignore
  }
}

export function writeLocalPageThemeOverride(userId: string | null, pathname: string, next: PageThemeOverrides): void {
  try {
    window.localStorage.setItem(pageThemeOverrideLocalKey(userId, pathname), JSON.stringify(next));
    window.dispatchEvent(
      new CustomEvent('masterHub:pageThemeOverrideUpdated', {
        detail: { userId: userId ?? 'anon', pathname },
      }),
    );
  } catch {
    // ignore
  }
}

export function mergeUiTheme(base: UiTheme, overrides: PageThemeOverrides): UiTheme {
  const b = normalizeUiTheme(base);
  const o = normalizePageThemeOverrides(overrides);
  return normalizeUiTheme({
    ...b,
    ...o.overrides,
    schemaVersion: 2,
  });
}
