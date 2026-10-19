// 週予定APIレスポンスの表示用キャッシュ(stale-while-revalidate)。
// 表示を即時にするためだけに使い、必ずバックグラウンドで再取得して最新に置き換える。
const PREFIX = 'mh:week-payload:';
const MAX_ENTRIES = 12;
const memory = new Map<string, string>();

export function readWeekPayloadCache(key: string): string | null {
  const hit = memory.get(key);
  if (hit) return hit;
  try {
    const stored = window.sessionStorage.getItem(PREFIX + key);
    if (stored) {
      memory.set(key, stored);
      return stored;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

export function writeWeekPayloadCache(key: string, text: string): void {
  memory.delete(key);
  memory.set(key, text);
  while (memory.size > MAX_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
  try {
    window.sessionStorage.setItem(PREFIX + key, text);
  } catch {
    // quota exceeded etc.: memory cache only
  }
}
