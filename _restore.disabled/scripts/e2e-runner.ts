import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function nowTs() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, '..');
  process.chdir(repoRoot);

  const logPath = path.join(repoRoot, 'e2e.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });

  const args = process.argv.slice(2);
  logStream.write(`[${nowTs()}] --- e2e start: npx playwright test ${args.join(' ')} ---\n`);

  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const child = spawn(npxCmd, ['playwright', 'test', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  const forward = (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    process.stdout.write(text);
    logStream.write(text);
  };

  child.stdout.on('data', forward);
  child.stderr.on('data', forward);

  const exitCode: number = await new Promise((resolve) => {
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });

  logStream.write(`\n[${nowTs()}] --- e2e end: exit=${exitCode} ---\n`);
  await new Promise((r) => logStream.end(r));

  process.exit(exitCode);
}

main().catch(() => {
  process.exit(1);
});
