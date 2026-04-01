const pty = require('node-pty');
const path = require('path');

const cwd = path.resolve(__dirname, '..');
const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = ['@bubblewrap/cli', 'init', '--manifest=http://localhost:3000/manifest.webmanifest', '--directory=android'];

console.log('Spawning Bubblewrap via pty:', cmd, args.join(' '));

const term = pty.spawn(cmd, args, {
  name: 'xterm-color',
  cols: 100,
  rows: 40,
  cwd,
  env: process.env,
});

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
  process.stdout.write(data);
  for (let i = 0; i < responses.length; i++) {
    if (sent.has(i)) continue;
    const r = responses[i];
    try {
      if (r.match.test(data)) {
        term.write(r.text);
        sent.add(i);
        console.log('[auto] sent response', r.text.trim());
      }
    } catch (e) {}
  }
});

term.onExit((e) => {
  console.log('pty exited', e);
  process.exit(e && e.exitCode ? e.exitCode : 0);
});
