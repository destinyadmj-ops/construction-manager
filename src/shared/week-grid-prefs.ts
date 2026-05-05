export const WEEK_GRID_PREFS_VERSION = 3;

export const WEEK_GRID_TEXT_COLOR_VALUES = ['default', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const;
export type WeekGridTextColor = (typeof WEEK_GRID_TEXT_COLOR_VALUES)[number];

export type WeekGridCellBg = 'default' | 'soft';

export type WeekGridPrefs = {
  gridLayout: 'compact' | 'comfortable';
  cellTextColor: WeekGridTextColor;
  cellBg: WeekGridCellBg;
  nameColW: number;
  cellMinW: number;
  cellMinHCompact: number;
  cellMinHComfortable: number;
};

export const DEFAULT_WEEK_GRID_PREFS: WeekGridPrefs = {
  gridLayout: 'compact',
  cellTextColor: 'default',
  cellBg: 'default',
  nameColW: 128,
  cellMinW: 112,
  cellMinHCompact: 48,
  cellMinHComfortable: 64,
};

export const WEEK_GRID_BG_OPTIONS: Array<{ value: WeekGridCellBg; label: string }> = [
  { value: 'default', label: '白' },
  { value: 'soft', label: '薄' },
];

export const WEEK_GRID_TEXT_COLOR_OPTIONS: Array<{ value: WeekGridTextColor; label: string }> = [
  { value: 'default', label: '通常' },
  { value: 'red', label: '赤' },
  { value: 'orange', label: '橙' },
  { value: 'yellow', label: '黄' },
  { value: 'green', label: '緑' },
  { value: 'blue', label: '青' },
  { value: 'purple', label: '紫' },
  { value: 'pink', label: '桃' },
];

export const WEEK_GRID_NAME_WIDTH_OPTIONS = [88, 96, 104, 112, 120, 128, 136, 144, 160, 176, 192, 224, 256] as const;
export const WEEK_GRID_DAY_WIDTH_OPTIONS = [60, 72, 84, 96, 108, 112, 124, 136, 148, 160, 176, 192, 224] as const;
export const WEEK_GRID_COMPACT_HEIGHT_OPTIONS = [32, 36, 40, 44, 48, 52, 56, 60, 64] as const;
export const WEEK_GRID_COMFORTABLE_HEIGHT_OPTIONS = [48, 56, 64, 72, 80, 88, 96, 112, 128] as const;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' ? (value as JsonObject) : null;
}

function clampInt(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function isWeekGridTextColor(value: unknown): value is WeekGridTextColor {
  return typeof value === 'string' && (WEEK_GRID_TEXT_COLOR_VALUES as readonly string[]).includes(value);
}

export function isWeekGridCellBg(value: unknown): value is WeekGridCellBg {
  return value === 'default' || value === 'soft';
}

export function clampNameColumnWidth(value: number) {
  return clampInt(value, 88, 280, DEFAULT_WEEK_GRID_PREFS.nameColW);
}

export function buildNameColumnTrack(width: number) {
  const clamped = clampNameColumnWidth(width);
  return `minmax(${clamped}px, ${clamped}px)`;
}

export function defaultWeekGridPrefs(): WeekGridPrefs {
  return { ...DEFAULT_WEEK_GRID_PREFS };
}

export function normalizeWeekGridPrefs(raw: unknown): WeekGridPrefs {
  const obj = asObject(raw);
  const gridLayout = obj?.gridLayout === 'comfortable' ? 'comfortable' : 'compact';
  const cellTextColor = isWeekGridTextColor(obj?.cellTextColor) ? obj.cellTextColor : DEFAULT_WEEK_GRID_PREFS.cellTextColor;
  const cellBg = isWeekGridCellBg(obj?.cellBg)
    ? obj.cellBg
    : typeof obj?.cellBgShade === 'number' && obj.cellBgShade > 0
      ? 'soft'
      : DEFAULT_WEEK_GRID_PREFS.cellBg;
  const nameColW = clampNameColumnWidth(typeof obj?.nameColW === 'number' ? obj.nameColW : Number.NaN);
  const cellMinW = clampInt(
    typeof obj?.cellMinW === 'number' ? obj.cellMinW : Number.NaN,
    60,
    240,
    DEFAULT_WEEK_GRID_PREFS.cellMinW,
  );
  const cellMinHCompact = clampInt(
    typeof obj?.cellMinHCompact === 'number' ? obj.cellMinHCompact : Number.NaN,
    32,
    120,
    DEFAULT_WEEK_GRID_PREFS.cellMinHCompact,
  );
  const cellMinHComfortableBase = clampInt(
    typeof obj?.cellMinHComfortable === 'number' ? obj.cellMinHComfortable : Number.NaN,
    40,
    180,
    DEFAULT_WEEK_GRID_PREFS.cellMinHComfortable,
  );

  return {
    gridLayout,
    cellTextColor,
    cellBg,
    nameColW,
    cellMinW,
    cellMinHCompact,
    cellMinHComfortable: Math.max(cellMinHCompact, cellMinHComfortableBase),
  };
}