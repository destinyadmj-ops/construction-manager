'use client';

export type CachedUserKind = 'NORMAL' | 'DAILY';

export type CachedUserCandidate = {
  id: string;
  name: string | null;
  email: string | null;
  kind: CachedUserKind;
  passwordConfigured: boolean | null;
};

export const USER_CANDIDATES_UPDATED_EVENT = 'masterHub:userCandidatesUpdated';

const USER_CANDIDATE_CACHE_KEY = 'masterHub.userCandidates.v1';

function normalizeCandidate(input: unknown): CachedUserCandidate | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const obj = input as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id.trim() : '';
  if (!id) return null;

  return {
    id,
    name: typeof obj.name === 'string' ? obj.name : null,
    email: typeof obj.email === 'string' ? obj.email : null,
    kind: obj.kind === 'DAILY' ? 'DAILY' : 'NORMAL',
    passwordConfigured: typeof obj.passwordConfigured === 'boolean' ? obj.passwordConfigured : null,
  };
}

function normalizeList(users: CachedUserCandidate[]): CachedUserCandidate[] {
  const byId = new Map<string, CachedUserCandidate>();
  for (const user of users) {
    const existing = byId.get(user.id);
    byId.set(user.id, {
      id: user.id,
      name: user.name ?? existing?.name ?? null,
      email: user.email ?? existing?.email ?? null,
      kind: user.kind ?? existing?.kind ?? 'NORMAL',
      passwordConfigured: user.passwordConfigured ?? existing?.passwordConfigured ?? null,
    });
  }
  return Array.from(byId.values());
}

export function readCachedUserCandidates(): CachedUserCandidate[] {
  try {
    const raw = window.localStorage.getItem(USER_CANDIDATE_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return normalizeList(parsed.map((item) => normalizeCandidate(item)).filter((item): item is CachedUserCandidate => !!item));
  } catch {
    return [];
  }
}

export function mergeUserCandidates(
  primary: CachedUserCandidate[],
  secondary: CachedUserCandidate[],
): CachedUserCandidate[] {
  return normalizeList([...primary, ...secondary]);
}

export function writeCachedUserCandidates(users: CachedUserCandidate[]) {
  try {
    const next = normalizeList(users);
    const prevRaw = window.localStorage.getItem(USER_CANDIDATE_CACHE_KEY) ?? '[]';
    const nextRaw = JSON.stringify(next);
    if (prevRaw === nextRaw) return;
    window.localStorage.setItem(USER_CANDIDATE_CACHE_KEY, nextRaw);
    window.dispatchEvent(new CustomEvent(USER_CANDIDATES_UPDATED_EVENT));
  } catch {
    // ignore
  }
}