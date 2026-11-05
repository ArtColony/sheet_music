// Serve dist/ on http://localhost:8765 (npm run serve after npm run build).
// The editor needs http(s) for pscat.wasm; sheet-music-editor-offline.html
// also works straight from disk.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const port = Number(process.env.PORT || 8765);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.ps': 'application/postscript', '.abc': 'text/plain; charset=utf-8', '.musicxml': 'application/xml', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json' };
createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(dist, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(dist)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
}).listen(port, () => console.log(`serving dist/ at http://localhost:${port}/`));
