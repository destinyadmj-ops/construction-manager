import { createHash } from 'node:crypto';
import { mkdir, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withRedis } from '@/server/shared-sync-status';
import { extensionOfUpload, type AgentContact, type UploadMeta } from '@/shared/shared-sync-upload';

// 会社PCから受け取った原本(作業表☆)を Redis に保存し、worker/web が読める一時ファイルとして取り出す。
const META_KEY = 'masterhub:shared-upload:worktable:meta';
const DATA_KEY = 'masterhub:shared-upload:worktable:data';
const AGENT_KEY = 'masterhub:shared-upload:agent';
const KEEP_SECONDS = 90 * 24 * 60 * 60;

export type UploadedWorkTable = {
  filePath: string;
  fileName: string;
  baseName: string;
  extension: string;
  mtimeMs: number;
  sizeBytes: number;
  sha256: string;
};

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseJson<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function readUploadMeta(): Promise<UploadMeta | null> {
  return (await withRedis(async (redis) => parseJson<UploadMeta>(await redis.get(META_KEY)))) ?? null;
}

export async function readAgentContact(): Promise<AgentContact | null> {
  return (await withRedis(async (redis) => parseJson<AgentContact>(await redis.get(AGENT_KEY)))) ?? null;
}

// 送信ツールの生存確認(ファイルが変わっていない間も、毎回の確認でここを更新する)
export async function recordAgentContact(host: string | null): Promise<void> {
  const value: AgentContact = { lastContactAt: new Date().toISOString(), host };
  await withRedis(async (redis) => {
    await redis.set(AGENT_KEY, JSON.stringify(value), 'EX', KEEP_SECONDS);
  });
}

export async function saveUpload(input: { bytes: Uint8Array; fileName: string; sourceMtimeMs: number; via: UploadMeta['via'] }): Promise<UploadMeta | null> {
  const meta: UploadMeta = {
    sha256: sha256Hex(input.bytes),
    fileName: input.fileName,
    sizeBytes: input.bytes.length,
    sourceMtimeMs: input.sourceMtimeMs,
    receivedAt: new Date().toISOString(),
    via: input.via,
  };
  const saved = await withRedis(async (redis) => {
    await redis.multi().set(DATA_KEY, Buffer.from(input.bytes), 'EX', KEEP_SECONDS).set(META_KEY, JSON.stringify(meta), 'EX', KEEP_SECONDS).exec();
    return true;
  });
  return saved ? meta : null;
}

function uploadDir() {
  return join(tmpdir(), 'masterhub-shared-upload');
}

// 最新の受信ファイルを一時ファイルとして用意する(同じ内容なら再利用し、Redis から本体を読まない)
export async function getUploadedWorkTableFile(): Promise<UploadedWorkTable | null> {
  const meta = await readUploadMeta();
  if (!meta) return null;
  const extension = extensionOfUpload(meta.fileName);
  const dir = uploadDir();
  const filePath = join(dir, `${meta.sha256}${extension}`);
  const base: UploadedWorkTable = {
    filePath,
    fileName: meta.fileName,
    baseName: meta.fileName.slice(0, -extension.length),
    extension,
    mtimeMs: meta.sourceMtimeMs,
    sizeBytes: meta.sizeBytes,
    sha256: meta.sha256,
  };
  const exists = await stat(filePath).then((s) => s.size === meta.sizeBytes, () => false);
  if (exists) return base;

  const data = await withRedis(async (redis) => redis.getBuffer(DATA_KEY));
  if (!data || sha256Hex(data) !== meta.sha256) return null;
  await mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tmpPath, data);
  await rename(tmpPath, filePath);
  try {
    for (const name of await readdir(dir)) {
      if (!name.startsWith(meta.sha256)) await unlink(join(dir, name)).catch(() => undefined);
    }
  } catch {
    // best effort
  }
  return base;
}

// 同じ原本(同じ識別値)を最後に同期した記録。変化が無い間は同期を省くために使う。
type SyncedMarker = { key: string; at: string };

function syncedKey(scope: string, kind: string) {
  return `masterhub:shared-upload:synced:${scope}:${kind}`;
}

export async function markUploadSynced(scope: string, kind: string, key: string): Promise<void> {
  const value: SyncedMarker = { key, at: new Date().toISOString() };
  await withRedis(async (redis) => {
    await redis.set(syncedKey(scope, kind), JSON.stringify(value), 'EX', KEEP_SECONDS);
  });
}

export async function readUploadSynced(scope: string, kind: string): Promise<SyncedMarker | null> {
  return (await withRedis(async (redis) => parseJson<SyncedMarker>(await redis.get(syncedKey(scope, kind))))) ?? null;
}
