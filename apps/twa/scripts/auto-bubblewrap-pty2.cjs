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
