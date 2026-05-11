'use client';

export const UI_THEME_SETTING_KEY = 'ui.theme.v1';

export const UI_THEME_COLORS = [
  'default',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'pink',
  'rose',
] as const;
export type UiThemeColor = (typeof UI_THEME_COLORS)[number];

export function uiThemeColorLabel(c: UiThemeColor): string {
  switch (c) {
    case 'default':
      return '通常';
    case 'red':
      return '赤';
    case 'orange':
      return '橙';
    case 'amber':
      return '黄橙';
    case 'yellow':
      return '黄';
    case 'lime':
      return '黄緑';
    case 'green':
      return '緑';
    case 'emerald':
      return 'エメラルド';
    case 'teal':
      return '青緑';
    case 'cyan':
      return 'シアン';
    case 'sky':
      return '空色';
    case 'blue':
      return '青';
    case 'indigo':
      return '藍';
    case 'violet':
      return '菫';
    case 'purple':
      return '紫';
    case 'pink':
      return '桃';
    case 'rose':
      return 'ローズ';
  }
}

type ShadeStop = 0 | 25 | 50 | 75 | 100;
type VisibleShadeStop = Exclude<ShadeStop, 0>;
type ThemeMode = 'light' | 'dark';
type ThemeScaleToken = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;
type ThemeScale = Record<ThemeScaleToken, string>;
type ToneTokenMap = Record<ThemeMode, Record<VisibleShadeStop, ThemeScaleToken>>;

const THEME_SCALES: Record<UiThemeColor, ThemeScale> = {
  default: {
    50: '#fafafa',
    100: '#f4f4f5',
    200: '#e4e4e7',
    300: '#d4d4d8',
    400: '#a1a1aa',
    500: '#71717a',
    600: '#52525b',
    700: '#3f3f46',
    800: '#27272a',
    900: '#18181b',
    950: '#09090b',
  },
  red: {
    50: '#fef2f2',
    100: '#fee2e2',
    200: '#fecaca',
    300: '#fca5a5',
    400: '#f87171',
    500: '#ef4444',
    600: '#dc2626',
    700: '#b91c1c',
    800: '#991b1b',
    900: '#7f1d1d',
    950: '#450a0a',
  },
  orange: {
    50: '#fff7ed',
    100: '#ffedd5',
    200: '#fed7aa',
    300: '#fdba74',
    400: '#fb923c',
    500: '#f97316',
    600: '#ea580c',
    700: '#c2410c',
    800: '#9a3412',
    900: '#7c2d12',
    950: '#431407',
  },
  amber: {
    50: '#fffbeb',
    100: '#fef3c7',
    200: '#fde68a',
    300: '#fcd34d',
    400: '#fbbf24',
    500: '#f59e0b',
    600: '#d97706',
    700: '#b45309',
    800: '#92400e',
    900: '#78350f',
    950: '#451a03',
  },
  yellow: {
    50: '#fefce8',
    100: '#fef9c3',
    200: '#fef08a',
    300: '#fde047',
    400: '#facc15',
    500: '#eab308',
    600: '#ca8a04',
    700: '#a16207',
    800: '#854d0e',
    900: '#713f12',
    950: '#422006',
  },
  lime: {
    50: '#f7fee7',
    100: '#ecfccb',
    200: '#d9f99d',
    300: '#bef264',
    400: '#a3e635',
    500: '#84cc16',
    600: '#65a30d',
    700: '#4d7c0f',
    800: '#3f6212',
    900: '#365314',
    950: '#1a2e05',
  },
  green: {
    50: '#f0fdf4',
    100: '#dcfce7',
    200: '#bbf7d0',
    300: '#86efac',
    400: '#4ade80',
    500: '#22c55e',
    600: '#16a34a',
    700: '#15803d',
    800: '#166534',
    900: '#14532d',
    950: '#052e16',
  },
  emerald: {
    50: '#ecfdf5',
    100: '#d1fae5',
    200: '#a7f3d0',
    300: '#6ee7b7',
    400: '#34d399',
    500: '#10b981',
    600: '#059669',
    700: '#047857',
    800: '#065f46',
    900: '#064e3b',
    950: '#022c22',
  },
  teal: {
    50: '#f0fdfa',
    100: '#ccfbf1',
    200: '#99f6e4',
    300: '#5eead4',
    400: '#2dd4bf',
    500: '#14b8a6',
    600: '#0d9488',
    700: '#0f766e',
    800: '#115e59',
    900: '#134e4a',
    950: '#042f2e',
  },
  cyan: {
    50: '#ecfeff',
    100: '#cffafe',
    200: '#a5f3fc',
    300: '#67e8f9',
    400: '#22d3ee',
    500: '#06b6d4',
    600: '#0891b2',
    700: '#0e7490',
    800: '#155e75',
    900: '#164e63',
    950: '#083344',
  },
  sky: {
    50: '#f0f9ff',
    100: '#e0f2fe',
    200: '#bae6fd',
    300: '#7dd3fc',
    400: '#38bdf8',
    500: '#0ea5e9',
    600: '#0284c7',
    700: '#0369a1',
    800: '#075985',
    900: '#0c4a6e',
    950: '#082f49',
  },
  blue: {
    50: '#eff6ff',
    100: '#dbeafe',
    200: '#bfdbfe',
    300: '#93c5fd',
    400: '#60a5fa',
    500: '#3b82f6',
    600: '#2563eb',
    700: '#1d4ed8',
    800: '#1e40af',
    900: '#1e3a8a',
    950: '#172554',
  },
  indigo: {
    50: '#eef2ff',
    100: '#e0e7ff',
    200: '#c7d2fe',
    300: '#a5b4fc',
    400: '#818cf8',
    500: '#6366f1',
    600: '#4f46e5',
    700: '#4338ca',
    800: '#3730a3',
    900: '#312e81',
    950: '#1e1b4b',
  },
  violet: {
    50: '#f5f3ff',
    100: '#ede9fe',
    200: '#ddd6fe',
    300: '#c4b5fd',
    400: '#a78bfa',
    500: '#8b5cf6',
    600: '#7c3aed',
    700: '#6d28d9',
    800: '#5b21b6',
    900: '#4c1d95',
    950: '#2e1065',
  },
  purple: {
    50: '#faf5ff',
    100: '#f3e8ff',
    200: '#e9d5ff',
    300: '#d8b4fe',
    400: '#c084fc',
    500: '#a855f7',
    600: '#9333ea',
    700: '#7e22ce',
    800: '#6b21a8',
    900: '#581c87',
    950: '#3b0764',
  },
  pink: {
    50: '#fdf2f8',
    100: '#fce7f3',
    200: '#fbcfe8',
    300: '#f9a8d4',
    400: '#f472b6',
    500: '#ec4899',
    600: '#db2777',
    700: '#be185d',
    800: '#9d174d',
    900: '#831843',
    950: '#500724',
  },
  rose: {
    50: '#fff1f2',
    100: '#ffe4e6',
    200: '#fecdd3',
    300: '#fda4af',
    400: '#fb7185',
    500: '#f43f5e',
    600: '#e11d48',
    700: '#be123c',
    800: '#9f1239',
    900: '#881337',
    950: '#4c0519',
  },
};

const BACKGROUND_TOKENS: ToneTokenMap = {
  light: { 25: 50, 50: 100, 75: 200, 100: 300 },
  dark: { 25: 950, 50: 900, 75: 800, 100: 700 },
};

const BORDER_TOKENS: ToneTokenMap = {
  light: { 25: 200, 50: 300, 75: 400, 100: 500 },
  dark: { 25: 800, 50: 700, 75: 600, 100: 500 },
};

const CELL_TEXT_TOKENS: ToneTokenMap = {
  light: { 25: 700, 50: 600, 75: 500, 100: 400 },
  dark: { 25: 300, 50: 200, 75: 100, 100: 50 },
};

const BUTTON_TEXT_TOKENS: ToneTokenMap = {
  light: { 25: 700, 50: 700, 75: 800, 100: 900 },
  dark: { 25: 200, 50: 100, 75: 100, 100: 50 },
};

const ACCENT_BORDER_TOKENS: Record<ThemeMode, ThemeScaleToken> = {
  light: 500,
  dark: 400,
};

const ACCENT_TEXT_TOKENS: Record<ThemeMode, ThemeScaleToken> = {
  light: 700,
  dark: 300,
};

function clampInt(n: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeShade(raw: unknown, fallback: number): number {
  return clampInt(typeof raw === 'number' ? raw : NaN, 0, 100, fallback);
}

function shadeToStop(shade: number): ShadeStop {
  const s = clampInt(shade, 0, 100, 0);
  if (s <= 12) return 0;
  if (s <= 37) return 25;
  if (s <= 62) return 50;
  if (s <= 87) return 75;
  return 100;
}

function themeScaleValue(color: UiThemeColor, token: ThemeScaleToken): string {
  return THEME_SCALES[color][token];
}

function resolveStoppedTone(color: UiThemeColor, stop: ShadeStop, mode: ThemeMode, tokens: ToneTokenMap): string | null {
  if (color === 'default' || stop === 0) return null;
  return themeScaleValue(color, tokens[mode][stop]);
}

function resolveDefaultTone(stop: ShadeStop, mode: ThemeMode, tokens: ToneTokenMap): string | null {
  if (stop === 0) return null;
  return themeScaleValue('default', tokens[mode][stop]);
}

function resolveAccentTone(color: UiThemeColor, mode: ThemeMode, tokens: Record<ThemeMode, ThemeScaleToken>): string | null {
  if (color === 'default') return null;
  return themeScaleValue(color, tokens[mode]);
}

export type UiThemeV1 = {
  schemaVersion: 1;
  gridStrongLines: boolean;
  borderStrong: boolean;

  surfaceSoft: boolean;
  panelSoft: boolean;
  buttonSoft: boolean;

  buttonPrimaryColor: UiThemeColor;
  buttonDangerColor: UiThemeColor;

  alertInvoiceColor: UiThemeColor;
  alertReportColor: UiThemeColor;
  alertUnassignedColor: UiThemeColor;
};

export type UiThemeV2 = {
  schemaVersion: 2;
  gridStrongLines: boolean;
  borderStrong: boolean;

  gridColor: UiThemeColor;
  gridShade: number;
  borderColor: UiThemeColor;
  borderShade: number;

  surfaceColor: UiThemeColor;
  surfaceShade: number;
  panelColor: UiThemeColor;
  panelShade: number;
  buttonColor: UiThemeColor;
  buttonShade: number;

  cellBgColor: UiThemeColor;
  cellBgShade: number;
  cellTextColor: UiThemeColor;
  cellTextShade: number;

  buttonPrimaryColor: UiThemeColor;
  buttonDangerColor: UiThemeColor;

  alertInvoiceColor: UiThemeColor;
  alertReportColor: UiThemeColor;
  alertUnassignedColor: UiThemeColor;
};

export type UiTheme = UiThemeV2;

export function defaultUiTheme(): UiTheme {
  return {
    schemaVersion: 2,
    gridStrongLines: true,
    borderStrong: true,

    gridColor: 'default',
    gridShade: 0,
    borderColor: 'default',
    borderShade: 0,

    surfaceColor: 'default',
    surfaceShade: 0,
    panelColor: 'default',
    panelShade: 0,
    buttonColor: 'default',
    buttonShade: 0,

    cellBgColor: 'default',
    cellBgShade: 0,
    cellTextColor: 'default',
    cellTextShade: 0,

    buttonPrimaryColor: 'default',
    buttonDangerColor: 'red',

    alertInvoiceColor: 'red',
    alertReportColor: 'yellow',
    alertUnassignedColor: 'green',
  };
}

export function normalizeUiTheme(value: unknown): UiTheme {
  const d = defaultUiTheme();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return d;
  const o = value as Record<string, unknown>;
  const schemaVersion = o.schemaVersion === 2 ? 2 : 1;

  const gridStrongLines = typeof o.gridStrongLines === 'boolean' ? o.gridStrongLines : d.gridStrongLines;
  const borderStrong = typeof o.borderStrong === 'boolean' ? o.borderStrong : d.borderStrong;

  const gridColor = UI_THEME_COLORS.includes(o.gridColor as UiThemeColor) ? (o.gridColor as UiThemeColor) : d.gridColor;
  const borderColor = UI_THEME_COLORS.includes(o.borderColor as UiThemeColor)
    ? (o.borderColor as UiThemeColor)
    : d.borderColor;

  const gridShade = normalizeShade(o.gridShade, d.gridShade);
  const borderShade = normalizeShade(o.borderShade, d.borderShade);

  const buttonPrimaryColor = UI_THEME_COLORS.includes(o.buttonPrimaryColor as UiThemeColor)
    ? (o.buttonPrimaryColor as UiThemeColor)
    : d.buttonPrimaryColor;
  const buttonDangerColor = UI_THEME_COLORS.includes(o.buttonDangerColor as UiThemeColor)
    ? (o.buttonDangerColor as UiThemeColor)
    : d.buttonDangerColor;

  const alertInvoiceColor = UI_THEME_COLORS.includes(o.alertInvoiceColor as UiThemeColor)
    ? (o.alertInvoiceColor as UiThemeColor)
    : d.alertInvoiceColor;
  const alertReportColor = UI_THEME_COLORS.includes(o.alertReportColor as UiThemeColor)
    ? (o.alertReportColor as UiThemeColor)
    : d.alertReportColor;
  const alertUnassignedColor = UI_THEME_COLORS.includes(o.alertUnassignedColor as UiThemeColor)
    ? (o.alertUnassignedColor as UiThemeColor)
    : d.alertUnassignedColor;

  if (schemaVersion === 1) {
    const surfaceSoft = typeof o.surfaceSoft === 'boolean' ? o.surfaceSoft : false;
    const panelSoft = typeof o.panelSoft === 'boolean' ? o.panelSoft : false;
    const buttonSoft = typeof o.buttonSoft === 'boolean' ? o.buttonSoft : false;

    return {
      schemaVersion: 2,
      gridStrongLines,
      borderStrong,
      gridColor,
      gridShade,
      borderColor,
      borderShade,
      surfaceColor: 'default',
      surfaceShade: surfaceSoft ? 25 : 0,
      panelColor: 'default',
      panelShade: panelSoft ? 25 : 0,
      buttonColor: 'default',
      buttonShade: buttonSoft ? 25 : 0,
      cellBgColor: 'default',
      cellBgShade: 0,
      cellTextColor: 'default',
      cellTextShade: 0,
      buttonPrimaryColor,
      buttonDangerColor,
      alertInvoiceColor,
      alertReportColor,
      alertUnassignedColor,
    };
  }

  const surfaceColor = UI_THEME_COLORS.includes(o.surfaceColor as UiThemeColor)
    ? (o.surfaceColor as UiThemeColor)
    : d.surfaceColor;
  const panelColor = UI_THEME_COLORS.includes(o.panelColor as UiThemeColor) ? (o.panelColor as UiThemeColor) : d.panelColor;
  const buttonColor = UI_THEME_COLORS.includes(o.buttonColor as UiThemeColor)
    ? (o.buttonColor as UiThemeColor)
    : d.buttonColor;
  const cellBgColor = UI_THEME_COLORS.includes(o.cellBgColor as UiThemeColor)
    ? (o.cellBgColor as UiThemeColor)
    : d.cellBgColor;
  const cellTextColor = UI_THEME_COLORS.includes(o.cellTextColor as UiThemeColor)
    ? (o.cellTextColor as UiThemeColor)
    : d.cellTextColor;

  const surfaceShade = normalizeShade(o.surfaceShade, d.surfaceShade);
  const panelShade = normalizeShade(o.panelShade, d.panelShade);
  const buttonShade = normalizeShade(o.buttonShade, d.buttonShade);
  const cellBgShade = normalizeShade(o.cellBgShade, d.cellBgShade);
  const cellTextShade = normalizeShade(o.cellTextShade, d.cellTextShade);

  return {
    schemaVersion: 2,
    gridStrongLines,
    borderStrong,
    gridColor,
    gridShade,
    borderColor,
    borderShade,
    surfaceColor,
    surfaceShade,
    panelColor,
    panelShade,
    buttonColor,
    buttonShade,
    cellBgColor,
    cellBgShade,
    cellTextColor,
    cellTextShade,
    buttonPrimaryColor,
    buttonDangerColor,
    alertInvoiceColor,
    alertReportColor,
    alertUnassignedColor,
  };
}

export function localUiThemeKey(userId: string | null): string {
  return `masterHub.ui:uiTheme:${userId ?? 'anon'}`;
}

export function readLocalUiTheme(userId: string | null): UiTheme {
  try {
    const raw = window.localStorage.getItem(localUiThemeKey(userId));
    if (!raw) return defaultUiTheme();
    return normalizeUiTheme(JSON.parse(raw) as unknown);
  } catch {
    return defaultUiTheme();
  }
}

export function writeLocalUiTheme(userId: string | null, next: UiTheme): void {
  try {
    window.localStorage.setItem(localUiThemeKey(userId), JSON.stringify(next));
  } catch {
    // ignore
  }
}

function setOneOf(root: HTMLElement, prefix: string, value: string) {
  for (const c of Array.from(root.classList)) {
    if (c.startsWith(prefix)) root.classList.remove(c);
  }
  root.classList.add(`${prefix}${value}`);
}

function setCssVar(root: HTMLElement, name: string, value: string | null): void {
  if (value) root.style.setProperty(name, value);
  else root.style.removeProperty(name);
}

function applyUiThemeCssVars(
  root: HTMLElement,
  theme: UiTheme,
  stops: {
    surfaceStop: ShadeStop;
    panelStop: ShadeStop;
    buttonStop: ShadeStop;
    cellBgStop: ShadeStop;
    cellTextStop: ShadeStop;
    gridStop: ShadeStop;
    borderStop: ShadeStop;
  },
): void {
  setCssVar(root, '--mh-surface-bg-light', resolveStoppedTone(theme.surfaceColor, stops.surfaceStop, 'light', BACKGROUND_TOKENS));
  setCssVar(root, '--mh-surface-bg-dark', resolveStoppedTone(theme.surfaceColor, stops.surfaceStop, 'dark', BACKGROUND_TOKENS));

  setCssVar(root, '--mh-panel-bg-light', resolveStoppedTone(theme.panelColor, stops.panelStop, 'light', BACKGROUND_TOKENS));
  setCssVar(root, '--mh-panel-bg-dark', resolveStoppedTone(theme.panelColor, stops.panelStop, 'dark', BACKGROUND_TOKENS));

  setCssVar(root, '--mh-button-bg-light', resolveStoppedTone(theme.buttonColor, stops.buttonStop, 'light', BACKGROUND_TOKENS));
  setCssVar(root, '--mh-button-bg-dark', resolveStoppedTone(theme.buttonColor, stops.buttonStop, 'dark', BACKGROUND_TOKENS));
  setCssVar(root, '--mh-button-border-light', resolveStoppedTone(theme.buttonColor, stops.buttonStop, 'light', BORDER_TOKENS));
  setCssVar(root, '--mh-button-border-dark', resolveStoppedTone(theme.buttonColor, stops.buttonStop, 'dark', BORDER_TOKENS));
  setCssVar(root, '--mh-button-text-light', resolveDefaultTone(stops.buttonStop, 'light', BUTTON_TEXT_TOKENS));
  setCssVar(root, '--mh-button-text-dark', resolveDefaultTone(stops.buttonStop, 'dark', BUTTON_TEXT_TOKENS));

  setCssVar(root, '--mh-cell-bg-light', resolveStoppedTone(theme.cellBgColor, stops.cellBgStop, 'light', BACKGROUND_TOKENS));
  setCssVar(root, '--mh-cell-bg-dark', resolveStoppedTone(theme.cellBgColor, stops.cellBgStop, 'dark', BACKGROUND_TOKENS));
  setCssVar(root, '--mh-cell-text-light', resolveStoppedTone(theme.cellTextColor, stops.cellTextStop, 'light', CELL_TEXT_TOKENS));
  setCssVar(root, '--mh-cell-text-dark', resolveStoppedTone(theme.cellTextColor, stops.cellTextStop, 'dark', CELL_TEXT_TOKENS));

  setCssVar(root, '--mh-border-line-light', resolveStoppedTone(theme.borderColor, stops.borderStop, 'light', BORDER_TOKENS));
  setCssVar(root, '--mh-border-line-dark', resolveStoppedTone(theme.borderColor, stops.borderStop, 'dark', BORDER_TOKENS));
  setCssVar(root, '--mh-grid-line-light', resolveStoppedTone(theme.gridColor, stops.gridStop, 'light', BORDER_TOKENS));
  setCssVar(root, '--mh-grid-line-dark', resolveStoppedTone(theme.gridColor, stops.gridStop, 'dark', BORDER_TOKENS));

  setCssVar(root, '--mh-btn-primary-border-light', resolveAccentTone(theme.buttonPrimaryColor, 'light', ACCENT_BORDER_TOKENS));
  setCssVar(root, '--mh-btn-primary-border-dark', resolveAccentTone(theme.buttonPrimaryColor, 'dark', ACCENT_BORDER_TOKENS));
  setCssVar(root, '--mh-btn-primary-text-light', resolveAccentTone(theme.buttonPrimaryColor, 'light', ACCENT_TEXT_TOKENS));
  setCssVar(root, '--mh-btn-primary-text-dark', resolveAccentTone(theme.buttonPrimaryColor, 'dark', ACCENT_TEXT_TOKENS));

  setCssVar(root, '--mh-btn-danger-border-light', resolveAccentTone(theme.buttonDangerColor, 'light', ACCENT_BORDER_TOKENS));
  setCssVar(root, '--mh-btn-danger-border-dark', resolveAccentTone(theme.buttonDangerColor, 'dark', ACCENT_BORDER_TOKENS));
  setCssVar(root, '--mh-btn-danger-text-light', resolveAccentTone(theme.buttonDangerColor, 'light', ACCENT_TEXT_TOKENS));
  setCssVar(root, '--mh-btn-danger-text-dark', resolveAccentTone(theme.buttonDangerColor, 'dark', ACCENT_TEXT_TOKENS));

  setCssVar(root, '--mh-alert-invoice-light', resolveAccentTone(theme.alertInvoiceColor, 'light', ACCENT_BORDER_TOKENS));
  setCssVar(root, '--mh-alert-invoice-dark', resolveAccentTone(theme.alertInvoiceColor, 'dark', ACCENT_BORDER_TOKENS));
  setCssVar(root, '--mh-alert-report-light', resolveAccentTone(theme.alertReportColor, 'light', ACCENT_BORDER_TOKENS));
  setCssVar(root, '--mh-alert-report-dark', resolveAccentTone(theme.alertReportColor, 'dark', ACCENT_BORDER_TOKENS));
  setCssVar(root, '--mh-alert-unassigned-light', resolveAccentTone(theme.alertUnassignedColor, 'light', ACCENT_BORDER_TOKENS));
  setCssVar(root, '--mh-alert-unassigned-dark', resolveAccentTone(theme.alertUnassignedColor, 'dark', ACCENT_BORDER_TOKENS));
}

export function applyUiTheme(theme: UiTheme): void {
  const root = document.documentElement;
  root.classList.toggle('mh-grid-strong', !!theme.gridStrongLines);
  root.classList.toggle('mh-border-strong', !!theme.borderStrong);

  const t = normalizeUiTheme(theme);
  const surfaceStop = shadeToStop(t.surfaceShade);
  const panelStop = shadeToStop(t.panelShade);
  const buttonStop = shadeToStop(t.buttonShade);
  const cellBgStop = shadeToStop(t.cellBgShade);
  const cellTextStop = shadeToStop(t.cellTextShade);
  const gridStop = shadeToStop(t.gridShade);
  const borderStop = shadeToStop(t.borderShade);

  // legacy toggles (旧CSS互換)
  root.classList.toggle('mh-surface-soft', surfaceStop !== 0);
  root.classList.remove('mh-panel-soft');
  root.classList.toggle('mh-button-soft', buttonStop !== 0);

  setOneOf(root, 'mh-grid-color-', `${t.gridColor}-${gridStop}`);
  setOneOf(root, 'mh-border-color-', `${t.borderColor}-${borderStop}`);

  // Cleanup legacy per-element border classes (old behavior) to avoid mixed modes.
  const borders = document.querySelectorAll<HTMLElement>("[data-color-edit-slot='border']");
  for (const el of Array.from(borders)) {
    el.classList.remove('mh-border-strong');
    for (const c of Array.from(el.classList)) {
      if (c.startsWith('mh-border-color-')) el.classList.remove(c);
    }
  }

  setOneOf(root, 'mh-surface-', `${t.surfaceColor}-${surfaceStop}`);
  // Panel theming is scoped: apply to explicit panel containers only.
  for (const c of Array.from(root.classList)) {
    if (c.startsWith('mh-panel-')) root.classList.remove(c);
  }

  const panels = document.querySelectorAll<HTMLElement>("[data-color-edit-slot='panel']");
  for (const el of Array.from(panels)) {
    el.classList.toggle('mh-panel-soft', panelStop !== 0);
    setOneOf(el, 'mh-panel-', `${t.panelColor}-${panelStop}`);
  }
  setOneOf(root, 'mh-button-', `${t.buttonColor}-${buttonStop}`);
  setOneOf(root, 'mh-cell-bg-', `${t.cellBgColor}-${cellBgStop}`);
  setOneOf(root, 'mh-cell-text-', `${t.cellTextColor}-${cellTextStop}`);

  setOneOf(root, 'mh-alert-invoice-', t.alertInvoiceColor);
  setOneOf(root, 'mh-alert-report-', t.alertReportColor);
  setOneOf(root, 'mh-alert-unassigned-', t.alertUnassignedColor);

  setOneOf(root, 'mh-btn-primary-', t.buttonPrimaryColor);
  setOneOf(root, 'mh-btn-danger-', t.buttonDangerColor);

  applyUiThemeCssVars(root, t, {
    surfaceStop,
    panelStop,
    buttonStop,
    cellBgStop,
    cellTextStop,
    gridStop,
    borderStop,
  });
}
