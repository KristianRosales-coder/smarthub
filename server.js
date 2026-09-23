// Minimal static file server for dist/ (or project root fallback).
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argPort = process.argv.find((a) => a.startsWith('--port='));
const PORT = process.env.PORT || (argPort ? argPort.split('=')[1] : 8080);
const DIST = path.join(__dirname, 'dist');
const ROOT = fs.existsSync(DIST) ? DIST : __dirname;
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.usdz': 'model/vnd.usdz+zip',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.woff2': 'font/woff2',
};

function resolveFile(urlPath) {
  const candidates = [
    path.join(ROOT, urlPath),
    path.join(PUBLIC, urlPath),
    path.join(__dirname, urlPath),
  ];
  for (const filePath of candidates) {
    if (!filePath.startsWith(__dirname)) continue;
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return filePath;
  }
  return null;
}

http
  .createServer((req, res) => {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';

    let filePath = resolveFile(urlPath);
    if (!filePath && !path.extname(urlPath)) {
      filePath = resolveFile('/index.html');
    }
    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found: ' + urlPath);
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(PORT, () => {
    console.log(`Serving ${ROOT} at http://localhost:${PORT}`);
    console.log(`  Walk-in UI:  http://localhost:${PORT}/`);
    console.log(`  Android AR:  http://localhost:${PORT}/ar.html`);
    console.log(`  iOS AR:      http://localhost:${PORT}/ios.html`);
  });
