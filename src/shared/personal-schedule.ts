export const PERSONAL_SCHEDULE_SLOT_COUNT = 5;

export const PERSONAL_SCHEDULE_COLOR_VALUES = [
  'emerald',
  'sky',
  'amber',
  'rose',
  'violet',
  'orange',
  'teal',
  'cyan',
  'lime',
  'indigo',
  'pink',
  'slate',
] as const;
export type PersonalScheduleColor = (typeof PERSONAL_SCHEDULE_COLOR_VALUES)[number];

export type PersonalScheduleItem = {
  id: string;
  dayYmd: string;
  slotIndex: number;
  title: string;
  note: string | null;
  color: PersonalScheduleColor;
  createdAt: string;
  updatedAt: string;
};

export type PersonalScheduleDay = {
  dayYmd: string;
  count: number;
  items: Array<PersonalScheduleItem | null>;
};

export type PersonalScheduleSummaryItem = Pick<PersonalScheduleItem, 'id' | 'slotIndex' | 'title' | 'note' | 'color'>;

export type PersonalScheduleSummaryDay = {
  count: number;
  items: PersonalScheduleSummaryItem[];
};

export const PERSONAL_SCHEDULE_COLOR_OPTIONS: Array<{ value: PersonalScheduleColor; label: string }> = [
  { value: 'emerald', label: '緑' },
  { value: 'sky', label: '青' },
  { value: 'amber', label: '黄' },
  { value: 'rose', label: '赤' },
  { value: 'violet', label: '紫' },
  { value: 'orange', label: '橙' },
  { value: 'teal', label: '青緑' },
  { value: 'cyan', label: '水' },
  { value: 'lime', label: '黄緑' },
  { value: 'indigo', label: '藍' },
  { value: 'pink', label: '桃' },
  { value: 'slate', label: '灰' },
];

const PERSONAL_SCHEDULE_SURFACE_CLASS: Record<PersonalScheduleColor, string> = {
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/80 dark:bg-emerald-950/40 dark:text-emerald-100',
  sky: 'border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900/80 dark:bg-sky-950/40 dark:text-sky-100',
  amber: 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/80 dark:bg-amber-950/40 dark:text-amber-100',
  rose: 'border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900/80 dark:bg-rose-950/40 dark:text-rose-100',
  violet: 'border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-900/80 dark:bg-violet-950/40 dark:text-violet-100',
  orange: 'border-orange-200 bg-orange-50 text-orange-950 dark:border-orange-900/80 dark:bg-orange-950/40 dark:text-orange-100',
  teal: 'border-teal-200 bg-teal-50 text-teal-950 dark:border-teal-900/80 dark:bg-teal-950/40 dark:text-teal-100',
  cyan: 'border-cyan-200 bg-cyan-50 text-cyan-950 dark:border-cyan-900/80 dark:bg-cyan-950/40 dark:text-cyan-100',
  lime: 'border-lime-200 bg-lime-50 text-lime-950 dark:border-lime-900/80 dark:bg-lime-950/40 dark:text-lime-100',
  indigo: 'border-indigo-200 bg-indigo-50 text-indigo-950 dark:border-indigo-900/80 dark:bg-indigo-950/40 dark:text-indigo-100',
  pink: 'border-pink-200 bg-pink-50 text-pink-950 dark:border-pink-900/80 dark:bg-pink-950/40 dark:text-pink-100',
  slate: 'border-slate-300 bg-slate-50 text-slate-950 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100',
};

const PERSONAL_SCHEDULE_SWATCH_CLASS: Record<PersonalScheduleColor, string> = {
  emerald: 'bg-emerald-500',
  sky: 'bg-sky-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  violet: 'bg-violet-500',
  orange: 'bg-orange-500',
  teal: 'bg-teal-500',
  cyan: 'bg-cyan-500',
  lime: 'bg-lime-500',
  indigo: 'bg-indigo-500',
  pink: 'bg-pink-500',
  slate: 'bg-slate-500',
};

export function personalScheduleSurfaceClass(color: PersonalScheduleColor) {
  return PERSONAL_SCHEDULE_SURFACE_CLASS[color] ?? PERSONAL_SCHEDULE_SURFACE_CLASS.emerald;
}

export function personalScheduleSwatchClass(color: PersonalScheduleColor) {
  return PERSONAL_SCHEDULE_SWATCH_CLASS[color] ?? PERSONAL_SCHEDULE_SWATCH_CLASS.emerald;
}

export function isPersonalScheduleColor(value: unknown): value is PersonalScheduleColor {
  return typeof value === 'string' && (PERSONAL_SCHEDULE_COLOR_VALUES as readonly string[]).includes(value);
}

export function normalizePersonalScheduleColor(
  value: unknown,
  fallback: PersonalScheduleColor = 'emerald',
): PersonalScheduleColor {
  return isPersonalScheduleColor(value) ? value : fallback;
}

export function normalizePersonalScheduleTitle(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 80) : '';
}

export function normalizePersonalScheduleNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().slice(0, 500);
  return normalized.length > 0 ? normalized : null;
}

export function isValidPersonalScheduleMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value);
}

export function isValidPersonalScheduleDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function buildPersonalScheduleMonthDays(month: string): string[] {
  if (!isValidPersonalScheduleMonth(month)) return [];
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) return [];
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    return `${yearText}-${monthText}-${String(day).padStart(2, '0')}`;
  });
}

export function createEmptyPersonalScheduleDay(dayYmd: string): PersonalScheduleDay {
  return {
    dayYmd,
    count: 0,
    items: Array.from({ length: PERSONAL_SCHEDULE_SLOT_COUNT }, () => null),
  };
}