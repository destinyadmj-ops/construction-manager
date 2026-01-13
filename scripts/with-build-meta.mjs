import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function safeTrim(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function getGitSha() {
  try {
    const out = execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const sha = safeTrim(out.toString('utf8'));
    return sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
}

function writeBuildMeta(meta) {
  try {
    const outDir = path.join(process.cwd(), '.next');
    if (!fs.existsSync(outDir)) return;
    const outPath = path.join(outDir, 'build-meta.json');
    fs.writeFileSync(outPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  } catch {
    // ignore
  }
}

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error('Usage: node scripts/with-build-meta.mjs <command> [...args]');
  process.exit(2);
}

const buildTime = new Date().toISOString();
const gitSha = getGitSha();

const env = { ...process.env };
if (!env.NEXT_PUBLIC_BUILD_TIME) env.NEXT_PUBLIC_BUILD_TIME = buildTime;
if (!env.NEXT_PUBLIC_GIT_SHA && gitSha) env.NEXT_PUBLIC_GIT_SHA = gitSha;

const [command, ...args] = argv;

function spawnCommand(cmd, cmdArgs) {
  // Avoid `shell: true` for Next.js to prevent Node's DEP0190 warning.
  if (cmd === 'next') {
    const nextBin = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
    return spawn(process.execPath, [nextBin, ...cmdArgs], {
      stdio: 'inherit',
      shell: false,
      env,
    });
  }

  // For generic commands we keep shell:true for Windows compatibility.
  return spawn(cmd, cmdArgs, {
    stdio: 'inherit',
    shell: true,
    env,
  });
}

const child = spawnCommand(command, args);

child.on('error', () => {
  process.exit(1);
});

child.on('exit', (code) => {
  if (code === 0) {
    writeBuildMeta({
      gitSha: env.NEXT_PUBLIC_GIT_SHA ?? null,
      buildTime: env.NEXT_PUBLIC_BUILD_TIME ?? null,
    });
  }
  process.exit(code ?? 1);
});
