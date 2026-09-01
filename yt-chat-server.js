require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const {
  extractInitialData,
  getLiveChatContinuations,
  getContinuationToken,
  getContinuationTimeout,
} = require('./chat-bootstrap.js');

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
const YOUTUBE_API_KEY = (process.env.YOUTUBE_API_KEY || '').trim();
const YOUTUBE_COOKIES = (process.env.YOUTUBE_COOKIES || '').trim();
const COOKIES_FILE = (process.env.COOKIES_FILE || '').trim();

// Subscriber milestone widget — the channel whose sub count we announce and the
// target the count-up animation runs toward. Polled via the (quota-funded) Data
// API, so it must never be called faster than SUB_POLL_INTERVAL and must back
// off on errors instead of hammering (see updateSubscribers below).
const CHANNEL_ID = (process.env.CHANNEL_ID || 'UCQtCMKPc41MHd7hujVuGm5g').trim();
const SUB_GOAL = parseInt(process.env.SUB_GOAL || '500', 10) || 500;
const SUB_POLL_INTERVAL = parseInt(process.env.SUB_POLL_INTERVAL || '60000', 10) || 60000;

// Load cookies for authenticated requests (needed for private/unlisted streams)
let authCookies = YOUTUBE_COOKIES;
if (!authCookies && COOKIES_FILE && fs.existsSync(COOKIES_FILE)) {
  try {
    const raw = fs.readFileSync(COOKIES_FILE, 'utf8');
    // Support both Netscape format and raw cookie string
    authCookies = raw.split('\n')
      .filter(l => l && !l.startsWith('#') && !l.startsWith('Http') && l.includes('\t'))
      .map(l => l.split('\t'))
      .filter(parts => parts.length >= 7)
      .map(parts => `${parts[5]}=${parts[6]}`)
      .join('; ');
    if (!authCookies) authCookies = raw.trim();
  } catch (e) {
    console.error('[Cookies] Failed to load:', e.message);
  }
}

// Cache of active chat messages by ID — used to preserve retracted messages
const messageCache = new Map();
const MAX_CACHE_SIZE = 500;

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

function withCookies(headers) {
  if (authCookies) {
    return { ...headers, 'Cookie': authCookies };
  }
  return headers;
}

const FETCH_HEADERS = withCookies({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Origin': 'https://www.youtube.com',
  'Referer': `https://www.youtube.com/live_chat?v=${VIDEO_ID}`,
});

async function bootstrapInnertube() {
  const fetchPage = async (url) => {
    try {
      const res = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(10000) });
      return res.ok ? await res.text() : null;
    } catch (e) { return null; }
  };

  // Returns the continuation token if the page carries a live chat renderer,
  // and (re)sets the InnerTube API key/context from that same page.
  const tokenFromSource = (source) => {
    if (!source) return null;
    const keyMatch = source.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
    const ctxMatch = source.match(/"INNERTUBE_CONTEXT"\s*:\s*({[\s\S]+?}),\s*"INNERTUBE_/);
    if (keyMatch && ctxMatch) {
      innertubeApiKey = keyMatch[1];
      try { innertubeContext = JSON.parse(ctxMatch[1]); } catch (e) { /* keep old context */ }
    }
    const continuations = getLiveChatContinuations(extractInitialData(source));
    return getContinuationToken(continuations);
  };

  // The live_chat page has become a JS shell that no longer embeds the chat
  // renderer, so a *successful* fetch there no longer guarantees a token.
  // Try it first (cheaper), but fall through to the watch page — which still
  // carries the nested conversationBar.liveChatRenderer — whenever no token
  // comes out. Only a page that yields a continuation is usable.
  const html = await fetchPage(`https://www.youtube.com/live_chat?v=${VIDEO_ID}`);
  let token = tokenFromSource(html);
  if (!token) {
    const watchHtml = await fetchPage(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
    token = tokenFromSource(watchHtml);
  }

  if (token) return token;
  // No token found — could be offline or chat disabled; InnerTube key/context
  // may still be set for viewer polling.
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
  const authorChannelId = renderer.authorExternalChannelId || null;

  return { id, authorChannelId, type: 'youtube-chat', name: authorName, text, segments, msgType, amount, profileImageUrl };
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
      headers: withCookies({
        'Content-Type': 'application/json',
        'User-Agent': FETCH_HEADERS['User-Agent'],
        'Origin': 'https://www.youtube.com',
        'Referer': `https://www.youtube.com/live_chat?v=${VIDEO_ID}`,
      }),
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
    const retractedIds = [];

    for (const action of actions) {
      // ── Detect retraction actions ─────────────────────────────────────────
      const removeAction = action.removeChatItemAction ||
                           action.markChatItemAsDeletedAction;
      if (removeAction?.target_item_id) {
        retractedIds.push({
          id: removeAction.target_item_id,
          deletedStateMessage: removeAction.deletedStateMessage?.runs?.[0]?.text ||
                               removeAction.deletedStateMessage?.simpleText || null,
        });
        continue;
      }
      if (action.markChatItemsByAuthorAsDeletedAction?.externalChannelId) {
        // Retract ALL messages by this author
        const authorId = action.markChatItemsByAuthorAsDeletedAction.externalChannelId;
        const delMsg = action.markChatItemsByAuthorAsDeletedAction.deletedStateMessage?.runs?.[0]?.text ||
                       action.markChatItemsByAuthorAsDeletedAction.deletedStateMessage?.simpleText || null;
        // Find all cached messages by this author and retract each
        for (const [msgId, msg] of messageCache) {
          if (msg.authorChannelId === authorId) {
            retractedIds.push({ id: msgId, deletedStateMessage: delMsg, authorId });
          }
        }
        continue;
      }

      let d = null;
      try { d = parseChatAction(action); } catch (e) {
        console.error('parseChatAction error (skipped):', e.message);
        continue;
      }
      if (!d) continue;

      // Cache the message so we can show it if it gets retracted later
      if (d.id) {
        messageCache.set(d.id, d);
        if (messageCache.size > MAX_CACHE_SIZE) {
          const firstKey = messageCache.keys().next().value;
          if (firstKey) messageCache.delete(firstKey);
        }
      }

      newMessages.push(d);
      messageHistory.push(d);
      if (messageHistory.length > MAX_HISTORY) messageHistory.shift();

      const badge = d.msgType === 'superchat' ? ` [$${d.amount || 'SUPER'}]` :
                    d.msgType === 'membership' ? ' [MEMBER]' : '';
      console.log(`${d.name}${badge}: ${d.text}`);

      // Track recent unique chatters for like-event name pairing
      if (d.name && !recentChatters.includes(d.name)) {
        recentChatters.push(d.name);
        if (recentChatters.length > 10) recentChatters.shift();
        // Expire old names after 60s
        setTimeout(() => {
          const idx = recentChatters.indexOf(d.name);
          if (idx !== -1) recentChatters.splice(idx, 1);
        }, 60000);
      }
    }

    // ── Broadcast retracted messages ────────────────────────────────────────
    for (const r of retractedIds) {
      const retractedMsg = messageCache.get(r.id) || null;
      const payload = JSON.stringify({
        type: 'retracted',
        targetId: r.id,
        deletedStateMessage: r.deletedStateMessage || null,
        message: retractedMsg, // null if we never saw the original
      });
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(payload);
      });
      if (retractedMsg) {
        console.log(`[RETRACTED] ${retractedMsg.name}: ${retractedMsg.text}`);
      } else {
        console.log(`[RETRACTED] unknown message ${r.id}`);
      }
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
let currentLikeCount = 0;
let likeCountInitialized = false;
let recentChatters = [];

function broadcastViewers() {
  const payload = JSON.stringify({ type: 'viewers', count: currentViewers });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

// The Data API costs 1 quota unit per call (10k/day free) and can lag a live
// stream's like count by minutes, so it's used ONLY as a fallback when the
// free HTML scrape fails — and never more often than once a minute.
const LIKE_API_MIN_GAP_MS = 60000;
let lastLikeApiCall = 0;

async function fetchLikeCountFromAPI() {
  if (!YOUTUBE_API_KEY) return null;
  const now = Date.now();
  if (now - lastLikeApiCall < LIKE_API_MIN_GAP_MS) return null;
  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${VIDEO_ID}&key=${YOUTUBE_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    lastLikeApiCall = Date.now();
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    const count = data?.items?.[0]?.statistics?.likeCount;
    return count ? parseInt(count, 10) : null;
  } catch (e) {
    console.error('[Like API]', e.message);
    return null;
  }
}

// Parse a like-count string in YouTube's formats: "2", "1,234", "49K", "1.2M".
function parseLikeCountString(s) {
  if (!s) return null;
  const t = s.trim().toUpperCase();
  const m = t.match(/^([\d.,]+)\s*([KMB])?$/);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ''));
  if (isNaN(n)) return null;
  if (m[2] === 'K') n *= 1000;
  else if (m[2] === 'M') n *= 1000000;
  else if (m[2] === 'B') n *= 1000000000;
  return Math.round(n);
}

function extractLikeCount(html) {
  try {
    // Precise counter first: the watch page embeds the exact like count in
    // ytInitialData / player response as "likeCount". It appears once on the
    // page, so the raw regex is exact — and exact numbers keep the animation
    // reactive on single-digit increments (the button's display title below is
    // rounded, e.g. "1.2K", and only moves every 100 likes).
    const lcMatch = html.match(/"likeCount"\s*:\s*"?(\d+)"?/);
    if (lcMatch) return parseInt(lcMatch[1], 10);
    // NEW button layout (2024+): the like count also lives in the button's own
    // title, e.g. segmentedLikeDislikeButtonViewModel > likeButtonViewModel >
    // ... > buttonViewModel { "iconName":"LIKE", "title":"49K", ... }.
    const newBtn = html.match(/"iconName"\s*:\s*"LIKE"\s*,\s*"title"\s*:\s*"([^"]+)"/);
    if (newBtn) {
      const n = parseLikeCountString(newBtn[1]);
      if (n != null) return n;
    }
    const dataMatch = html.match(/ytInitialData\s*=\s*({.+?});\s*(?:\n|<)/);
    if (dataMatch) {
      const data = JSON.parse(dataMatch[1]);
      const contents = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
      for (const c of contents) {
        const vip = c?.videoPrimaryInfoRenderer;
        if (vip) {
          const buttons = vip?.videoActions?.menuRenderer?.topLevelButtons || [];
          for (const b of buttons) {
            const tb = b?.segmentedLikeDislikeButtonRenderer?.likeButton?.toggleButtonRenderer;
            if (tb) {
              const label = tb?.defaultText?.accessibility?.accessibilityData?.label || '';
              const num = label.match(/([\d,]+)/);
              if (num) return parseInt(num[1].replace(/,/g, ''), 10);
            }
          }
        }
      }
    }
    const ariaMatch = html.match(/aria-label\s*=\s*"([^"]*(?:like|thumbs up)[^"]*?)"/i);
    if (ariaMatch) {
      const num = ariaMatch[1].match(/([\d,]+)/);
      if (num) return parseInt(num[1].replace(/,/g, ''), 10);
    }
  } catch (e) { /* best effort */ }
  return null;
}

function broadcastLike() {
  const name = recentChatters.shift() || null;
  const payload = JSON.stringify({ type: 'like', count: currentLikeCount, name });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

async function fetchEngagementData() {
  try {
    const url = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
    const res = await fetch(url, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`watch page ${res.status}`);
    const html = await res.text();

    // ── Viewers ────────────────────────────────────────────────────────────
    let viewersChanged = false;
    const dataMatch = html.match(/ytInitialData\s*=\s*({.+?});\s*(?:\n|<)/);
    if (dataMatch) {
      try {
        const data = JSON.parse(dataMatch[1]);
        const contents = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
        for (const c of contents) {
          const vc = c?.videoPrimaryInfoRenderer?.viewCount?.videoViewCountRenderer;
          if (vc?.isLive && vc?.originalViewCount) {
            const v = parseInt(vc.originalViewCount, 10) || 0;
            if (v !== currentViewers) viewersChanged = true;
            currentViewers = v;
            break;
          }
        }
      } catch (e) { /* fall through */ }
    }
    if (!viewersChanged) {
      const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});\s*(?:\n|<)/);
      if (playerMatch) {
        try {
          const playerData = JSON.parse(playerMatch[1]);
          const ld = playerData?.liveStreamingDetails;
          if (ld?.concurrentViewers) {
            const v = parseInt(ld.concurrentViewers, 10) || 0;
            if (v !== currentViewers) viewersChanged = true;
            currentViewers = v;
          }
        } catch (e) { /* fall through */ }
      }
    }
    if (!viewersChanged) {
      const cvMatch = html.match(/"concurrentViewers"\s*:\s*["']?(\d+)["']?/);
      if (cvMatch) {
        const v = parseInt(cvMatch[1], 10) || 0;
        if (v !== currentViewers) viewersChanged = true;
        currentViewers = v;
      }
    }
    if (viewersChanged) broadcastViewers();

    // ── Like Count ─────────────────────────────────────────────────────────
    // HTML scrape first: it's free and near-real-time (the raw "likeCount"
    // field is exact). The Data API only steps in when the scrape fails, at
    // most once a minute, so quota stays untouched in normal operation.
    let newCount = extractLikeCount(html);
    if (newCount === null && YOUTUBE_API_KEY) {
      newCount = await fetchLikeCountFromAPI();
    }
    if (newCount !== null) {
      if (!likeCountInitialized) {
        currentLikeCount = newCount;
        likeCountInitialized = true;
      } else if (newCount > currentLikeCount) {
        currentLikeCount = newCount;
        broadcastLike();
      } else {
        currentLikeCount = newCount;
      }
    }
  } catch (err) {
    // stream might be offline — that's fine, just don't update
  }
}

function startEngagementPolling() {
  fetchEngagementData();
  setInterval(fetchEngagementData, VIEWER_POLL_INTERVAL);
}

// ─────────────────────────────────────────────────────────────────────────
// Subscriber milestone widget — lives on the overlay's own corner widget, not
// the dashboard. Fetches the channel's real subscriber count from the YouTube
// Data API (quota-funded) and broadcasts it so the overlay can run its
// count-up-to-`SUB_GOAL` animation.
// ─────────────────────────────────────────────────────────────────────────
let currentSubscribers = null;   // last known real count (null until first read)
let currentSubGoal = SUB_GOAL;

// Quota + rate guard: the Data API costs 1 unit/call (10k/day free). Bring the
// poll interval down only when a poll actually succeeds; on failure we back off
// so repeated errors never burn quota or spam the log.
let lastSubApiCall = 0;
let subBackoffMs = 0;

function broadcastSubscribers() {
  const payload = JSON.stringify({
    type: 'subscribers',
    count: currentSubscribers,
    goal: currentSubGoal,
    remaining: currentSubscribers == null ? null : Math.max(0, currentSubGoal - currentSubscribers),
  });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

// Fetch the channel's subscriber count from the Data API. Returns the integer
// count, or null when the API key is missing / the network fails / quota is
// exhausted. Never throws.
async function fetchSubscriberCount() {
  if (!YOUTUBE_API_KEY) return null;
  const now = Date.now();
  if (now - lastSubApiCall < (SUB_POLL_INTERVAL + subBackoffMs)) return null;
  try {
    lastSubApiCall = now;
    const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(CHANNEL_ID)}&key=${YOUTUBE_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        // Quota exhausted / rate limited — extend backoff so we don't hammer.
        subBackoffMs = Math.min((subBackoffMs || 60000) * 2, 60 * 60 * 1000);
      }
      throw new Error(`Data API ${res.status}`);
    }
    const data = await res.json();
    const countStr = data?.items?.[0]?.statistics?.subscriberCount;
    if (countStr == null) throw new Error('no subscriberCount');
    // A successful call resets the backoff so the next failure starts fresh.
    if (subBackoffMs !== 0) subBackoffMs = 0;
    return parseInt(countStr, 10) || null;
  } catch (e) {
    console.error('[Subscribers]', e.message);
    return null;
  }
}

async function updateSubscribers() {
  const count = await fetchSubscriberCount();
  if (count !== null && count !== currentSubscribers) {
    currentSubscribers = count;
    broadcastSubscribers();
    console.log(`[Subscribers] ${count} (goal ${currentSubGoal})`);
  }
}

function startSubscriberPolling() {
  updateSubscribers();
  setInterval(updateSubscribers, SUB_POLL_INTERVAL);
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
  startEngagementPolling();
  startSubscriberPolling();
  connectOBS();

  wss.on('connection', ws => {
    console.log('Client connected');
     ws.send(JSON.stringify({ type: 'connected', message: 'YouTube Chat Bridge ready', fake: false, mode: MODE }));
    ws.send(JSON.stringify({ type: 'viewers', count: currentViewers }));
    ws.send(JSON.stringify({ type: 'subscribers', count: currentSubscribers, goal: currentSubGoal, remaining: currentSubscribers == null ? null : Math.max(0, currentSubGoal - currentSubscribers) }));
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
