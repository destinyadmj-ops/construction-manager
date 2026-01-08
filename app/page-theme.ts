'use client';

import { normalizeUiTheme, type UiTheme, type UiThemeColor, UI_THEME_COLORS } from './ui-theme';
import { normalizeThemeShade } from './color-ramp';

export const PAGE_THEME_OVERRIDE_DB_KEY_PREFIX = 'ui.page-theme.v1:';

export type PageThemeOverridesV1 = {
  schemaVersion: 1;
  overrides: Partial<Omit<UiTheme, 'schemaVersion'>>;
};

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pickColor(v: unknown): UiThemeColor | undefined {
  return UI_THEME_COLORS.includes(v as UiThemeColor) ? (v as UiThemeColor) : undefined;
}

function pickBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function pickShade(v: unknown): number | undefined {
  if (typeof v !== 'number') return undefined;
  if (!Number.isFinite(v)) return undefined;
  return normalizeThemeShade(v, 0);
}

export function normalizePageThemeOverrides(value: unknown): PageThemeOverridesV1 {
  const o = asObject(value);
  const rawSchema = o?.schemaVersion;
  const schemaVersion = rawSchema === 1 ? 1 : 1;

  const rawOverrides = asObject(o?.overrides) ?? {};

  const overrides: PageThemeOverridesV1['overrides'] = {};

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

  return { schemaVersion, overrides };
}

export function pageThemeOverrideDbKey(pathname: string): string {
  const p = (pathname || '/').trim() || '/';
  return `${PAGE_THEME_OVERRIDE_DB_KEY_PREFIX}${p}`;
}

export function pageThemeOverrideLocalKey(userId: string | null, pathname: string): string {
  const p = (pathname || '/').trim() || '/';
  return `masterHub.ui:pageThemeOverride:${userId ?? 'anon'}:${p}`;
}

export function readLocalPageThemeOverride(userId: string | null, pathname: string): PageThemeOverridesV1 {
  try {
    const raw = window.localStorage.getItem(pageThemeOverrideLocalKey(userId, pathname));
    if (!raw) return { schemaVersion: 1, overrides: {} };
    return normalizePageThemeOverrides(JSON.parse(raw) as unknown);
  } catch {
    return { schemaVersion: 1, overrides: {} };
  }
}

export function writeLocalPageThemeOverride(userId: string | null, pathname: string, next: PageThemeOverridesV1): void {
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

export function mergeUiTheme(base: UiTheme, overrides: PageThemeOverridesV1): UiTheme {
  const b = normalizeUiTheme(base);
  const o = normalizePageThemeOverrides(overrides);
  return normalizeUiTheme({
    ...b,
    ...o.overrides,
    schemaVersion: 2,
  });
}
