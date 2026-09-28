'use strict';
/**
 * Hockey live score poller + WebSocket server — fully isolated from the
 * cricket pipeline.
 *
 * Source: fih.hockey schedule page embeds `window.fixtureWidgetData` JSON
 * with every FIH match (live / upcoming / result). No API key needed.
 *
 * Hosts its own WebSocket server (default 8790) so the cricket poller
 * (8765) and chat server are never touched. hockey-overlay.html connects
 * here as a client.
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { WebSocketServer } = require('ws');

const WS_PORT = parseInt(process.env.HOCKEY_WS_PORT, 10) || 8790;
const POLL_INTERVAL = parseInt(process.env.HOCKEY_POLL_INTERVAL, 10) || 30000;
const SOURCE_URL =
  process.env.HOCKEY_SOURCE_URL || 'https://www.fih.hockey/schedule-fixtures-results';
// Optional team filter stamped into every payload so overlays pick the right
// match without URL params (.env: HOCKEY_TEAM=Netherlands / USA).
const TEAM_FILTER = (process.env.HOCKEY_TEAM || '').trim();

function unescapeJsString(s) {
  return s.replace(
    /\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g,
    (_, esc) => {
      if (esc[0] === 'u' || esc[0] === 'x') {
        return String.fromCharCode(parseInt(esc.slice(1), 16));
      }
      switch (esc) {
        case 'n': return '\n';
        case 't': return '\t';
        case 'r': return '\r';
        case 'b': return '\b';
        case 'f': return '\f';
        case 'v': return '\v';
        case '0': return '\0';
        default: return esc; // \\ \" \' \/ and harmless \- \{ \[ etc.
      }
    }
  );
}

// Matches a JS string literal (single or double quoted) with escape support,
// so an escaped apostrophe in a team/venue name cannot truncate the capture.
const WIDGET_RE =
  /window\.fixtureWidgetData\s*=\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/s;

function extractWidgetJson(html) {
  if (typeof html !== 'string') return null;
  const m = html.match(WIDGET_RE);
  if (!m) return null;
  try {
    return JSON.parse(unescapeJsString(m[1].slice(1, -1)));
  } catch (e) {
    console.error(`fixtureWidgetData JSON.parse failed: ${e.message}; snippet: ${m[1].slice(0, 120)}`);
    return null;
  }
}

function parseFixtureWidget(html) {
  const data = extractWidgetJson(html);
  if (!data || !Array.isArray(data.matches)) return [];
  return data.matches.filter((m) => m && m.sport === 'hockey');
}

function toScore(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function normalizeMatch(raw) {
  // FIH lists participants in display order; the is_home flag is unreliable.
  const parts = Array.isArray(raw.participants) ? raw.participants : [];
  const home = parts[0] || null;
  const away = parts[1] || null;
  const state = raw.event_state || '';
  return {
    id: raw.game_id || null,
    tournament: raw.series_name || raw.parent_series_name || '',
    stage: raw.pool || raw.event_stage || '',
    matchNo: raw.event_name || '',
    date: raw.match_date || '',
    startTime: raw.time || '',
    venue: raw.venue_name || '',
    state,
    live: state === 'L',
    finished: state === 'R',
    status: raw.event_status || '',
    period: raw.event_sub_status || '',
    home: home
      ? { name: home.name || '', short: home.short_name || '', score: toScore(home.value) }
      : null,
    away: away
      ? { name: away.name || '', short: away.short_name || '', score: toScore(away.value) }
      : null,
  };
}

function buildPayload(matches) {
  const normalized = matches.map(normalizeMatch);
  const live = normalized.filter((m) => m.live);
  const upcoming = normalized
    .filter((m) => !m.live && !m.finished)
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))
    .slice(0, 15);
  const results = normalized
    .filter((m) => m.finished)
    .sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime))
    .slice(0, 15);
  return {
    type: 'hockey',
    updatedAt: new Date().toISOString(),
    teamFilter: TEAM_FILTER || null,
    liveMatches: live,
    upcoming,
    results,
    total: normalized.length,
  };
}

async function fetchMatches() {
  const res = await fetch(SOURCE_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (stream-overlay hockey poller)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFixtureWidget(await res.text());
}

// Live clock lives on the TMS match page (tms.fih.ch/matches/<id>), embedded
// as entity-encoded JSON. The fixtures feed has no clock at all.
function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractClock(html) {
  if (typeof html !== 'string') return null;
  // The page embeds several clock blobs (stale defaults + the live state);
  // take the one furthest into the match.
  const re = /&quot;minute&quot;:(\d+),&quot;seconds&quot;:(\d+),&quot;plus&quot;:(true|false),&quot;statusminute&quot;:&quot;([\s\S]*?)&quot;/g;
  let best = null;
  let m;
  while ((m = re.exec(html)) !== null) {
    const cand = {
      minute: parseInt(m[1], 10),
      seconds: parseInt(m[2], 10),
      plus: m[3] === 'true',
      status: decodeEntities(m[4]),
    };
    if (!best || cand.seconds > best.seconds) best = cand;
  }
  return best;
}

async function fetchClock(gameId) {
  const res = await fetch(`https://tms.fih.ch/matches/${gameId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (stream-overlay hockey poller)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return extractClock(await res.text());
}

let lastPayload = null;
const clients = new Set();
// Last known clock per game — a transient TMS failure must never blank it.
const clockCache = new Map();

function broadcast(payload) {
  lastPayload = payload;
  const dataStr = JSON.stringify(payload);
  let sent = 0;
  for (const client of clients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(dataStr);
      sent++;
    }
  }
  console.log(
    `[${new Date().toISOString()}] broadcast to ${sent} client(s): ` +
      `${payload.liveMatches.length} live / ${payload.total} total`
  );
}

function startServer(port) {
  const wss = new WebSocketServer({ port });
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    // Push the latest snapshot immediately so a refreshed overlay is instant.
    if (lastPayload) ws.send(JSON.stringify(lastPayload));
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });
  wss.on('error', (e) => {
    console.error(`WS server error on port ${port}: ${e.message}`);
    if (e.code === 'EADDRINUSE') {
      console.error('port already in use — exiting so the supervisor can act');
      process.exit(1);
    }
  });
  // Heartbeat: drop half-open sockets that never pong.
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (client.isAlive === false) {
        clients.delete(client);
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, 30000);
  heartbeat.unref();
  console.log(`hockey WS server listening on ws://localhost:${port}`);
  return wss;
}

async function tick() {
  try {
    const matches = await fetchMatches();
    if (!matches.length) {
      console.warn('widget parsed but 0 hockey matches — page layout may have changed');
      return;
    }
    const payload = buildPayload(matches);
    // Enrich live matches with the TMS running clock (usually 1-3 fetches).
    await Promise.all(
      payload.liveMatches.map(async (m) => {
        if (!m.id) return;
        try {
          const clock = await fetchClock(m.id);
          if (clock) clockCache.set(m.id, clock);
        } catch (e) {
          console.warn(`clock fetch failed for match ${m.id}: ${e.message}`);
        }
        if (clockCache.has(m.id)) m.clock = clockCache.get(m.id);
      })
    );
    for (const id of clockCache.keys()) {
      if (!payload.liveMatches.some((m) => m.id === id)) clockCache.delete(id);
    }
    broadcast(payload);
  } catch (e) {
    console.error(`poll failed: ${e.message}`);
  }
}

if (require.main === module) {
  startServer(WS_PORT);
  tick();
  setInterval(tick, POLL_INTERVAL);
}

module.exports = { parseFixtureWidget, normalizeMatch, buildPayload, extractWidgetJson, extractClock, startServer };
