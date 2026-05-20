export const PERSONAL_SCHEDULE_SLOT_COUNT = 5;

export const PERSONAL_SCHEDULE_COLOR_VALUES = ['emerald', 'sky', 'amber', 'rose', 'violet'] as const;
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
];

export function personalScheduleSurfaceClass(color: PersonalScheduleColor) {
  switch (color) {
    case 'sky':
      return 'border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-900/80 dark:bg-sky-950/40 dark:text-sky-100';
    case 'amber':
      return 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/80 dark:bg-amber-950/40 dark:text-amber-100';
    case 'rose':
      return 'border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-900/80 dark:bg-rose-950/40 dark:text-rose-100';
    case 'violet':
      return 'border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-900/80 dark:bg-violet-950/40 dark:text-violet-100';
    default:
      return 'border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/80 dark:bg-emerald-950/40 dark:text-emerald-100';
  }
}

export function personalScheduleSwatchClass(color: PersonalScheduleColor) {
  switch (color) {
    case 'sky':
      return 'bg-sky-500';
    case 'amber':
      return 'bg-amber-500';
    case 'rose':
      return 'bg-rose-500';
    case 'violet':
      return 'bg-violet-500';
    default:
      return 'bg-emerald-500';
  }
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