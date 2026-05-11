import { access, mkdir, readdir } from 'node:fs/promises';
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

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveSiteFolderRoot(siteId: string, siteName: string) {
  const preferredRoot = getSiteFolderRoot(siteId, siteName);
  if (await pathExists(preferredRoot)) return preferredRoot;

  const sitesRoot = path.join(getStorageBaseDir(), 'sites');
  const suffix = `__${siteId.slice(0, 8)}`;

  try {
    const entries = await readdir(sitesRoot, { withFileTypes: true });
    const legacyEntry = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(suffix));
    if (legacyEntry) return path.join(sitesRoot, legacyEntry.name);
  } catch {
    // Fall back to the current normalized root when no legacy folder exists.
  }

  return preferredRoot;
}

export async function getSiteDayFolderPaths(siteId: string, siteName: string, dayYmd: string) {
  const folderRoot = path.join(await resolveSiteFolderRoot(siteId, siteName), dayYmd);
  return {
    folderRoot,
    photosDir: path.join(folderRoot, 'photos'),
    reportsDir: path.join(folderRoot, 'reports'),
  };
}

export async function ensureSiteDayFolders(input: { siteId: string; siteName: string; dayYmd: string }) {
  const paths = await getSiteDayFolderPaths(input.siteId, input.siteName, input.dayYmd);
  await mkdir(paths.photosDir, { recursive: true });
  await mkdir(paths.reportsDir, { recursive: true });
  return paths;
}

export async function listSiteDayFolders(siteId: string, siteName: string, limit = 366) {
  try {
    const entries = await readdir(await resolveSiteFolderRoot(siteId, siteName), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
      .slice(0, limit);
  } catch {
    return [] as string[];
  }
}