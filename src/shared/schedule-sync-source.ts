export type ScheduleSyncSource = {
  parentUserId: string;
  parentDayYmd: string;
  familyKey: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function isScheduleSyncSource(value: unknown): value is ScheduleSyncSource {
  const source = asObject(value);
  if (!source) return false;

  const parentUserId = typeof source.parentUserId === 'string' ? source.parentUserId.trim() : '';
  const parentDayYmd = typeof source.parentDayYmd === 'string' ? source.parentDayYmd.trim() : '';
  const familyKey = typeof source.familyKey === 'string' ? source.familyKey.trim() : '';

  return Boolean(parentUserId) && /^\d{4}-\d{2}-\d{2}$/.test(parentDayYmd) && Boolean(familyKey);
}

export function cloneScheduleSyncSource(value: ScheduleSyncSource | null | undefined): ScheduleSyncSource | null {
  if (!isScheduleSyncSource(value)) return null;
  return {
    parentUserId: value.parentUserId,
    parentDayYmd: value.parentDayYmd,
    familyKey: value.familyKey,
  };
}

export function createScheduleSyncSource(input: {
  parentUserId: string | null | undefined;
  parentDayYmd: string | null | undefined;
  familyKey: string | null | undefined;
}): ScheduleSyncSource | null {
  const candidate = {
    parentUserId: input.parentUserId?.trim() ?? '',
    parentDayYmd: input.parentDayYmd?.trim() ?? '',
    familyKey: input.familyKey?.trim() ?? '',
  };
  return isScheduleSyncSource(candidate) ? candidate : null;
}

export function scheduleSyncSourceEquals(
  left: ScheduleSyncSource | null | undefined,
  right: ScheduleSyncSource | null | undefined,
): boolean {
  const a = cloneScheduleSyncSource(left);
  const b = cloneScheduleSyncSource(right);
  if (!a || !b) return !a && !b;
  return a.parentUserId === b.parentUserId && a.parentDayYmd === b.parentDayYmd && a.familyKey === b.familyKey;
}