import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { createGzip } from 'node:zlib';

const release = process.argv.includes('--release');
const mode = release ? 'release' : 'test';
const root = fileURLToPath(new URL(release ? '../dist/' : '../.local/test-web/', import.meta.url));
const requestedPort = Number(process.argv.find((arg) => arg.startsWith('--port='))?.slice(7) || 4173);
if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65525) throw new Error('Invalid port');
let port = requestedPort;
let url = `http://127.0.0.1:${port}`;
const host = '0.0.0.0';
const appId = 'sweet-cube-puzzle';
const shouldOpen = process.argv.includes('--open');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

function openBrowser() {
  if (!shouldOpen) return;
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => console.log(`Please open ${url} in your browser.`));
  child.unref();
}

await stat(path.join(root, 'index.html')).catch(() => { throw new Error(`Build missing. Run npm run ${release ? 'build' : 'build:test'} first.`); });
const server = http.createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, url).pathname); }
  catch { response.writeHead(400).end(); return; }
  if (pathname === '/__puzzle_health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ app: appId, host, port, mode })); return;
  }
  const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(path.resolve(root) + path.sep)) { response.writeHead(403).end(); return; }
  try {
    const info = await stat(file);
    if (!info.isFile()) { response.writeHead(404).end(); return; }
    const ext = path.extname(file), versionedImage = ext === '.webp' && new URL(request.url, url).searchParams.has('v');
    const name = path.basename(file);
    const immutable = versionedImage || /-[\w-]{8,}\.(js|css)$/.test(name) || /^cube-previews-[\w-]{8,}\.webp$/.test(name);
    const etag = `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
    const compressible = ['.html', '.js', '.css', '.json', '.svg'].includes(ext) && info.size > 1024;
    const gzip = compressible && /\bgzip\b/.test(request.headers['accept-encoding'] || '');
    const headers = { 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', 'ETag': etag, 'X-Content-Type-Options': 'nosniff' };
    if (compressible) headers.Vary = 'Accept-Encoding';
    if (request.headers['if-none-match'] === etag) { response.writeHead(304, headers).end(); return; }
    if (gzip) headers['Content-Encoding'] = 'gzip'; else headers['Content-Length'] = info.size;
    response.writeHead(200, headers);
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = createReadStream(file);
    stream.on('error', () => response.destroy());
    if (gzip) { const encoder = createGzip({ level: 6 }); encoder.on('error', () => response.destroy()); stream.pipe(encoder).pipe(response); }
    else stream.pipe(response);
  } catch { response.writeHead(404).end('Not found'); }
});

server.on('error', async (error) => {
  if (error.code === 'EADDRINUSE') {
    try {
      const response = await fetch(`${url}/__puzzle_health`, { signal: AbortSignal.timeout(1500) });
      const running = await response.json();
      if (running.app === appId && running.host === host && running.mode === mode) { console.log(`Game already running (${mode}): ${url}`); openBrowser(); return; }
    } catch { /* Another app owns the port. */ }
    if (port < requestedPort + 9) {
      port++; url = `http://127.0.0.1:${port}`;
      server.listen(port, host); return;
    }
    console.error(`Ports ${requestedPort}-${port} are in use. Specify another port with --port=4183.`);
  } else console.error(error.message);
  process.exitCode = 1;
});
server.on('listening', () => {
  const addresses = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${port}`);
  console.log(`\nSweet Cube\n\n  Local: ${url}\n${addresses.map((address) => `  LAN:   ${address}`).join('\n')}\n\nKeep this window open while playing. Press Ctrl+C to stop.\n`);
  openBrowser();
});
server.listen(port, host);
process.once('SIGINT', () => server.close());
process.once('SIGTERM', () => server.close());
