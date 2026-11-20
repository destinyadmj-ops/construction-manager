import { createHash, timingSafeEqual } from 'node:crypto';
import { requireScheduleEditor } from '@/server/auth/schedule-edit';
import { countRateLimitHit, readRateLimitCount } from '@/server/rate-limit';
import { readUploadMeta, recordAgentContact, saveUpload, sha256Hex } from '@/server/shared-upload';
import {
  UPLOAD_MAX_BYTES_DEFAULT,
  validateUploadBytes,
  validateUploadFileName,
} from '@/shared/shared-sync-upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 会社PCの送信ツール(Bearer トークン)または週予定の編集権限を持つ利用者(手動アップロード)だけが原本を送れる。
const MIN_TOKEN_LENGTH = 32;
const FAIL_LIMIT = 10;
const FAIL_WINDOW_SECONDS = 600;
const REQUEST_LIMIT = 120;
const REQUEST_WINDOW_SECONDS = 60;

function json(body: Record<string, unknown>, status: number, headers?: Record<string, string>) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

function clientIp(request: Request): string {
  const forwarded = (request.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim();
  return (forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown').slice(0, 64);
}

function maxBytes(): number {
  const raw = Number(process.env.SHARED_SYNC_UPLOAD_MAX_BYTES ?? '');
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : UPLOAD_MAX_BYTES_DEFAULT;
}

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

type Auth = { ok: true; via: 'agent' | 'manual' } | { ok: false; response: Response };

async function authenticate(request: Request, ip: string): Promise<Auth> {
  const requests = await countRateLimitHit(`upload-req:${ip}`, REQUEST_WINDOW_SECONDS);
  if (requests != null && requests > REQUEST_LIMIT) {
    return { ok: false, response: json({ ok: false, error: 'Too Many Requests' }, 429, { 'Retry-After': String(REQUEST_WINDOW_SECONDS) }) };
  }

  const header = request.headers.get('authorization');
  if (header == null) {
    // トークン無し: 画面からの手動アップロード(週予定の編集権限が必要)
    const authError = await requireScheduleEditor(request);
    return authError ? { ok: false, response: authError } : { ok: true, via: 'manual' };
  }

  if ((await readRateLimitCount(`upload-fail:${ip}`)) >= FAIL_LIMIT) {
    return { ok: false, response: json({ ok: false, error: 'Too Many Requests' }, 429, { 'Retry-After': String(FAIL_WINDOW_SECONDS) }) };
  }
  const expected = (process.env.SHARED_SYNC_UPLOAD_TOKEN ?? '').trim();
  if (expected.length < MIN_TOKEN_LENGTH) {
    return { ok: false, response: json({ ok: false, error: '受け口が未設定です(SHARED_SYNC_UPLOAD_TOKEN を32文字以上で設定してください)' }, 503) };
  }
  const given = /^Bearer\s+(\S+)$/i.exec(header.trim())?.[1] ?? '';
  if (!given || !timingSafeEqual(digest(given), digest(expected))) {
    await countRateLimitHit(`upload-fail:${ip}`, FAIL_WINDOW_SECONDS);
    return { ok: false, response: json({ ok: false, error: 'Unauthorized' }, 401) };
  }
  return { ok: true, via: 'agent' };
}

function agentHost(request: Request): string | null {
  const raw = request.headers.get('x-agent-host');
  return raw ? raw.replace(/[^\w.-]/g, '').slice(0, 64) || null : null;
}

async function readBodyLimited(request: Request, limit: number): Promise<Uint8Array | 'too-large'> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > limit) return 'too-large';
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return 'too-large';
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// 送信ツールの確認用: 受け取り済みの原本の識別値を返し、生存確認を記録する(変化が無ければ送信を省くため)
export async function GET(request: Request) {
  const ip = clientIp(request);
  const auth = await authenticate(request, ip);
  if (!auth.ok) return auth.response;
  if (auth.via !== 'agent') return json({ ok: false, error: 'Unauthorized' }, 401);

  await recordAgentContact(agentHost(request));
  const meta = await readUploadMeta();
  return json({ ok: true, hasFile: !!meta, sha256: meta?.sha256 ?? null, fileName: meta?.fileName ?? null, receivedAt: meta?.receivedAt ?? null }, 200);
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  const auth = await authenticate(request, ip);
  if (!auth.ok) return auth.response;

  const limit = maxBytes();
  const body = await readBodyLimited(request, limit);
  if (body === 'too-large') return json({ ok: false, error: `ファイルが大きすぎます(上限 ${Math.floor(limit / 1024 / 1024)}MB)` }, 413);

  let fileName = '';
  try {
    fileName = decodeURIComponent(request.headers.get('x-file-name') ?? '');
  } catch {
    return json({ ok: false, error: 'ファイル名が不正です' }, 400);
  }
  const nameCheck = validateUploadFileName(fileName);
  if (!nameCheck.ok) return json({ ok: false, error: nameCheck.error }, nameCheck.status);
  const bytesCheck = validateUploadBytes(body, limit);
  if (!bytesCheck.ok) return json({ ok: false, error: bytesCheck.error }, bytesCheck.status);

  const sha256 = sha256Hex(body);
  const declaredSha = (request.headers.get('x-sha256') ?? '').trim().toLowerCase();
  if (declaredSha && declaredSha !== sha256) return json({ ok: false, error: 'ハッシュが一致しません(送信が壊れた可能性)' }, 400);

  const mtime = Number(request.headers.get('x-source-mtime') ?? '');
  const nowMs = Date.now();
  if (!Number.isFinite(mtime) || mtime < Date.UTC(2000, 0, 1) || mtime > nowMs + 2 * 86_400_000) {
    return json({ ok: false, error: 'x-source-mtime(原本の更新日時ms)が不正です' }, 400);
  }

  if (auth.via === 'agent') await recordAgentContact(agentHost(request));

  const previous = await readUploadMeta();
  if (previous?.sha256 === sha256) return json({ ok: true, changed: false, sha256, receivedAt: previous.receivedAt }, 200);

  const meta = await saveUpload({ bytes: body, fileName: fileName.normalize('NFKC').trim(), sourceMtimeMs: Math.floor(mtime), via: auth.via });
  if (!meta) return json({ ok: false, error: '保存先(Redis)に接続できません' }, 503);
  console.log(`[shared-upload] received via=${auth.via} size=${meta.sizeBytes} sha256=${sha256.slice(0, 12)}`);
  return json({ ok: true, changed: true, sha256, receivedAt: meta.receivedAt }, 200);
}
