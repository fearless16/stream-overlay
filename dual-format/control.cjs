'use strict';

// Loopback-only operator page for the dual go-live sequence. Opt-in: start with
// `npm run dual-live`. It never starts a feed on its own; every start or stop needs
// an explicit arm step followed by a single-use confirmation from the page.

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PAGE = path.join(__dirname, 'go-live.html');
const MAX_BODY = 1024;
const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const POST_ROUTES = new Set(['/api/arm', '/api/go-live', '/api/stop']);

function createControlServer({ controller, port = 8768, log = () => {} }) {
  const page = fs.readFileSync(PAGE);
  let bound = port;
  const hosts = () => [`127.0.0.1:${bound}`, `localhost:${bound}`];
  const origins = () => [`http://127.0.0.1:${bound}`, `http://localhost:${bound}`];

  function send(res, status, body, type = 'application/json; charset=utf-8') {
    if (res.headersSent) return res.end();
    res.writeHead(status, {
      'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP,
    });
    res.end(Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body));
  }
  const refuse = (res, status, error) => send(res, status, { error });

  // Drains the body but keeps only MAX_BODY bytes, so an oversized request gets a clean 413.
  function readJson(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size <= MAX_BODY) chunks.push(chunk);
      });
      req.on('end', () => {
        if (size > MAX_BODY) return reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        try {
          const value = size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
          // Only a JSON object is a request body: null, arrays and scalars would reach body.action as a TypeError.
          if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('not an object');
          resolve(value);
        }
        catch { reject(Object.assign(new Error('Body must be a JSON object'), { status: 400 })); }
      });
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      // Host must be the loopback name we bound: blocks DNS rebinding onto this port.
      if (!hosts().includes(req.headers.host)) return refuse(res, 403, 'Open the control page at its loopback address');
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/go-live.html')) {
        return send(res, 200, page, 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, await controller.status());
      if (req.method !== 'POST' || !POST_ROUTES.has(url.pathname)) return refuse(res, 404, 'Not found');
      // Cross-site pages cannot send the custom header without a preflight we never grant.
      if (req.headers.origin !== undefined && !origins().includes(req.headers.origin)) return refuse(res, 403, 'Cross-origin request refused');
      if (req.headers['x-dual-control'] !== '1') return refuse(res, 403, 'Missing control header');
      if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return refuse(res, 415, 'Send JSON');
      const body = await readJson(req);
      if (url.pathname === '/api/arm') return send(res, 200, controller.arm(body.action));
      if (url.pathname === '/api/go-live') return send(res, 200, await controller.goLive(body.token));
      return send(res, 200, await controller.stop(body.scope, body.token));
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 500;
      if (status === 500) log(`[dual-live] internal error: ${error.message}`);
      refuse(res, status, status === 500 ? 'Unexpected error; see the console' : error.message);
    }
  });
  server.keepAliveTimeout = 5000;

  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          bound = server.address().port;
          resolve(bound);
        });
      });
    },
    close() {
      return new Promise(resolve => {
        server.closeAllConnections?.();
        server.close(resolve);
      });
    },
  };
}

async function main() {
  const { Feed, gate, browserHealth, distinctYouTubeKeys } = require('./ops.cjs');
  const { mainRoot, root } = require('./setup.cjs');
  const { createGoLive } = require('./go-live.cjs');
  const port = Number(process.env.DUAL_CONTROL_PORT || 8768);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('DUAL_CONTROL_PORT must be an integer from 1024 to 65535');
  const horizontal = new Feed('horizontal', mainRoot, 4455);
  const vertical = new Feed('vertical', root, 4456);
  const controller = createGoLive({ horizontal, vertical, browserHealth, gate, keysOk: distinctYouTubeKeys, log: line => console.log(line) });
  const service = createControlServer({ controller, port, log: line => console.error(line) });
  const bound = await service.listen();
  console.log(`Dual go-live control: http://127.0.0.1:${bound}/ (loopback only). Ctrl+C stops this control; OBS keeps running.`);
  const shutdown = async () => {
    await service.close();
    await Promise.all([horizontal.disconnect(), vertical.disconnect()]);
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { createControlServer };
