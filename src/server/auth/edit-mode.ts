import crypto from 'crypto';

const COOKIE_NAME = 'mh_edit';

function secret() {
  return (process.env.MASTER_HUB_EDIT_COOKIE_SECRET ?? '').trim();
}

function hmac(value: string) {
  const s = secret();
  if (!s) return null;
  return crypto.createHmac('sha256', s).update(value).digest('hex');
}

export function isEditModeConfigured() {
  return Boolean((process.env.MASTER_HUB_EDIT_PASSWORD ?? '').trim()) && Boolean(secret());
}

export function issueEditCookieValue(nowMs = Date.now()) {
  const ts = String(nowMs);
  const sig = hmac(ts);
  if (!sig) return null;
  return `${ts}.${sig}`;
}

export function validateEditCookieValue(v: string | undefined | null) {
  if (!v) return false;
  const [ts, sig] = v.split('.', 2);
  if (!ts || !sig) return false;
  const expected = hmac(ts);
  if (!expected) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function getCookieName() {
  return COOKIE_NAME;
}
