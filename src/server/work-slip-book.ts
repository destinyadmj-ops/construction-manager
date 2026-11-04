import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { sheetJsToSnapshot, type WorkSlipBookSnapshot } from '@/shared/work-slip-book-convert';
import { getStorageBaseDir } from '@/server/site-storage';

// 作業伝票ブックの正本。版ごとのスナップショットを .storage/work-slip-book/ に保存する(DB スキーマ変更なし)。
export type WorkSlipBookMeta = {
  version: number;
  updatedAt: string;
  updatedByUserId: string | null;
  updatedByName: string | null;
  source: 'import' | 'upload' | 'edit' | 'restore';
  sourceFileName: string | null;
};

const MAX_KEPT_VERSIONS = 30;
const SNAPSHOT_MAX_BYTES = 80 * 1024 * 1024;

export class WorkSlipBookConflictError extends Error {
  constructor(public readonly currentVersion: number) {
    super('Version conflict');
  }
}

const bookDir = () => path.join(getStorageBaseDir(), 'work-slip-book');
const versionFile = (version: number) => path.join(bookDir(), `v${String(version).padStart(6, '0')}.json`);
const metaFile = () => path.join(bookDir(), 'current.json');

async function writeAtomic(target: string, content: string) {
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, target);
}

export async function getCurrentMeta(): Promise<WorkSlipBookMeta | null> {
  try {
    return JSON.parse(await readFile(metaFile(), 'utf8')) as WorkSlipBookMeta;
  } catch {
    return null;
  }
}

export async function readVersion(version: number): Promise<WorkSlipBookSnapshot | null> {
  try {
    return JSON.parse(await readFile(versionFile(version), 'utf8')) as WorkSlipBookSnapshot;
  } catch {
    return null;
  }
}

export async function listVersions(): Promise<number[]> {
  try {
    const names = await readdir(bookDir());
    return names
      .map((n) => /^v(\d+)\.json$/.exec(n)?.[1])
      .filter((n): n is string => !!n)
      .map(Number)
      .sort((a, b) => b - a);
  } catch {
    return [];
  }
}

// 同一プロセス内の保存を直列化する(本番は1ホスト運用)。他プロセスとの競合は baseVersion 検査で検出する。
let queue: Promise<unknown> = Promise.resolve();

function isSnapshot(value: unknown): value is WorkSlipBookSnapshot {
  const v = value as Partial<WorkSlipBookSnapshot> | null;
  return !!v && typeof v === 'object' && Array.isArray(v.sheetOrder) && !!v.sheets && typeof v.sheets === 'object';
}

export function saveVersion(input: {
  snapshot: unknown;
  baseVersion: number | null;
  user: { id: string | null; name: string | null };
  source: WorkSlipBookMeta['source'];
  sourceFileName?: string | null;
}): Promise<WorkSlipBookMeta> {
  const run = async (): Promise<WorkSlipBookMeta> => {
    if (!isSnapshot(input.snapshot)) throw new Error('Invalid workbook snapshot');
    const json = JSON.stringify(input.snapshot);
    if (Buffer.byteLength(json) > SNAPSHOT_MAX_BYTES) throw new Error('Workbook is too large');

    const current = await getCurrentMeta();
    const currentVersion = current?.version ?? 0;
    if (input.baseVersion !== null && input.baseVersion !== currentVersion) throw new WorkSlipBookConflictError(currentVersion);

    await mkdir(bookDir(), { recursive: true });
    const meta: WorkSlipBookMeta = {
      version: currentVersion + 1,
      updatedAt: new Date().toISOString(),
      updatedByUserId: input.user.id,
      updatedByName: input.user.name,
      source: input.source,
      sourceFileName: input.sourceFileName ?? current?.sourceFileName ?? null,
    };
    await writeAtomic(versionFile(meta.version), json);
    await writeAtomic(metaFile(), JSON.stringify(meta));

    for (const old of (await listVersions()).slice(MAX_KEPT_VERSIONS)) await rm(versionFile(old), { force: true });
    return meta;
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

export function snapshotFromExcelFile(filePath: string, name = '作業伝票'): WorkSlipBookSnapshot {
  const wb = XLSX.readFile(filePath, { cellFormula: true, cellNF: true, cellStyles: true });
  return sheetJsToSnapshot(wb, name);
}

export function snapshotFromExcelBuffer(buffer: Buffer, name = '作業伝票'): WorkSlipBookSnapshot {
  const wb = XLSX.read(buffer, { type: 'buffer', cellFormula: true, cellNF: true, cellStyles: true });
  return sheetJsToSnapshot(wb, name);
}
