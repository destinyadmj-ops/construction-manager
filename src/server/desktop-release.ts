import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import pkg from '../../package.json';

export type DesktopReleaseInfo = {
  version: string;
  downloadUrl: string | null;
  notes: string | null;
  publishedAt: string | null;
  channel: string;
};

function parseVersion(raw: string | null | undefined): number[] {
  return String(raw || '0.0.0')
    .split(/[.+-]/)[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const len = Math.max(left.length, right.length);

  for (let index = 0; index < len; index += 1) {
    const leftPart = left[index] || 0;
    const rightPart = right[index] || 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  return 0;
}

function isDesktopInstallerFileName(fileName: string): boolean {
  return /^Master(?: |-)Hub-Setup-.*\.exe$/i.test(fileName);
}

function extractInstallerVersion(fileName: string): string | null {
  const match = /^Master(?: |-)Hub-Setup-(.+)\.exe$/i.exec(fileName);
  if (!match) return null;
  const version = match[1]?.trim();
  return version ? version : null;
}

function readEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;

  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getPublicDesktopInstaller(version?: string): { fileName: string; filePath: string; version: string } | null {
  const downloadsDir = resolve(process.cwd(), 'public', 'downloads');
  if (!existsSync(downloadsDir)) return null;

  try {
    const candidates = readdirSync(downloadsDir)
      .filter(isDesktopInstallerFileName)
      .map((fileName) => {
        const installerVersion = extractInstallerVersion(fileName);
        if (!installerVersion) return null;
        const filePath = join(downloadsDir, fileName);
        return {
          fileName,
          filePath,
          version: installerVersion,
          mtimeMs: statSync(filePath).mtimeMs,
        };
      })
      .filter((candidate): candidate is { fileName: string; filePath: string; version: string; mtimeMs: number } => Boolean(candidate))
      .sort((left, right) => compareVersions(right.version, left.version) || right.mtimeMs - left.mtimeMs);

    if (version) {
      const exact = candidates.find((candidate) => compareVersions(candidate.version, version) === 0);
      return exact ?? null;
    }

    const latest = candidates[0];
    return latest ? { fileName: latest.fileName, filePath: latest.filePath, version: latest.version } : null;
  } catch {
    return null;
  }
}

function getRepoDesktopReleaseInfo(): DesktopReleaseInfo | null {
  const release =
    readJsonObject(resolve(process.cwd(), 'public', 'desktop-release.json')) ??
    readJsonObject(resolve(process.cwd(), 'apps', 'desktop', 'release.json'));
  if (!release) return null;

  const version = typeof release.version === 'string' ? release.version.trim() : '';
  if (!version) return null;

  const bundledPublicInstaller = getPublicDesktopInstaller(version);
  const rawDownloadUrl = typeof release.downloadUrl === 'string' ? release.downloadUrl.trim() : '';

  return {
    version,
    downloadUrl:
      rawDownloadUrl || (bundledPublicInstaller ? `/downloads/${encodeURIComponent(bundledPublicInstaller.fileName)}` : null),
    notes: typeof release.notes === 'string' ? release.notes.trim() || null : null,
    publishedAt: typeof release.publishedAt === 'string' ? release.publishedAt.trim() || null : null,
    channel: typeof release.channel === 'string' && release.channel.trim() ? release.channel.trim() : 'stable',
  };
}

function getEnvDesktopReleaseInfo(): DesktopReleaseInfo | null {
  const version = readEnv('DESKTOP_APP_VERSION');
  const downloadUrl = readEnv('DESKTOP_APP_DOWNLOAD_URL');
  const notes = readEnv('DESKTOP_APP_RELEASE_NOTES');
  const publishedAt = readEnv('DESKTOP_APP_PUBLISHED_AT');
  const channel = readEnv('DESKTOP_APP_CHANNEL') ?? 'stable';

  if (!version && !downloadUrl && !notes && !publishedAt) return null;

  return {
    version: version ?? ((pkg as { version?: string }).version ?? '0.0.0'),
    downloadUrl,
    notes,
    publishedAt,
    channel,
  };
}

function pickPreferredDesktopRelease(candidates: Array<DesktopReleaseInfo | null>): DesktopReleaseInfo | null {
  return candidates
    .filter((candidate): candidate is DesktopReleaseInfo => Boolean(candidate))
    .sort((left, right) => {
      const versionCompare = compareVersions(right.version, left.version);
      if (versionCompare !== 0) return versionCompare;
      const rightHasDownload = right.downloadUrl ? 1 : 0;
      const leftHasDownload = left.downloadUrl ? 1 : 0;
      return rightHasDownload - leftHasDownload;
    })[0] ?? null;
}

export function getBundledDesktopInstaller(): { fileName: string; filePath: string } | null {
  const distDir = resolve(process.cwd(), 'apps', 'desktop', 'dist');
  if (!existsSync(distDir)) return null;

  try {
    const candidates = readdirSync(distDir)
      .filter(isDesktopInstallerFileName)
      .map((fileName) => {
        const filePath = join(distDir, fileName);
        return {
          fileName,
          filePath,
          mtimeMs: statSync(filePath).mtimeMs,
        };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs);

    const latest = candidates[0];
    return latest ? { fileName: latest.fileName, filePath: latest.filePath } : null;
  } catch {
    return null;
  }
}

export function getDesktopReleaseInfo(): DesktopReleaseInfo {
  const repoRelease = getRepoDesktopReleaseInfo();
  const envRelease = getEnvDesktopReleaseInfo();
  const bundledInstaller = getBundledDesktopInstaller();
  const preferredRelease = pickPreferredDesktopRelease([repoRelease, envRelease]);

  if (preferredRelease) return preferredRelease;

  return {
    version: (pkg as { version?: string }).version ?? '0.0.0',
    downloadUrl: bundledInstaller ? '/api/desktop-release/download' : null,
    notes: null,
    publishedAt: null,
    channel: 'stable',
  };
}
