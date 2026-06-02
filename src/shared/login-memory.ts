const LOGIN_MEMORY_KEY = 'masterHub.loginMemory.v1';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null;
}

function getString(obj: JsonObject | null, key: string): string | null {
  if (!obj) return null;
  const value = obj[key];
  return typeof value === 'string' ? value : null;
}

function getCurrentDeviceContext() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null;
  return {
    host: window.location.host,
    platform: (navigator.platform ?? '').trim(),
    language: (navigator.language ?? '').trim(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
  };
}

export function readRememberedLoginUserId(): string | null {
  const context = getCurrentDeviceContext();
  if (!context) return null;

  try {
    const raw = window.localStorage.getItem(LOGIN_MEMORY_KEY);
    if (!raw) return null;

    const parsed = asObject(JSON.parse(raw) as unknown);
    const userId = (getString(parsed, 'userId') ?? '').trim();
    const deviceKey = (getString(parsed, 'deviceKey') ?? '').trim();
    const host = getString(parsed, 'host') ?? '';
    const platform = getString(parsed, 'platform') ?? '';
    const language = getString(parsed, 'language') ?? '';
    const timeZone = getString(parsed, 'timeZone') ?? '';

    if (!userId || !deviceKey) return null;
    if (host !== context.host) return null;
    if (platform !== context.platform) return null;
    if (language !== context.language) return null;
    if (timeZone !== context.timeZone) return null;

    return userId;
  } catch {
    return null;
  }
}