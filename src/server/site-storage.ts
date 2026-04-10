import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

export function safePathSegment(name: string) {
  const base = name.trim() || 'untitled';
  return base
    .replace(/[\\/\r\n\t\0<>:"|?*]+/g, '_')
    .replace(/[\s.]+$/g, '')
    .slice(0, 80);
}

export function ymdInTokyo(d: Date) {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function getStorageBaseDir() {
  return process.env.MASTER_HUB_STORAGE_DIR
    ? path.resolve(process.env.MASTER_HUB_STORAGE_DIR)
    : path.join(process.cwd(), '.storage');
}

export function getSiteFolderName(siteId: string, siteName: string) {
  const siteFolderBase = safePathSegment(siteName) || siteId;
  return `${siteFolderBase}__${siteId.slice(0, 8)}`;
}

export function getSiteFolderRoot(siteId: string, siteName: string) {
  return path.join(getStorageBaseDir(), 'sites', getSiteFolderName(siteId, siteName));
}

export function getSiteDayFolderPaths(siteId: string, siteName: string, dayYmd: string) {
  const folderRoot = path.join(getSiteFolderRoot(siteId, siteName), dayYmd);
  return {
    folderRoot,
    photosDir: path.join(folderRoot, 'photos'),
    reportsDir: path.join(folderRoot, 'reports'),
  };
}

export async function ensureSiteDayFolders(input: { siteId: string; siteName: string; dayYmd: string }) {
  const paths = getSiteDayFolderPaths(input.siteId, input.siteName, input.dayYmd);
  await mkdir(paths.photosDir, { recursive: true });
  await mkdir(paths.reportsDir, { recursive: true });
  return paths;
}

export async function listSiteDayFolders(siteId: string, siteName: string, limit = 366) {
  try {
    const entries = await readdir(getSiteFolderRoot(siteId, siteName), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
      .slice(0, limit);
  } catch {
    return [] as string[];
  }
}