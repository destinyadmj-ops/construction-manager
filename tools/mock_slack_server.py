#!/usr/bin/env python3
"""
Simple local HTTP server to simulate Slack webhook behavior for testing retries.
- Returns 429 for first two POSTs to /webhook, then 200 afterwards.
"""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import threading

COUNTS = {}

class Handler(BaseHTTPRequestHandler):
    def _inc(self, key):
        COUNTS[key] = COUNTS.get(key, 0) + 1
        return COUNTS[key]

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length else b''
        count = self._inc(self.path)
        print(f"Received POST {self.path} attempt={count} body={body.decode('utf-8', errors='replace')}")
        # simulate transient failures for first 2 attempts
        if count <= 2:
            self.send_response(429)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            resp = {'ok': False, 'error': 'rate_limited', 'attempt': count}
            self.wfile.write(json.dumps(resp).encode('utf-8'))
            return
        # success
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        resp = {'ok': True, 'attempt': count}
        self.wfile.write(json.dumps(resp).encode('utf-8'))

    def log_message(self, format, *args):
        # suppress default logging
        return

if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', 8000), Handler)
    print('Mock Slack server running on http://127.0.0.1:8000/webhook')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()
        print('Server stopped')
