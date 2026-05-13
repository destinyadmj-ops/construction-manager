export const SCHEDULE_CELL_ENTRY_KINDS = ['site', 'note'] as const;

export type ScheduleCellEntryKind = (typeof SCHEDULE_CELL_ENTRY_KINDS)[number];

export function isScheduleCellEntryKind(value: unknown): value is ScheduleCellEntryKind {
  return typeof value === 'string' && (SCHEDULE_CELL_ENTRY_KINDS as readonly string[]).includes(value);
}

export function normalizeScheduleCellEntryKind(value: unknown): ScheduleCellEntryKind {
  return isScheduleCellEntryKind(value) ? value : 'site';
}

export function normalizeScheduleCellNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function formatScheduleCellGroupDisplayValue(
  labels: Array<string | null | undefined>,
  note?: unknown,
): string | null {
  const normalizedLabels = labels
    .map((label) => (typeof label === 'string' ? label.trim() : ''))
    .filter((label): label is string => label.length > 0);
  const normalizedNote = normalizeScheduleCellNote(note);
  const base = normalizedLabels.join(' / ');
  if (!base) return normalizedNote ? `追記: ${normalizedNote}` : null;
  return normalizedNote ? `${base}（追記: ${normalizedNote}）` : base;
}