import pkg from '../../package.json';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type AppVersionInfo = {
  name: string;
  version: string;
  gitSha: string | null;
  buildTime: string | null;
  nodeEnv: string;
};

type BuildMeta = {
  gitSha: string | null;
  buildTime: string | null;
};

function readBuildMeta(): BuildMeta | null {
  try {
    const p = join(process.cwd(), '.next', 'build-meta.json');
    if (!existsSync(p)) return null;
    const raw = readFileSync(p, 'utf8');
    const j = JSON.parse(raw) as unknown;
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
    const o = j as Record<string, unknown>;
    return {
      gitSha: typeof o.gitSha === 'string' ? o.gitSha : null,
      buildTime: typeof o.buildTime === 'string' ? o.buildTime : null,
    };
  } catch {
    return null;
  }
}

export function getAppVersionInfo(): AppVersionInfo {
  const meta = readBuildMeta();

  const gitSha =
    process.env.NEXT_PUBLIC_GIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GIT_SHA ??
    meta?.gitSha ??
    null;

  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME ?? process.env.BUILD_TIME ?? meta?.buildTime ?? null;

  return {
    name: (pkg as { name?: string }).name ?? 'master-hub',
    version: (pkg as { version?: string }).version ?? '0.0.0',
    gitSha: gitSha && gitSha.trim().length > 0 ? gitSha : null,
    buildTime: buildTime && buildTime.trim().length > 0 ? buildTime : null,
    nodeEnv: process.env.NODE_ENV ?? 'unknown',
  };
}
