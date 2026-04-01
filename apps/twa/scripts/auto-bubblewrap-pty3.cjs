"use strict";
const pty = require('node-pty');
const path = require('path');

const cwd = path.resolve(__dirname, '..');
const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = ['@bubblewrap/cli', 'init', '--manifest=http://localhost:3000/manifest.webmanifest', '--directory=android'];

console.log('Spawning Bubblewrap via pty (precise matcher):', cmd, args.join(' '));

const term = pty.spawn(cmd, args, { cwd, env: process.env, cols: 120, rows: 40 });

// ordered prompt matchers — we send answers in sequence when we see each prompt
const steps = [
  { re: /\?\s*Domain:|Please enter the domain|domain name/i, text: 'localhost:3000\r' },
  { re: /\?\s*URL path:|URL path to your manifest|Path:/i, text: '/\r' },
  { re: /\?\s*Short name:|Short name for your app/i, text: 'Master Hub\r' },
  { re: /\?\s*(Package|Application).*(id|name)|Package name/i, text: 'com.masterhub.app\r' },
  { re: /\?\s*Long name:|Long name for your app/i, text: 'Master Hub\r' },
  { re: /\?\s*(Generate|Create).*keystore|\?\s*Create a debug keystore|Create debug keystore/i, text: 'Y\r' },
];

let current = 0;
let buffer = '';
const MAX_BUFFER = 4096;
const START_TIME = Date.now();
const FORCE_SEND_AFTER_MS = 8000;
let lastActivity = Date.now();

function tryAdvance() {
  if (current >= steps.length) return;
  const step = steps[current];
  // debug: show tail of buffer and regex test
  try {
    const tail = buffer.slice(-300).replace(/\n/g, '\\n');
    console.log('[matcher-debug] buffer-tail:', tail);
    console.log('[matcher-debug] testing step', current, step.re.toString(), '=>', step.re.test(buffer));
  } catch (e) {}

  if (step.re.test(buffer)) {
    // safety delay to avoid racing writes
    setTimeout(() => {
      if (term._closed) return;
      try {
        term.write(step.text);
        console.log('[matcher] sent', step.text.trim());
        current += 1;
          lastActivity = Date.now();
      } catch (e) {
        console.error('[matcher] write failed', e && e.message);
      }
    }, 600);
  }
}

term.onData((chunk) => {
  // append to rolling buffer, keep size bounded
  buffer += chunk.toString();
  if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
  process.stdout.write(chunk);
  tryAdvance();
});

// fallback: if nothing advanced after FORCE_SEND_AFTER_MS, attempt a safe forced sequence
const fallbackTimer = setInterval(() => {
  if (current >= steps.length) {
    clearInterval(fallbackTimer);
    return;
  }
  const now = Date.now();
  // if no activity for a while and not progressed, try a forced send
  if (now - START_TIME > FORCE_SEND_AFTER_MS && now - lastActivity > 2000 && current === 0) {
    console.log('[fallback] no progress detected — sending forced sequence');
    // send domain, then path, then wait for normal matching
    try {
      term.write('localhost:3000\r');
      setTimeout(() => term.write('/\r'), 500);
      setTimeout(() => {
        // let regex matching pick up the rest
        lastActivity = Date.now();
      }, 1200);
    } catch (e) {
      console.error('[fallback] write failed', e && e.message);
    }
  }
}, 1500);

term.onExit(({ exitCode }) => {
  console.log('pty exited', exitCode);
  process.exit(exitCode || 0);
});
