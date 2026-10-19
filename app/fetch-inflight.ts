// GET only: concurrent identical requests (e.g. remounted components) share one network call.
const inflight = new Map<string, Promise<Response>>();

export function fetchSharedInflight(url: string, init?: RequestInit): Promise<Response> {
  let shared = inflight.get(url);
  if (!shared) {
    const request: Promise<Response> = fetch(url, init).finally(() => {
      if (inflight.get(url) === request) inflight.delete(url);
    });
    shared = request;
    inflight.set(url, request);
  }
  return shared.then((response) => response.clone());
}
