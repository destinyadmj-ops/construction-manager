export const SCHEDULE_CELL_ENTRY_KINDS = ['site', 'note'] as const;

export type ScheduleCellEntryKind = (typeof SCHEDULE_CELL_ENTRY_KINDS)[number];

export function isScheduleCellEntryKind(value: unknown): value is ScheduleCellEntryKind {
  return typeof value === 'string' && (SCHEDULE_CELL_ENTRY_KINDS as readonly string[]).includes(value);
}

export function normalizeScheduleCellEntryKind(value: unknown): ScheduleCellEntryKind {
  return isScheduleCellEntryKind(value) ? value : 'site';
}