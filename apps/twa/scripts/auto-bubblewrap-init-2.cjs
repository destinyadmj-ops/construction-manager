const { spawn } = require('child_process');
const path = require('path');

const cwd = path.resolve(__dirname, '..');

const args = ['@bubblewrap/cli', 'init', '--manifest=http://localhost:3000/manifest.webmanifest', '--directory=android'];

console.log('Starting bubblewrap with args:', args.join(' '));

const proc = spawn('npx', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: true });

const responses = {
  domain: 'localhost:3000',
  urlpath: '/',
  shortname: 'Master Hub',
  packageid: 'com.masterhub.app',
  longname: 'Master Hub',
  generateKeystore: 'Y',
};

let wrote = { domain: false, urlpath: false, shortname: false, packageid: false, longname: false, generateKeystore: false };

function tryMatchAndWrite(chunkStr) {
  const s = chunkStr.toLowerCase();
  if (!wrote.domain && s.includes('domain:')) {
    proc.stdin.write(responses.domain + '\n');
    wrote.domain = true;
    return;
  }
  if (!wrote.urlpath && s.includes('url path:')) {
    proc.stdin.write(responses.urlpath + '\n');
    wrote.urlpath = true;
    return;
  }
  if (!wrote.shortname && s.includes('short name')) {
    proc.stdin.write(responses.shortname + '\n');
    wrote.shortname = true;
    return;
  }
  if (!wrote.packageid && (s.includes('package id') || s.includes('package id:') || s.includes('package name') || s.includes('application id'))) {
    proc.stdin.write(responses.packageid + '\n');
    wrote.packageid = true;
    return;
  }
  if (!wrote.longname && s.includes('long name')) {
    proc.stdin.write(responses.longname + '\n');
    wrote.longname = true;
    return;
  }
  if (!wrote.generateKeystore && (s.includes('generate') && s.includes('keystore') || s.includes('create a debug keystore') || s.includes('debug keystore'))) {
    proc.stdin.write(responses.generateKeystore + '\n');
    wrote.generateKeystore = true;
    return;
  }
}

proc.stdout.on('data', (chunk) => {
  const str = chunk.toString();
  process.stdout.write(str);
  tryMatchAndWrite(str);
});

proc.stderr.on('data', (chunk) => {
  process.stderr.write(chunk.toString());
});

proc.on('exit', (code, signal) => {
  console.log('bubblewrap process exited', { code, signal });
  process.exit(code || 0);
});

proc.on('error', (err) => {
  console.error('failed to start bubblewrap:', err);
  process.exit(1);
});
