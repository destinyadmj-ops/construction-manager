export type RepeatRule = {
  intervalMonths: number;
  weekdays: number[];
  monthDays: number[];
  monthsOfYear: number[];
};

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

function normalizeText(input: string | null | undefined) {
  return (input ?? '')
    .normalize('NFKC')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueSorted(values: number[], min: number, max: number) {
  return Array.from(new Set(values.filter((value) => Number.isFinite(value)).map((value) => Math.trunc(value))))
    .filter((value) => value >= min && value <= max)
    .sort((left, right) => left - right);
}

function parseMonthListSegment(segment: string) {
  const normalized = normalizeText(segment);
  if (!normalized) return [] as number[];
  if (normalized === '毎月') return [...ALL_MONTHS];
  if (normalized === '奇数月') return [1, 3, 5, 7, 9, 11];
  if (normalized === '偶数月') return [2, 4, 6, 8, 10, 12];

  const parts = normalized
    .replace(/月/g, '')
    .replace(/[，,]/g, '、')
    .split('、')
    .map((part) => normalizeText(part))
    .filter(Boolean);

  if (parts.length === 0) return [] as number[];
  if (!parts.every((part) => /^(?:[1-9]|1[0-2])$/.test(part))) return [] as number[];
  return uniqueSorted(parts.map((part) => Number(part)), 1, 12);
}

export function parsePaceMonths(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return [] as number[];

  const months: number[] = [];
  for (const segment of normalized.split(/[\/／]/)) {
    months.push(...parseMonthListSegment(segment));
  }
  return uniqueSorted(months, 1, 12);
}

export function formatPaceFromMonths(months: number[]) {
  const normalized = uniqueSorted(months, 1, 12);
  if (normalized.length === 0) return '';
  return normalized.map((month) => `${month}月`).join('、');
}

export function formatPaceText(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return '';

  const segments = normalized
    .split(/[\/／]/)
    .map((segment) => normalizeText(segment))
    .filter(Boolean)
    .map((segment) => {
      const months = parseMonthListSegment(segment);
      if (segment === '毎月' || segment === '奇数月' || segment === '偶数月') return segment;
      if (months.length > 0) return formatPaceFromMonths(months);
      return segment.replace(/[，,]/g, '、');
    });

  return segments.join(' / ');
}

export function parseRepeatRule(value: unknown): RepeatRule {
  const base: RepeatRule = { intervalMonths: 1, weekdays: [], monthDays: [], monthsOfYear: [] };
  if (!value || typeof value !== 'object') return base;
  const input = value as Record<string, unknown>;

  return {
    intervalMonths:
      typeof input.intervalMonths === 'number'
        ? Math.min(12, Math.max(1, Math.trunc(input.intervalMonths) || 1))
        : 1,
    weekdays: uniqueSorted(Array.isArray(input.weekdays) ? input.weekdays.filter((item) => typeof item === 'number') : [], 1, 7),
    monthDays: uniqueSorted(Array.isArray(input.monthDays) ? input.monthDays.filter((item) => typeof item === 'number') : [], 1, 31),
    monthsOfYear: uniqueSorted(
      Array.isArray(input.monthsOfYear) ? input.monthsOfYear.filter((item) => typeof item === 'number') : [],
      1,
      12,
    ),
  };
}

export function buildRepeatRuleWithPace(rule: unknown, pace: string | null | undefined): RepeatRule {
  const parsed = parseRepeatRule(rule);
  return {
    ...parsed,
    monthsOfYear: parsePaceMonths(pace),
  };
}

function monthIndex(date: Date) {
  return date.getFullYear() * 12 + date.getMonth();
}

export function hasConfiguredPace(rule: unknown, pace: string | null | undefined) {
  const parsed = parseRepeatRule(rule);
  return (
    parsed.intervalMonths > 1 ||
    parsed.weekdays.length > 0 ||
    parsed.monthDays.length > 0 ||
    parsed.monthsOfYear.length > 0 ||
    parsePaceMonths(pace).length > 0
  );
}

export function expectedCountForMonth(options: {
  rule: unknown;
  pace: string | null | undefined;
  monthStart: Date;
  monthEnd: Date;
  anchorDate?: Date | string | null;
}) {
  const parsed = parseRepeatRule(options.rule);
  const paceMonths = parsePaceMonths(options.pace);
  const monthsOfYear = parsed.monthsOfYear.length > 0 ? parsed.monthsOfYear : paceMonths;
  const currentMonth = options.monthStart.getMonth() + 1;

  if (monthsOfYear.length > 0 && !monthsOfYear.includes(currentMonth)) {
    return 0;
  }

  if (parsed.intervalMonths > 1 && options.anchorDate) {
    const anchor = new Date(options.anchorDate);
    if (!Number.isNaN(anchor.getTime())) {
      const diff = monthIndex(options.monthStart) - monthIndex(anchor);
      if (((diff % parsed.intervalMonths) + parsed.intervalMonths) % parsed.intervalMonths !== 0) {
        return 0;
      }
    }
  }

  const weekdaySet = new Set(parsed.weekdays);
  const monthDaySet = new Set(parsed.monthDays);
  if (weekdaySet.size === 0 && monthDaySet.size === 0) {
    return parsed.intervalMonths > 1 || monthsOfYear.length > 0 ? 1 : 0;
  }

  let count = 0;
  const seen = new Set<number>();
  const current = new Date(options.monthStart);
  current.setHours(0, 0, 0, 0);
  const end = new Date(options.monthEnd);
  end.setHours(0, 0, 0, 0);

  while (current < end) {
    const day = current.getDate();
    const jsDow = current.getDay();
    const dow = jsDow === 0 ? 7 : jsDow;
    if (monthDaySet.has(day) || weekdaySet.has(dow)) {
      const key = current.getTime();
      if (!seen.has(key)) {
        seen.add(key);
        count += 1;
      }
    }
    current.setDate(current.getDate() + 1);
  }

  return count;
}