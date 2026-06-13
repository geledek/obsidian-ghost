// LiveDeck — zero-dependency dev server for WYSIWYG HTML slide editing.
//
// Responsibilities:
//   - serve the editor shell (public/) and the deck file
//   - accept saves from the editor and write them back to the deck file
//   - watch the deck file on disk and push a live-reload event (so edits made
//     by Claude Code / an external editor show up instantly)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DECK = path.resolve(process.env.DECK || path.join(ROOT, 'deck.html'));
const PORT = Number(process.env.PORT || 4321);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

const sseClients = new Set();

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Server-Sent Events channel for live reload.
  if (url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // The raw deck, always fresh from disk.
  if (url.pathname === '/deck.html') {
    fs.readFile(DECK, (err, data) =>
      err ? send(res, 404, 'text/plain', 'deck not found') : send(res, 200, MIME['.html'], data),
    );
    return;
  }

  // Persist an edited deck back to disk.
  if (url.pathname === '/api/save' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      fs.writeFile(DECK, body, (err) =>
        err
          ? send(res, 500, 'text/plain', String(err))
          : send(res, 200, MIME['.json'], '{"ok":true}'),
      );
    });
    return;
  }

  // Static editor assets.
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'text/plain', 'forbidden');
  fs.readFile(file, (err, data) =>
    err
      ? send(res, 404, 'text/plain', 'not found')
      : send(res, 200, MIME[path.extname(file)] || 'application/octet-stream', data),
  );
});

// Watch the deck file. Debounced because editors often fire multiple events.
let watchTimer = null;
try {
  fs.watch(DECK, () => {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      for (const res of sseClients) res.write(`event: deckchange\ndata: ${Date.now()}\n\n`);
    }, 80);
  });
} catch (e) {
  console.warn('Could not watch deck file:', e.message);
}

server.listen(PORT, () => {
  console.log(`\n  LiveDeck running → http://localhost:${PORT}`);
  console.log(`  Editing deck     → ${DECK}\n`);
});
