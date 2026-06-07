const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const port = Number(process.argv[2] || process.env.E2E_PORT || 4173);
const root = path.resolve(__dirname, '..', '..', 'web');

const contentTypes = {
  '.bin': 'application/octet-stream',
  '.bmp': 'image/bmp',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.param': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...headers,
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = path.resolve(root, pathname.replace(/^\/+/, ''));

  if (!filePath.startsWith(root + path.sep) && filePath !== root) {
    send(res, 403, 'Forbidden', {'Content-Type': 'text/plain; charset=utf-8'});
    return;
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      send(res, 404, 'Not found', {'Content-Type': 'text/plain; charset=utf-8'});
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
    };

    res.writeHead(200, {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
      ...headers,
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`E2E server listening on http://127.0.0.1:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
