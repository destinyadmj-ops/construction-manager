"use strict";
const pty = require('node-pty');
const path = require('path');

const cwd = path.resolve(__dirname, '..');
const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = ['@bubblewrap/cli', 'init', '--manifest=http://localhost:3000/manifest.webmanifest', '--directory=android'];

console.log('Spawning Bubblewrap via pty:', cmd, args.join(' '));

const term = pty.spawn(cmd, args, { cwd, env: process.env, cols: 120, rows: 40 });

term.onData((d) => process.stdout.write(d));

const lines = ['localhost:3000', '/', 'Master Hub', 'com.masterhub.app', 'Master Hub', 'Y'];

setTimeout(() => {
  let i = 0;
  const iv = setInterval(() => {
    if (i >= lines.length) { clearInterval(iv); return; }
    term.write(lines[i] + '\r');
    console.log('[auto] wrote:', lines[i]);
    i += 1;
  }, 600);
}, 1000);

term.onExit(({ exitCode }) => {
  console.log('pty exited', exitCode);
  process.exit(exitCode || 0);
});
"use strict";
"use strict";
const pty = require('node-pty');
const path = require('path');

const cwd = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const cmd = isWin ? 'npx.cmd' : 'npx';
const args = ['@bubblewrap/cli', 'init', '--manifest=http://localhost:3000/manifest.webmanifest', '--directory=android'];

console.log('Spawning Bubblewrap via pty:', cmd, args.join(' '));

const term = pty.spawn(cmd, args, {
  name: 'xterm-color',
  cols: 120,
  rows: 40,
  cwd,
  env: process.env,
});

term.onData((d) => process.stdout.write(d));

"use strict";
const pty = require('node-pty');
const path = require('path');

const cwd = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const cmd = isWin ? 'npx.cmd' : 'npx';
const args = ['@bubblewrap/cli', 'init', '--manifest=http://localhost:3000/manifest.webmanifest', '--directory=android'];

console.log('Spawning Bubblewrap via pty:', cmd, args.join(' '));

const term = pty.spawn(cmd, args, {
  name: 'xterm-color',
  cols: 120,
  rows: 40,
  cwd,
  env: process.env,
});

term.onData((d) => process.stdout.write(d));

const responses = [
  { match: /domain[: ]/i, text: 'localhost:3000\r' },
  { match: /url path[: ]/i, text: '/\r' },
  { match: /short name[: ]/i, text: 'Master Hub\r' },
  { match: /(package|application).*(id|name)/i, text: 'com.masterhub.app\r' },
  { match: /long name[: ]/i, text: 'Master Hub\r' },
  { match: /generate.*keystore|create a debug keystore|debug keystore/i, text: 'Y\r' },
];

let sent = new Set();

term.onData((data) => {
  try {
    for (let i = 0; i < responses.length; i++) {
      if (sent.has(i)) continue;
      const r = responses[i];
      if (r.match.test(data)) {
        term.write(r.text);
        sent.add(i);
        console.log('[auto] sent response', r.text.trim());
      }
    }
  } catch (e) {
    // ignore
  }
});

term.onExit(({ exitCode }) => {
  console.log('pty exited', exitCode);
  process.exit(exitCode || 0);
});
