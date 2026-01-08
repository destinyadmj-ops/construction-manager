'use client';

export const UI_THEME_SETTING_KEY = 'ui.theme.v1';

export const UI_THEME_COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const;
export type UiThemeColor = (typeof UI_THEME_COLORS)[number];

export function uiThemeColorLabel(c: UiThemeColor): string {
  switch (c) {
    case 'default':
      return '通常';
    case 'red':
      return '赤';
    case 'orange':
      return '橙';
    case 'yellow':
      return '黄';
    case 'green':
      return '緑';
    case 'blue':
      return '青';
    case 'purple':
      return '紫';
    case 'pink':
      return '桃';
  }
}

type ShadeStop = 0 | 25 | 50 | 75 | 100;

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
}
