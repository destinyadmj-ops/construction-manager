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

const PERSONAL_SCHEDULE_SURFACE_STYLE: Record<
  PersonalScheduleColor,
  { backgroundColor: string; borderColor: string; color: string }
> = {
  emerald: { backgroundColor: '#10b981', borderColor: '#047857', color: '#ffffff' },
  sky: { backgroundColor: '#0ea5e9', borderColor: '#0369a1', color: '#ffffff' },
  amber: { backgroundColor: '#fbbf24', borderColor: '#d97706', color: '#451a03' },
  rose: { backgroundColor: '#f43f5e', borderColor: '#be123c', color: '#ffffff' },
  violet: { backgroundColor: '#8b5cf6', borderColor: '#6d28d9', color: '#ffffff' },
  orange: { backgroundColor: '#f97316', borderColor: '#c2410c', color: '#ffffff' },
  teal: { backgroundColor: '#14b8a6', borderColor: '#0f766e', color: '#ffffff' },
  cyan: { backgroundColor: '#22d3ee', borderColor: '#0e7490', color: '#083344' },
  lime: { backgroundColor: '#a3e635', borderColor: '#4d7c0f', color: '#1a2e05' },
  indigo: { backgroundColor: '#6366f1', borderColor: '#4338ca', color: '#ffffff' },
  pink: { backgroundColor: '#ec4899', borderColor: '#be185d', color: '#ffffff' },
  slate: { backgroundColor: '#64748b', borderColor: '#334155', color: '#ffffff' },
};

const PERSONAL_SCHEDULE_SURFACE_CLASS: Record<PersonalScheduleColor, string> = {
  emerald: 'border-emerald-700 bg-emerald-500 text-white hover:bg-emerald-600 dark:border-emerald-500 dark:bg-emerald-500 dark:text-white dark:hover:bg-emerald-400',
  sky: 'border-sky-700 bg-sky-500 text-white hover:bg-sky-600 dark:border-sky-500 dark:bg-sky-500 dark:text-white dark:hover:bg-sky-400',
  amber: 'border-amber-600 bg-amber-400 text-amber-950 hover:bg-amber-500 dark:border-amber-400 dark:bg-amber-400 dark:text-amber-950 dark:hover:bg-amber-300',
  rose: 'border-rose-700 bg-rose-500 text-white hover:bg-rose-600 dark:border-rose-500 dark:bg-rose-500 dark:text-white dark:hover:bg-rose-400',
  violet: 'border-violet-700 bg-violet-500 text-white hover:bg-violet-600 dark:border-violet-500 dark:bg-violet-500 dark:text-white dark:hover:bg-violet-400',
  orange: 'border-orange-700 bg-orange-500 text-white hover:bg-orange-600 dark:border-orange-500 dark:bg-orange-500 dark:text-white dark:hover:bg-orange-400',
  teal: 'border-teal-700 bg-teal-500 text-white hover:bg-teal-600 dark:border-teal-500 dark:bg-teal-500 dark:text-white dark:hover:bg-teal-400',
  cyan: 'border-cyan-700 bg-cyan-400 text-cyan-950 hover:bg-cyan-500 dark:border-cyan-500 dark:bg-cyan-400 dark:text-cyan-950 dark:hover:bg-cyan-300',
  lime: 'border-lime-700 bg-lime-400 text-lime-950 hover:bg-lime-500 dark:border-lime-500 dark:bg-lime-400 dark:text-lime-950 dark:hover:bg-lime-300',
  indigo: 'border-indigo-700 bg-indigo-500 text-white hover:bg-indigo-600 dark:border-indigo-500 dark:bg-indigo-500 dark:text-white dark:hover:bg-indigo-400',
  pink: 'border-pink-700 bg-pink-500 text-white hover:bg-pink-600 dark:border-pink-500 dark:bg-pink-500 dark:text-white dark:hover:bg-pink-400',
  slate: 'border-slate-700 bg-slate-500 text-white hover:bg-slate-600 dark:border-slate-500 dark:bg-slate-500 dark:text-white dark:hover:bg-slate-400',
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

export function personalScheduleSurfaceStyle(color: PersonalScheduleColor) {
  return PERSONAL_SCHEDULE_SURFACE_STYLE[color] ?? PERSONAL_SCHEDULE_SURFACE_STYLE.emerald;
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