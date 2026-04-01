const { spawn } = require('child_process');
const path = require('path');

const cwd = path.resolve(__dirname, '..');

const args = ['@bubblewrap/cli', 'init', '--manifest=http://localhost:3000/manifest.webmanifest', '--directory=android'];

console.log('Starting bubblewrap with args:', args.join(' '));

const proc = spawn('npx', args, { cwd, stdio: ['pipe', 'inherit', 'inherit'], shell: true });

const inputs = [
  'localhost:3000',
  '/',
  'Master Hub',
  'com.masterhub.app',
  'Master Hub',
  'Y',
];

let i = 0;
function sendNext() {
  if (i >= inputs.length) {
    try { proc.stdin.end(); } catch (e) {}
    return;
  }
  const line = inputs[i] + '\n';
  try {
    proc.stdin.write(line);
  } catch (e) {
    // ignore
  }
  i += 1;
  setTimeout(sendNext, 400);
}

proc.on('exit', (code, signal) => {
  console.log('bubblewrap process exited', { code, signal });
  process.exit(code || 0);
});

proc.on('error', (err) => {
  console.error('failed to start bubblewrap:', err);
  process.exit(1);
});

setTimeout(sendNext, 800);
