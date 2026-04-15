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

export function getDesktopReleaseInfo(): DesktopReleaseInfo {
  return {
    version: readEnv('DESKTOP_APP_VERSION') ?? ((pkg as { version?: string }).version ?? '0.0.0'),
    downloadUrl: readEnv('DESKTOP_APP_DOWNLOAD_URL'),
    notes: readEnv('DESKTOP_APP_RELEASE_NOTES'),
    publishedAt: readEnv('DESKTOP_APP_PUBLISHED_AT'),
    channel: readEnv('DESKTOP_APP_CHANNEL') ?? 'stable',
  };
}
