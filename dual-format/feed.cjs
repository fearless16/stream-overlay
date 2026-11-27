'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocket, WebSocketServer } = require('ws');

const COMMENT_MS = 10_000;
const MAX_PENDING = 32_768;
const isLocal = addr => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr);

function text(value, limit) {
  if (typeof value !== 'string') return '';
  const clean = value.slice(0, limit * 4).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().replace(/\s+/g, ' ');
  return Array.from(clean).slice(0, limit).join('');
}

function createPortraitFeed({ port = 8767, now = Date.now, onError = console.error } = {}) {
  let comment = null;
  const clients = new Map();
  const assets = new Map([
    ['/portrait-overlay.html', 'text/html; charset=utf-8'],
    ['/portrait.css', 'text/css; charset=utf-8'],
    ['/portrait.js', 'application/javascript; charset=utf-8'],
  ]);

  function snapshot() {
    const time = now();
    if (comment && comment.until <= time) comment = null;
    return { type: 'portrait', now: time, comment };
  }

  function send(ws, payload) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount >= MAX_PENDING) ws.terminate();
    else ws.send(payload);
  }

  function publish() {
    if (!clients.size) return;
    const payload = JSON.stringify(snapshot());
    for (const ws of clients.keys()) send(ws, payload);
  }

  function ingest(address, data) {
    if (!isLocal(address) || !data) return;
    if (data.type === 'portrait-comment' && !data.isHistory) {
      const id = text(data.id, 128);
      const name = text(data.name, 28);
      const message = text(data.text, 96);
      if (!id || !name || !message) return;
      const time = now();
      if (comment?.id === id && comment.until > time) return;
      comment = { name, text: message, id, until: time + COMMENT_MS };
      publish();
    } else if (data.type === 'portrait-hide-comment' && comment && (data.id === undefined || text(data.id, 128) === comment.id)) {
      comment = null;
      publish();
    }
  }

  const server = http.createServer({ requestTimeout: 5000, headersTimeout: 5000, maxHeaderSize: 4096 }, (req, res) => {
    const pathname = (req.url || '').split('?')[0];
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') return res.writeHead(405).end();
    if (pathname === '/health') {
      const time = now();
      const lastRendered = Math.max(0, ...Array.from(clients.values(), state => state.rendered));
      const browserAgeMs = lastRendered ? time - lastRendered : null;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ status: browserAgeMs != null && browserAgeMs <= 12_000 ? 'healthy' : 'waiting',
        browserAgeMs, browsers: clients.size }));
    }
    const type = assets.get(pathname);
    if (!type) return res.writeHead(404).end();
    fs.readFile(path.join(__dirname, pathname.slice(1)), (err, data) => {
      if (err) return res.writeHead(500).end();
      res.setHeader('Content-Type', type);
      res.end(data);
    });
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 128, perMessageDeflate: false });
  server.on('error', error => onError(`[Portrait] loopback service unavailable (${error.code || 'unknown'})`));
  server.on('upgrade', (req, socket, head) => {
    const origin = req.headers.origin;
    if (req.url !== '/feed' || clients.size >= 8 ||
        (origin !== 'null' && origin !== `http://127.0.0.1:${server.address()?.port}`)) return socket.destroy();
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    const state = { rendered: 0, joined: now() };
    clients.set(ws, state);
    ws.on('error', () => ws.terminate());
    ws.on('close', () => clients.delete(ws));
    ws.on('message', (message, binary) => {
      if (!binary && message.toString() === 'rendered') state.rendered = now();
      else ws.close(1008);
    });
    send(ws, JSON.stringify(snapshot()));
  });
  const tick = setInterval(() => {
    const time = now();
    for (const [ws, state] of clients) {
      if (time - (state.rendered || state.joined) > 25_000) ws.terminate();
    }
    publish();
  }, 5000);
  tick.unref();
  server.listen(port, '127.0.0.1');
  return {
    server, ingest, snapshot,
    retract(id) {
      if (comment && comment.id === text(id, 128)) { comment = null; publish(); }
    },
    close() {
      clearInterval(tick);
      for (const ws of clients.keys()) ws.terminate();
      wss.close();
      return new Promise(resolve => server.close(resolve));
    },
  };
}

module.exports = { createPortraitFeed, COMMENT_MS };
