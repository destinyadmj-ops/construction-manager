import { Prisma } from '@/generated/prisma';

const SCHEDULE_CELL_NOTE_JSON_FILTER: Prisma.JsonNullableFilter<'WorkEntry'> = {
  path: ['scheduleEntryKind'],
  equals: 'note',
};

export function excludeScheduleCellNoteEntries(
  where: Prisma.WorkEntryWhereInput = {},
): Prisma.WorkEntryWhereInput {
  const andExisting = Array.isArray(where.AND)
    ? where.AND
    : where.AND
      ? [where.AND]
      : [];

  return {
    ...where,
    AND: [...andExisting, { NOT: [{ accountingMeta: SCHEDULE_CELL_NOTE_JSON_FILTER }] }],
  };
}