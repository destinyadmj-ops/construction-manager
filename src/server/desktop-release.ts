import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import pkg from '../../package.json';

export type DesktopReleaseInfo = {
  version: string;
  downloadUrl: string | null;
  notes: string | null;
  publishedAt: string | null;
  channel: string;
};

function readEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

export function getBundledDesktopInstaller(): { fileName: string; filePath: string } | null {
  const distDir = resolve(process.cwd(), 'apps', 'desktop', 'dist');
  if (!existsSync(distDir)) return null;

  try {
    const candidates = readdirSync(distDir)
      .filter((name) => /^Master Hub-Setup-.*\.exe$/i.test(name))
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
  const bundledInstaller = getBundledDesktopInstaller();
  return {
    version: readEnv('DESKTOP_APP_VERSION') ?? ((pkg as { version?: string }).version ?? '0.0.0'),
    downloadUrl: readEnv('DESKTOP_APP_DOWNLOAD_URL') ?? (bundledInstaller ? '/api/desktop-release/download' : null),
    notes: readEnv('DESKTOP_APP_RELEASE_NOTES'),
    publishedAt: readEnv('DESKTOP_APP_PUBLISHED_AT'),
    channel: readEnv('DESKTOP_APP_CHANNEL') ?? 'stable',
  };
}
