/**
 * Local-only helper for the Route A spike: serves inspector.html on 127.0.0.1:4318 and saves pasted clipboard
 * samples to results/sample-<time>.local.json (gitignored). Nothing leaves the machine.
 * Usage: node serve.mjs
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(here, 'results'), { recursive: true });

createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/inspector.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(join(here, 'inspector.html')));
    return;
  }
  if (req.method === 'GET' && req.url === '/copy.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readFileSync(join(here, 'copy.html')));
    return;
  }
  if (req.method === 'GET' && req.url === '/payloads') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(readFileSync(join(here, 'results', 'payloads.local.json')));
    return;
  }
  if (req.method === 'POST' && req.url === '/sample') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 50 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      const name = `sample-${new Date().toISOString().replace(/[:.]/g, '-')}.local.json`;
      writeFileSync(join(here, 'results', name), body);
      console.log(`saved results/${name} (${body.length} B)`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ saved: name }));
    });
    return;
  }
  res.writeHead(404).end();
}).listen(4318, '127.0.0.1', () => console.log('inspector: http://127.0.0.1:4318/'));
