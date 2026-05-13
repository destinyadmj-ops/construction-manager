export type StoredScheduleReturnTarget = 'desktop-week-hub' | 'mobile-week-hub';

export type StoredScheduleReturn = {
  target: StoredScheduleReturnTarget;
  href: string;
  state: unknown;
  updatedAt: number;
};

const STORED_SCHEDULE_RETURN_KEY = 'masterHub.lastScheduleReturn';
const FORCE_DESKTOP_WEEK_HOME_ONCE_KEY = 'masterHub.forceDesktopWeekHomeOnce';

function canUseSessionStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

export function getCurrentPathWithSearch() {
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname}${window.location.search}`;
}

export function readStoredScheduleReturn(): StoredScheduleReturn | null {
  if (!canUseSessionStorage()) return null;
  try {
    const raw = window.sessionStorage.getItem(STORED_SCHEDULE_RETURN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    const target = obj.target;
    const href = typeof obj.href === 'string' ? obj.href : '';
    const updatedAt = typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt) ? obj.updatedAt : 0;
    if ((target !== 'desktop-week-hub' && target !== 'mobile-week-hub') || !href) return null;
    return {
      target,
      href,
      state: obj.state,
      updatedAt,
    };
  } catch {
    return null;
  }
}

export function writeStoredScheduleReturn(input: {
  target: StoredScheduleReturnTarget;
  href: string;
  state: unknown;
}) {
  if (!canUseSessionStorage()) return;
  try {
    const payload: StoredScheduleReturn = {
      target: input.target,
      href: input.href,
      state: input.state,
      updatedAt: Date.now(),
    };
    window.sessionStorage.setItem(STORED_SCHEDULE_RETURN_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function markForceDesktopWeekHomeOnce() {
  if (!canUseSessionStorage()) return;
  try {
    window.sessionStorage.setItem(FORCE_DESKTOP_WEEK_HOME_ONCE_KEY, '1');
  } catch {
    // ignore
  }
}

export function consumeForceDesktopWeekHomeOnce() {
  if (!canUseSessionStorage()) return false;
  try {
    const hit = window.sessionStorage.getItem(FORCE_DESKTOP_WEEK_HOME_ONCE_KEY) === '1';
    if (hit) {
      window.sessionStorage.removeItem(FORCE_DESKTOP_WEEK_HOME_ONCE_KEY);
    }
    return hit;
  } catch {
    return false;
  }
}