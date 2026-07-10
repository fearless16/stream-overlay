require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

// ── Crash safety ───────────────────────────────────────────────────────────
// Log fatal errors and exit(1) so the supervisor (run.ps1) restarts us.
// History is persisted to disk, so a restart loses nothing.
function fatalExit(err) {
  console.error('[FATAL]', err && err.stack ? err.stack : err);
  process.exit(1);
}
process.on('uncaughtException', fatalExit);
process.on('unhandledRejection', (reason) => fatalExit(reason));

const VIDEO_ID = process.env.VIDEO_ID || 'Gtm65By2uwg';
const WS_PORT = parseInt(process.env.WS_PORT || '8765', 10);
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '8766', 10);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '2000', 10);
const VIEWER_POLL_INTERVAL = parseInt(process.env.VIEWER_POLL_INTERVAL || '15000', 10);
const MODE = (process.env.MODE || 'auto').trim().toLowerCase();
const RETRY_INTERVAL = parseInt(process.env.RETRY_INTERVAL || '15000', 10);

const SEEN_PATH = path.join(__dirname, '.chat_seen.json');
const HISTORY_PATH = path.join(__dirname, '.chat_history.json');

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${HTTP_PORT}`);
  let filePath = path.join(__dirname, url.pathname === '/' ? 'chat-overlay.html' : url.pathname);
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});
httpServer.listen(HTTP_PORT, () => console.log(`HTTP server on http://localhost:${HTTP_PORT}`));

const wss = new WebSocket.Server({ port: WS_PORT });
console.log(`WebSocket server on ws://localhost:${WS_PORT}`);
console.log(`Mode: ${MODE}, Video: ${VIDEO_ID}`);

let seenIds = new Set();
let continuationToken = null;
let innertubeApiKey = null;
let innertubeContext = null;
let messageHistory = [];
const MAX_HISTORY = 500;

if (fs.existsSync(HISTORY_PATH)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    messageHistory = Array.isArray(loaded) ? loaded : [];
  } catch(e) {}
}

function saveHistory() {
  try { fs.writeFileSync(HISTORY_PATH, JSON.stringify(messageHistory.slice(-MAX_HISTORY))); } catch(e) {}
}

if (fs.existsSync(SEEN_PATH)) {
  try { seenIds = new Set(JSON.parse(fs.readFileSync(SEEN_PATH, 'utf8'))); } catch(e) {}
}

function saveSeen() {
  try { fs.writeFileSync(SEEN_PATH, JSON.stringify([...seenIds].slice(-2000))); } catch(e) {}
}

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Origin': 'https://www.youtube.com',
  'Referer': `https://www.youtube.com/live_chat?v=${VIDEO_ID}`,
};

function getContinuationToken(continuations) {
  if (!continuations || !continuations.length) return null;
  const cont = continuations[0];
  const key = Object.keys(cont)[0];
  return cont[key]?.continuation || null;
}

function getContinuationTimeout(continuations) {
  if (!continuations || !continuations.length) return POLL_INTERVAL;
  const cont = continuations[0];
  const key = Object.keys(cont)[0];
  return cont[key]?.timeoutMs || POLL_INTERVAL;
}

async function bootstrapInnertube() {
  let html, watchHtml;

  // Try live_chat page first
  try {
    const res = await fetch(`https://www.youtube.com/live_chat?v=${VIDEO_ID}`, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(10000) });
    if (res.ok) html = await res.text();
  } catch (e) { /* fall through to watch page */ }

  // Fallback: try watch page for InnerTube config + chat token
  if (!html) {
    try {
      const res = await fetch(`https://www.youtube.com/watch?v=${VIDEO_ID}`, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(10000) });
      if (res.ok) watchHtml = await res.text();
    } catch (e) { /* fall through */ }
  }

  const source = html || watchHtml;
  if (!source) throw new Error('Could not fetch YouTube page');

  // Extract InnerTube API key and context from either page
  const keyMatch = source.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
  const ctxMatch = source.match(/"INNERTUBE_CONTEXT"\s*:\s*({[\s\S]+?}),\s*"INNERTUBE_/);
  if (keyMatch && ctxMatch) {
    innertubeApiKey = keyMatch[1];
    innertubeContext = JSON.parse(ctxMatch[1]);
  }

  // Try to get continuation token from liveChatRenderer
  const dataMatch = source.match(/(?:window\[")?ytInitialData(?:"\])?\s*=\s*({[\s\S]+?});\s*(?:\n|<)/);
  if (dataMatch) {
    try {
      const data = JSON.parse(dataMatch[1]);
      const continuations = data?.contents?.liveChatRenderer?.continuations;
      const token = getContinuationToken(continuations);
      if (token) return token;
    } catch (e) { /* fall through */ }
  }

  // No token found — could be offline or chat disabled; InnerTube key/context still set for viewer polling
  throw new Error('No chat continuation token');
}

function parseChatAction(action) {
  const item = action.addChatItemAction?.item;
  if (!item) return null;

  let renderer, msgType = 'chat', amount = null;

  if (item.liveChatTextMessageRenderer) {
    renderer = item.liveChatTextMessageRenderer;
  } else if (item.liveChatPaidMessageRenderer) {
    renderer = item.liveChatPaidMessageRenderer;
    msgType = 'superchat';
    amount = renderer.purchaseAmountText?.simpleText || null;
    if (!amount && renderer.purchaseAmountText?.runs) {
      amount = renderer.purchaseAmountText.runs.map(r => r.text).join('');
    }
  } else if (item.liveChatMembershipItemRenderer) {
    renderer = item.liveChatMembershipItemRenderer;
    msgType = 'membership';
  } else if (item.liveChatPaidStickerRenderer) {
    renderer = item.liveChatPaidStickerRenderer;
    msgType = 'superchat';
    amount = renderer.purchaseAmountText?.simpleText || null;
    if (!amount && renderer.purchaseAmountText?.runs) {
      amount = renderer.purchaseAmountText.runs.map(r => r.text).join('');
    }
  } else return null;

  const id = renderer.id;
  if (!id || seenIds.has(id)) return null;
  seenIds.add(id);

  const messageRuns = renderer.message?.runs;
  let text = '';
  const segments = [];

  if (messageRuns) {
    for (const r of messageRuns) {
      if (r.text) {
        segments.push({ type: 'text', value: r.text });
        text += r.text;
      } else if (r.emoji) {
        const shortcut = r.emoji.shortcuts?.[0] || '';
        const url = r.emoji.image?.thumbnails?.[0]?.url || null;
        segments.push({ type: 'emoji', value: shortcut, url });
        text += shortcut || '';
      }
    }
  } else if (renderer.message?.simpleText) {
    text = renderer.message.simpleText;
    segments.push({ type: 'text', value: renderer.message.simpleText });
  }

  let authorName = 'Viewer';
  if (renderer.authorName?.simpleText) authorName = renderer.authorName.simpleText;
  else if (renderer.authorName?.runs) {
    authorName = renderer.authorName.runs.map(r => {
      if (r.text) return r.text;
      if (r.emoji) return r.emoji.shortcuts?.[0] || r.emoji.emojiId || '';
      return '';
    }).join('');
  }

  const profileImageUrl = renderer.authorPhoto?.thumbnails?.[0]?.url || null;

  return { type: 'youtube-chat', name: authorName, text, segments, msgType, amount, profileImageUrl };
}

async function pollChat() {
  if (!continuationToken) {
    try {
      continuationToken = await bootstrapInnertube();
      console.log('Connected to live chat via InnerTube API');
    } catch (err) {
      console.error('Bootstrap error:', err.message);
      console.log(`Live chat unavailable, retrying in ${RETRY_INTERVAL}ms...`);
      setTimeout(pollChat, RETRY_INTERVAL);
      return;
    }
  }

  try {
    const apiUrl = `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${innertubeApiKey}`;
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': FETCH_HEADERS['User-Agent'],
        'Origin': 'https://www.youtube.com',
        'Referer': `https://www.youtube.com/live_chat?v=${VIDEO_ID}`,
      },
      body: JSON.stringify({
        context: innertubeContext,
        continuation: continuationToken,
      }),
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    const continuation = data?.continuationContents?.liveChatContinuation;
    if (!continuation) {
      continuationToken = null;
      setTimeout(pollChat, 15000);
      return;
    }

    const nextToken = getContinuationToken(continuation.continuations);
    if (nextToken) continuationToken = nextToken;

    const actions = continuation.actions || [];
    const newMessages = [];

    for (const action of actions) {
      let d = null;
      try { d = parseChatAction(action); } catch (e) {
        console.error('parseChatAction error (skipped):', e.message);
        continue;
      }
      if (!d) continue;
      newMessages.push(d);
      messageHistory.push(d);
      if (messageHistory.length > MAX_HISTORY) messageHistory.shift();

      const badge = d.msgType === 'superchat' ? ` [$${d.amount || 'SUPER'}]` :
                    d.msgType === 'membership' ? ' [MEMBER]' : '';
      console.log(`${d.name}${badge}: ${d.text}`);
    }
    if (newMessages.length > 0) saveHistory();

    if (newMessages.length > 0) {
      newMessages.forEach((d, i) => {
        setTimeout(() => {
          lastChatAt = Date.now();
          const payload = JSON.stringify(d);
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(payload);
          });
        }, i * 25);
      });
      console.log(`Broadcasting ${newMessages.length} messages`);
    }

    if (seenIds.size > 3000) saveSeen();
    // Never wait longer than POLL_INTERVAL for the next poll. YouTube's own
    // continuation timeout can be 8-10s; capping it removes chat "legs"/lag.
    const timeoutMs = Math.min(getContinuationTimeout(continuation.continuations) || POLL_INTERVAL, POLL_INTERVAL);
    setTimeout(pollChat, timeoutMs);
  } catch (err) {
    if (err.message.includes('404') || err.message.includes('Not Found')) {
      continuationToken = null;
    }
    setTimeout(pollChat, POLL_INTERVAL);
  }
}

let currentViewers = 0;

function broadcastViewers() {
  const payload = JSON.stringify({ type: 'viewers', count: currentViewers });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

async function fetchConcurrentViewers() {
  try {
    const url = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`watch page ${res.status}`);
    const html = await res.text();

    // Primary: parse ytInitialData for videoViewCountRenderer.originalViewCount
    const dataMatch = html.match(/ytInitialData\s*=\s*({.+?});\s*(?:\n|<)/);
    if (dataMatch) {
      try {
        const data = JSON.parse(dataMatch[1]);
        const contents = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
        for (const c of contents) {
          const vc = c?.videoPrimaryInfoRenderer?.viewCount?.videoViewCountRenderer;
          if (vc?.isLive && vc?.originalViewCount) {
            currentViewers = parseInt(vc.originalViewCount, 10) || 0;
            broadcastViewers();
            return;
          }
        }
      } catch (e) { /* fall through */ }
    }

    // Fallback 1: ytInitialPlayerResponse liveStreamingDetails.concurrentViewers
    const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});\s*(?:\n|<)/);
    if (playerMatch) {
      try {
        const playerData = JSON.parse(playerMatch[1]);
        const ld = playerData?.liveStreamingDetails;
        if (ld?.concurrentViewers) {
          currentViewers = parseInt(ld.concurrentViewers, 10) || 0;
          broadcastViewers();
          return;
        }
      } catch (e) { /* fall through */ }
    }

    // Fallback 2: regex for raw concurrentViewers in HTML
    const cvMatch = html.match(/"concurrentViewers"\s*:\s*["']?(\d+)["']?/);
    if (cvMatch) {
      currentViewers = parseInt(cvMatch[1], 10) || 0;
      broadcastViewers();
    }
  } catch (err) {
    // stream might be offline — that's fine, just don't update
  }
}

function startViewerPolling() {
  fetchConcurrentViewers();
  setInterval(fetchConcurrentViewers, VIEWER_POLL_INTERVAL);
}

// ─────────────────────────────────────────────────────────────────────────
// OBS metrics — feeds the streamer-only dashboard (served on the HTTP port,
// never added to an OBS scene, so viewers never see it).
// ─────────────────────────────────────────────────────────────────────────
let lastChatAt = 0;
const OBS_WS_PORT = parseInt(process.env.OBS_WS_PORT || '4455', 10);
let obsClient = null;
let obsConnected = false;
let metricsTimer = null;

function classifyInput(inp) {
  const k = inp.inputKind || '';
  if (/wasapi_input|pulse_input|coreaudio_input|alsa_input|jack_input/i.test(k)) return 'mic';
  if (/dshow_input|v4l2_input|av_capture_input|decklink|ndi_source|video_capture_device/i.test(k)) return 'camera';
  return null;
}

function broadcastMetrics() {
  const payload = JSON.stringify({
    type: 'metrics',
    obs: { connected: obsConnected },
    mic: null, camera: null,
    chat: { bridge: true, fake: false, lastChatAt },
    ts: Date.now(),
  });
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
}

async function enrichInput(dev) {
  if (!dev) return null;
  try {
    const mute = await obsClient.call('GetInputMute', { inputName: dev.name }).catch(() => ({ inputMuted: false }));
    const vol = await obsClient.call('GetInputVolume', { inputName: dev.name }).catch(() => ({ inputVolumeMul: 1 }));
    return { name: dev.name, kind: dev.kind, connected: dev.enabled, muted: !!mute.inputMuted, volume: vol.inputVolumeMul ?? 1 };
  } catch (e) {
    return { name: dev.name, kind: dev.kind, connected: dev.enabled };
  }
}

async function gatherObsMetrics() {
  if (!obsConnected || !obsClient) return;
  try {
    const [stats, inputs, stream, rec] = await Promise.all([
      obsClient.call('GetStats').catch(() => null),
      obsClient.call('GetInputList').catch(() => ({ inputs: [] })),
      obsClient.call('GetStreamStatus').catch(() => null),
      obsClient.call('GetRecordStatus').catch(() => null),
    ]);
    const list = (inputs.inputs || []).map(i => ({
      name: i.inputName, kind: i.inputKind,
      type: classifyInput(i), enabled: i.inputEnabled !== false,
    }));
    const mic = await enrichInput(list.find(i => i.type === 'mic') || null);
    const camera = await enrichInput(list.find(i => i.type === 'camera') || null);
    const payload = JSON.stringify({
      type: 'metrics',
      obs: {
        connected: true,
        streaming: !!(stream && stream.outputActive),
        recording: !!(rec && rec.outputActive),
        bitrate: stats ? stats.outputBitrate : null,
        fps: stats ? stats.fps : null,
        droppedFrames: stats ? stats.outputSkippedFrames : null,
        skippedFrames: stats ? stats.renderSkippedFrames : null,
      },
      mic, camera,
      chat: { bridge: true, fake: false, lastChatAt },
      ts: Date.now(),
    });
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
  } catch (e) {
    console.error('[OBS metrics] gather error:', e.message);
  }
}

async function connectOBS() {
  try {
    const OBSWebSocket = require('obs-websocket-js').default;
    obsClient = new OBSWebSocket();
    obsClient.on('ConnectionClosed', () => { obsConnected = false; console.log('[OBS] disconnected'); broadcastMetrics(); });
    obsClient.on('ConnectionError', () => { obsConnected = false; });
    let password = '';
    const cfgPath = path.join(process.env.APPDATA, 'obs-studio', 'plugin_config', 'obs-websocket', 'config.json');
    if (fs.existsSync(cfgPath)) {
      try { password = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).server_password || ''; } catch (_) {}
    }
    await obsClient.connect(`ws://localhost:${OBS_WS_PORT}`, password, { rpcVersion: 1 });
    obsConnected = true;
    console.log('[OBS] connected (metrics)');
    broadcastMetrics();
    if (!metricsTimer) metricsTimer = setInterval(gatherObsMetrics, 2000);
  } catch (e) {
    obsConnected = false;
    obsClient = null;
    console.log('[OBS] metrics unavailable, retry in 5s:', e.message);
    setTimeout(connectOBS, 5000);
  }
}

(async () => {
  console.log(`Chat server for video: ${VIDEO_ID}`);
  pollChat();
  startViewerPolling();
  connectOBS();

  wss.on('connection', ws => {
    console.log('Client connected');
     ws.send(JSON.stringify({ type: 'connected', message: 'YouTube Chat Bridge ready', fake: false, mode: MODE }));
    ws.send(JSON.stringify({ type: 'viewers', count: currentViewers }));
    const replay = messageHistory.slice(-200);
    if (replay.length > 0) {
      replay.forEach((msg, i) => {
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ ...msg, isHistory: true }));
        }, i * 10);
      });
      console.log(`Replayed ${replay.length} historical messages to new client`);
    }
    ws.on('message', raw => {
      try {
        const data = JSON.parse(raw.toString());
        if (['score', 'goals', 'show-comment', 'hide-comment', 'youtube-chat', 'replay', 'score-visible'].includes(data.type)) {
          wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) client.send(raw.toString());
          });
          if (data.type !== 'youtube-chat') console.log('[Relay]', data.type, 'forwarded');
        }
      } catch (e) { /* ignore invalid JSON */ }
    });
  });

  console.log('Waiting for messages...');
})();
