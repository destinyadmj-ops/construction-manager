import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

const target = process.env.TARGET_URL || 'http://127.0.0.1:3001';
const listenPort = Number(process.env.HTTPS_PORT || '3443');
const certPath = process.env.TLS_CERT;
const keyPath = process.env.TLS_KEY;

if (!certPath || !keyPath) {
  console.error('[ERR] TLS_CERT and TLS_KEY are required');
  process.exit(1);
}

const cert = fs.readFileSync(certPath);
const key = fs.readFileSync(keyPath);
const targetUrl = new URL(target);
if (targetUrl.protocol !== 'http:') {
  console.error('[ERR] TARGET_URL must be http://... (expected local next start)');
  process.exit(1);
}

const server = https.createServer({ cert, key }, (req, res) => {
  if (!req.url) {
    res.statusCode = 400;
    res.end('bad request');
    return;
  }

  const upstream = http.request(
    {
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        host: req.headers.host,
        'x-forwarded-proto': 'https',
        'x-forwarded-host': req.headers.host,
      },
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    },
  );

  upstream.on('error', (e) => {
    res.statusCode = 502;
    res.end(`bad gateway: ${String(e?.message || e)}`);
  });

  req.pipe(upstream);
});

server.listen(listenPort, '0.0.0.0', () => {
  console.log(`[INFO] HTTPS proxy listening on https://0.0.0.0:${listenPort} -> ${target}`);
});
