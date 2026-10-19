// Mount-time `/api/auth/me` GET is requested by several sibling components
// (header / color-edit-controller / user-gate). Share one in-flight request.
const SHARE_WINDOW_MS = 2000;

type AuthMeResponse = { ok: boolean; json: unknown };

let inflight: Promise<AuthMeResponse> | null = null;
let startedAt = 0;

export function fetchAuthMeShared(): Promise<AuthMeResponse> {
  const now = Date.now();
  if (inflight && now - startedAt < SHARE_WINDOW_MS) return inflight;

  startedAt = now;
  const request = fetch('/api/auth/me').then(async (r) => ({
    ok: r.ok,
    json: (await r.json().catch(() => null)) as unknown,
  }));
  inflight = request;
  request.catch(() => {
    if (inflight === request) inflight = null;
  });
  return request;
}
