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