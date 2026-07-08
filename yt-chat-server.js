require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const VIDEO_ID = process.env.VIDEO_ID || 'Gtm65By2uwg';
const WS_PORT = parseInt(process.env.WS_PORT || '8765', 10);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '3000', 10);
const VIEWER_POLL_INTERVAL = parseInt(process.env.VIEWER_POLL_INTERVAL || '15000', 10);

// ── Agent 1: Chat reliability tuning ──────────────────────────────────────────
const CHAT_FETCH_TIMEOUT = 10000;       // hard fetch timeout (spec: 10 sec)
const CHAT_MAX_BACKOFF = 60000;         // cap exponential backoff
const CONTINUATION_EXPIRY_MS = 120000;  // a continuation older than this is regenerated
const CHAT_WATCHDOG_MS = 45000;         // if no chat for this long, force re-init
const QUEUE_MAX = 500;                  // queue overflow protection (Agent 1)
const HEARTBEAT_INTERVAL = 2000;        // overlay heartbeat (Agent 3) every 2s

const SEEN_PATH = path.join(__dirname, '.chat_seen.json');
const HISTORY_PATH = path.join(__dirname, '.chat_history.json');

const wss = new WebSocket.Server({ port: WS_PORT });
console.log(`WebSocket server on ws://localhost:${WS_PORT}`);

let seenIds = new Set();
let continuationToken = null;
let continuationFetchedAt = 0;          // Agent 1: timestamp the token was obtained
let messageHistory = [];
let usingFake = false;
let fakeInterval = null;
let everHadRealChat = false;  // once true, never allow fake messages
let innertubeApiKey = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'; // default, refreshed from page
let innertubeClientVersion = '2.20260706.00.00';                  // refreshed from page

// Startup timeout — if the first real chat poll doesn't succeed in 30s, exit cleanly
const STARTUP_TIMEOUT = 30000;
let _startupTimer = setTimeout(() => {
  if (usingFake) {
    console.error(`[Fatal] No real chat after ${STARTUP_TIMEOUT/1000}s — server exiting. YouTube may be blocking requests.`);
    process.exit(1);
  }
}, STARTUP_TIMEOUT);
const MAX_HISTORY = 50;

// Agent 1: queue + watchdog + last-message bookkeeping
let broadcastQueue = [];
let queueTimer = null;
let lastChatAt = Date.now();
let chatWatchdogTimer = null;
let chatRetryAttempts = 0;              // exponential backoff counter
let pollInFlight = false;              // guard against overlapping polls

// Never load history on startup — stale fakes could leak. History is only loaded
// when entering fake mode (startFakeChat). In real mode messageHistory starts empty.
if (fs.existsSync(HISTORY_PATH)) {
  try { fs.unlinkSync(HISTORY_PATH); } catch(e) {}
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

const FAKE_NAMES = [
  'Rahul Sharma', 'Priya Patel', 'Amit Singh', 'Sneha Reddy', 'Vikram Joshi',
  'Ananya Gupta', 'Rohit Kumar', 'Neha Verma', 'Arjun Nair', 'Kavya Iyer',
  'Deepak Chauhan', 'Pooja Mehta', 'Sanjay Rao', 'Ritu Agarwal', 'Manoj Tiwari',
  'Divya Nair', 'Suresh Babu', 'Lakshmi Krishnan', 'Gaurav Saxena', 'Meera Chopra',
  'Aadi', 'Zara Khan', 'Yash', 'Ishita', 'Om',
  'Kriti', 'Harsh', 'Tanya', 'Dhruv', 'Sana',
];

const FAKE_MESSAGES = [
  'Great shot! 👌', 'Let\'s go! 🔥', 'What a catch!', 'Need 10 an over now',
  'Umpire?? 🤨', 'This is our year 💪', 'Bowling change needed', 'Field placement is off',
  'Dhoni finishes off in style! oh wait', 'Classic cover drive!',
  'Yorker length perfect', 'Why play that shot? 😤', 'Run rate climbing',
  'Smooth finish 🧈', 'Pitch is helping spinners', 'Drop catch 🫣',
  'Captain knock incoming 🏏', 'Need partnership here', 'Edge and gone!',
  'Six! 🚀 straight into the stands', 'Four! 🎯 through covers',
  'Good over, only 4 off it', 'LBW! Plumb!', 'Review! UltraEdge shows nothing',
  'Lucky escape that time', 'Runs flowing now', 'Bowler on top here',
  'Fifty up! 👏', '100 partnership', 'CRR climbing nicely',
  'Best batting display this tournament', 'Game over? 🤔', 'Not over till it\'s over',
  'Crowd is loving this', 'What a comeback!', 'Tight bowling',
  'Edge... dropped!!! 🫣', 'Direct hit!', 'Run out!',
  'That\'s a 🦅 (6,6,6,6,6,6)', 'Bowled! Stumps flying!',
  'RCB would find a way to lose this 🤡', 'Kohli vibes',
  'Bazball energy 🏏', 'Need this partnership to fire',
  'Nervous 90s now...', 'Deserved century! 👏👏',
  'Get ready for the final over thriller!',
];

const FAKE_SUPERCHATS = [
  { name: 'Ananya Gupta', text: 'Great stream bhai! 🔥', amt: '5.00' },
  { name: 'Rohit Kumar', text: 'Keep it up prajjwal! 🏏', amt: '10.00' },
  { name: 'Priya Patel', text: 'Love from Delhi ❤️', amt: '3.00' },
  { name: 'Vikram Joshi', text: 'Top tier analysis 🧠', amt: '7.50' },
  { name: 'Kavya Iyer', text: 'Cricket fam represent!', amt: '15.00' },
  { name: 'Arjun Nair', text: 'First time here, loving it!', amt: '2.00' },
  { name: 'Sneha Reddy', text: 'Prajjwal for president 🫡', amt: '12.00' },
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateFakeMessage(includeSuperchat = false) {
  if (!usingFake) throw new Error('generateFakeMessage called outside fake mode');
  const isSuperchat = includeSuperchat && Math.random() < 0.08;
  if (isSuperchat) {
    const sc = pick(FAKE_SUPERCHATS);
    return { name: sc.name, text: sc.text, msgType: 'superchat', amount: sc.amt, profileImageUrl: null };
  }
  const isMembership = Math.random() < 0.03;
  if (isMembership) {
    return { name: pick(FAKE_NAMES), text: 'Joined as a member! 🎉', msgType: 'membership', amount: null, profileImageUrl: null };
  }
  const text = pick(FAKE_MESSAGES);
  // Sometimes attach emoji runs using real YouTube CDN image URLs so the
  // server->overlay emoji path (no hardcoded map) is exercised in fake mode.
  const emojiRuns = [
    { type: 'emoji', text: ':fire:', src: 'https://yt3.ggpht.com/KOxdr_z3A5h1Gb7kqnxqOCnbZrBmxI2B_tRQ453BhTWUhYAlpg5ZP8IKEBkcvRoY8grY91Q=w24-h24-c-k-nd', alt: ':fire:' },
    { type: 'emoji', text: ':face-blue-smiling:', src: 'https://yt3.ggpht.com/cktIaPxFwnrPwn-alHvnvedHLUJwbHi8HCK3AgbHpphrMAW99qw0bDfxuZagSY5ieE9BBrA=w24-h24-c-k-nd', alt: ':face-blue-smiling:' },
    { type: 'emoji', text: ':goat-turquoise-white-horns:', src: 'https://yt3.ggpht.com/jMnX4lu5GnjBRgiPtX5FwFmEyKTlWFrr5voz-Auko35oP0t3-zhPxR3PQMYa-7KhDeDtrv4=w24-h24-c-k-nd', alt: ':goat-turquoise-white-horns:' },
  ];
  const withEmoji = Math.random() < 0.5;
  const runs = withEmoji
    ? [{ type: 'text', text: text + ' ' }, pick(emojiRuns)]
    : null;
  return {
    name: pick(FAKE_NAMES),
    text,
    runs,
    msgType: 'chat',
    amount: null,
    profileImageUrl: null,
  };
}

function broadcastMessage(d) {
  const payload = JSON.stringify({ type: 'youtube-chat', ...d });
  if (wss.clients.size === 0) {
    // No listeners yet — still record in history so replays work, but skip network.
    return;
  }
  // Agent 1: queue overflow protection — coalesce sends on a timer so a burst
  // of messages can never block the event loop or overwhelm a slow client.
  enqueueBroadcast(payload);
  const badge = d.msgType === 'superchat' ? ` [$${d.amount}]` :
                d.msgType === 'membership' ? ' [MEMBER]' : '';
  console.log(`[Fake] ${d.name}${badge}: ${d.text}`);
}

// Agent 1: queue overflow protection. Messages wait in broadcastQueue and are
// flushed on a 50ms cadence. If the queue exceeds QUEUE_MAX we drop the oldest
// backlog (never the newest) so memory stays bounded under load.
function enqueueBroadcast(payload) {
  broadcastQueue.push(payload);
  if (broadcastQueue.length > QUEUE_MAX) {
    const overflow = broadcastQueue.length - QUEUE_MAX;
    broadcastQueue.splice(0, overflow);
    console.warn(`[Queue] dropped ${overflow} stale messages (overflow protection)`);
  }
  if (!queueTimer) {
    queueTimer = setInterval(flushBroadcastQueue, 50);
  }
}

function flushBroadcastQueue() {
  if (broadcastQueue.length === 0) {
    clearInterval(queueTimer);
    queueTimer = null;
    return;
  }
  const batch = broadcastQueue;
  broadcastQueue = [];
  for (const payload of batch) {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(payload); } catch (e) { /* drop on broken socket */ }
      }
    });
  }
}

function seedFakeHistory(count = 15) {
  if (!usingFake) throw new Error('seedFakeHistory called outside fake mode');
  if (messageHistory.length >= 10) return;
  for (let i = 0; i < count; i++) {
    const d = generateFakeMessage(true);
    d.type = 'youtube-chat';
    messageHistory.push(d);
  }
  saveHistory();
  console.log(`Seeded ${count} fake messages into history`);
}

function startFakeChat() {
  if (fakeInterval) return;
  usingFake = true;
  // Load any persisted history from disk (only happens in fake mode)
  if (messageHistory.length === 0 && fs.existsSync(HISTORY_PATH)) {
    try { messageHistory = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')); } catch(e) {}
  }
  seedFakeHistory(15);
  console.log('Starting fake chat (stream offline)');

  const sendBurst = () => {
    const count = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      const d = generateFakeMessage(true);
      d.type = 'youtube-chat';
      messageHistory.push(d);
      if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
      saveHistory();
      broadcastMessage(d);
    }
  };

  sendBurst();
  fakeInterval = setInterval(sendBurst, 5000 + Math.random() * 4000);
}

function stopFakeChat() {
  if (fakeInterval) {
    clearInterval(fakeInterval);
    fakeInterval = null;
  }
  usingFake = false;
}

async function getInitialContinuation() {
  // YouTube blocks /live_chat for non-browser requests. We fetch /watch instead
  // which still serves ytInitialData with live chat continuation tokens.
  const url = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(CHAT_FETCH_TIMEOUT),
  });
  if (!res.ok) throw new Error(`watch page ${res.status}`);
  const html = await res.text();
  const match = html.match(/ytInitialData\s*=\s*({[\s\S]+?});\s*(?:\n|<)/);
  if (!match) throw new Error('Could not find ytInitialData');
  const data = JSON.parse(match[1]);
  const lcr = data?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer;
  if (!lcr) throw new Error('No liveChatRenderer in watch page — stream may be offline');
  const continuations = lcr?.continuations;
  if (!continuations || !continuations.length) throw new Error('No continuations in liveChatRenderer');
  const cont = continuations[0]?.reloadContinuationData?.continuation || continuations[0]?.nextContinuationData?.continuation;
  if (!cont) throw new Error('No continuation token found');
  continuationFetchedAt = Date.now();

  // Extract InnerTube API key and client version from page for subsequent polls
  const keyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  const verMatch = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
  if (keyMatch) innertubeApiKey = keyMatch[1];
  if (verMatch) innertubeClientVersion = verMatch[1];

  // Real chat available — wipe any stale fake history from disk
  messageHistory = [];
  try { fs.writeFileSync(HISTORY_PATH, '[]'); } catch (e) {}

  // Clear startup timeout — we got real data
  if (_startupTimer) { clearTimeout(_startupTimer); _startupTimer = null; }

  console.log(`Got initial continuation token (API key: ${innertubeApiKey.substring(0, 8)}...)`);
  return cont;
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
  } else if (item.liveChatPaidStickerRenderer) {
    // Super Sticker — animated/member sticker. Render its image.
    renderer = item.liveChatPaidStickerRenderer;
    msgType = 'sticker';
    amount = renderer.purchaseAmountText?.simpleText || null;
  } else if (item.liveChatMembershipItemRenderer) {
    renderer = item.liveChatMembershipItemRenderer;
    msgType = 'membership';
  } else return null;

  const id = renderer.id;
  if (!id || seenIds.has(id)) return null;
  seenIds.add(id);

  // Build structured runs so the overlay can render YouTube custom emoji and
  // stickers directly from the image URLs YouTube provides (no hardcoded map
  // dependency). Each run: { type:'text'|'emoji', text, src?, alt? }.
  const messageRuns = renderer.message?.runs;
  const runs = [];
  if (messageRuns) {
    for (const r of messageRuns) {
      if (r.text != null && r.text !== '') {
        runs.push({ type: 'text', text: r.text });
      } else if (r.emoji) {
        const thumbs = r.emoji.image?.thumbnails || [];
        const src = thumbs.length ? thumbs[thumbs.length - 1].url : null;
        const alt = r.emoji.shortcuts?.[0] || r.emoji.emojiId || 'emoji';
        runs.push({ type: 'emoji', text: alt, src, alt });
      }
    }
  }
  // Plain-text fallback (custom emoji shown as :shortcut: if no image URL).
  const text = runs.length
    ? runs.map(r => r.type === 'emoji' ? (r.src ? r.alt : r.text) : r.text).join('')
    : '';

  let authorName = 'Viewer';
  if (renderer.authorName?.simpleText) authorName = renderer.authorName.simpleText;
  else if (renderer.authorName?.runs) authorName = renderer.authorName.runs.map(r => r.text).join('');

  const profileImageUrl = renderer.authorPhoto?.thumbnails?.[0]?.url || null;

  // Super Sticker image (separate from message runs).
  let stickerUrl = null;
  if (msgType === 'sticker') {
    const st = renderer.sticker?.thumbnails || renderer.stickerImage?.thumbnails || [];
    stickerUrl = st.length ? st[st.length - 1].url : null;
  }

  return { type: 'youtube-chat', name: authorName, text, runs, msgType, amount, profileImageUrl, stickerUrl };
}

async function pollChat() {
  if (pollInFlight) return; // Agent 1: never let polls overlap
  pollInFlight = true;

  // Agent 1: continuation expiry detection. If we have a token but it's older
  // than CONTINUATION_EXPIRY_MS (e.g. network was down), discard it so we
  // regenerate a fresh continuation from the live_chat page.
  if (continuationToken && Date.now() - continuationFetchedAt > CONTINUATION_EXPIRY_MS) {
    console.log('[Watchdog] continuation token expired — regenerating fresh');
    continuationToken = null;
    continuationFetchedAt = 0;
  }

  if (!continuationToken) {
    try {
      continuationToken = await getInitialContinuation();
      chatRetryAttempts = 0;
      if (usingFake) {
        stopFakeChat();
        console.log('Stream came online, switched to live chat');
      }
    } catch (err) {
      chatRetryAttempts++;
      if (!usingFake && !everHadRealChat) startFakeChat();
      // Agent 1: retry with exponential backoff
      const backoff = Math.min(POLL_INTERVAL * Math.pow(2, chatRetryAttempts), CHAT_MAX_BACKOFF);
      console.warn(`[Retry] continuation failed (attempt ${chatRetryAttempts}), backoff ${backoff}ms: ${err.message}`);
      pollInFlight = false;
      setTimeout(pollChat, backoff);
      return;
    }
  }

  try {
    // Use InnerTube API (POST) instead of the blocked GET /live_chat/get_live_chat
    const url = `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${innertubeApiKey}`;
    const body = JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: innertubeClientVersion,
          hl: 'en',
        },
      },
      continuation: continuationToken,
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': innertubeClientVersion,
      },
      body,
      signal: AbortSignal.timeout(CHAT_FETCH_TIMEOUT),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`InnerTube get_live_chat ${res.status}: ${txt.substring(0, 80)}`);
    }
    const data = await res.json();
    const continuation = data?.continuationContents?.liveChatContinuation;
    if (!continuation) {
      console.log('[Watchdog] no continuation in response — regenerating fresh');
      continuationToken = null;
      continuationFetchedAt = 0;
      pollInFlight = false;
      setTimeout(pollChat, 15000);
      return;
    }

    // Handle both timedContinuationData (InnerTube) and nextContinuationData (legacy)
    const contData = continuation.continuations?.[0];
    const nextCont = contData?.timedContinuationData?.continuation || contData?.nextContinuationData?.continuation;
    if (nextCont) {
      continuationToken = nextCont;
      continuationFetchedAt = Date.now();
    } else {
      // No next token — ask for a fresh continuation on the next cycle.
      continuationToken = null;
      continuationFetchedAt = 0;
    }

    const actions = continuation.actions || [];
    const newMessages = [];

    for (const action of actions) {
      const d = parseChatAction(action);
      if (!d) continue;
      newMessages.push(d);
      everHadRealChat = true;
      messageHistory.push(d);
      if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
      saveHistory();
      lastChatAt = Date.now(); // Agent 1: record last successful message

      const badge = d.msgType === 'superchat' ? ` [$${d.amount || 'SUPER'}]` :
                    d.msgType === 'membership' ? ' [MEMBER]' : '';
      console.log(`${d.name}${badge}: ${d.text}`);
    }

    if (newMessages.length > 0) {
      // Agent 1: use the queue (overflow-protected) instead of staggered direct sends
      newMessages.forEach(d => enqueueBroadcast(JSON.stringify(d)));
      console.log(`Broadcasting ${newMessages.length} messages`);
    }

    if (seenIds.size > 3000) saveSeen();
    chatRetryAttempts = 0;
    // Clear startup timeout on first successful poll
    if (_startupTimer) { clearTimeout(_startupTimer); _startupTimer = null; }
    const timeoutMs = contData?.timedContinuationData?.timeoutMs || contData?.nextContinuationData?.timeoutMs || POLL_INTERVAL;
    pollInFlight = false;
    setTimeout(pollChat, timeoutMs);
  } catch (err) {
    pollInFlight = false;
    if (err.message.includes('404') || err.message.includes('Not Found')) {
      console.log('[Watchdog] stream ended (404) — regenerating fresh continuation');
      continuationToken = null;
      continuationFetchedAt = 0;
      setTimeout(pollChat, POLL_INTERVAL);
      return;
    }
    chatRetryAttempts++;
    // Agent 1: exponential backoff on transient failures (network drop, timeout)
    const backoff = Math.min(POLL_INTERVAL * Math.pow(2, chatRetryAttempts), CHAT_MAX_BACKOFF);
    console.warn(`[Retry] chat poll failed (attempt ${chatRetryAttempts}), backoff ${backoff}ms: ${err.message}`);
    setTimeout(pollChat, backoff);
  }
}

// Agent 1: chat watchdog. If no real chat message has arrived for CHAT_WATCHDOG_MS
// (e.g. stream died silently or token went stale), force a fresh continuation.
function startChatWatchdog() {
  chatWatchdogTimer = setInterval(() => {
    if (usingFake) return; // fake mode has no real stream
    if (continuationToken && Date.now() - lastChatAt > CHAT_WATCHDOG_MS) {
      console.log('[Watchdog] no chat received for a while — forcing fresh continuation');
      continuationToken = null;
      continuationFetchedAt = 0;
      lastChatAt = Date.now();
      if (!pollInFlight) pollChat();
    }
  }, CHAT_WATCHDOG_MS);
}

let currentViewers = 0;
let viewerRetryAttempts = 0;

function broadcastViewers() {
  const payload = JSON.stringify({ type: 'viewers', count: currentViewers, age: Date.now() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

// Agents 3 & 4: periodic heartbeat carrying server health + last-message ts,
// so the overlay can render green/red status and detect a dead node without
// waiting for the next chat/source update.
function broadcastHeartbeat() {
  const payload = JSON.stringify({
    type: 'heartbeat',
    serverTime: Date.now(),
    lastChatAt,
    state: usingFake ? 'fake' : 'live',
    clients: wss.clients.size,
    viewers: currentViewers,
  });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

async function fetchConcurrentViewers() {
  try {
    const url = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`watch page ${res.status}`);
    const html = await res.text();

    const dataMatch = html.match(/ytInitialData\s*=\s*({[\s\S]+?});\s*(?:\n|<)/);
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
      } catch (e) {}
    }

    const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*({[\s\S]+?});\s*(?:\n|<)/);
    if (playerMatch) {
      try {
        const playerData = JSON.parse(playerMatch[1]);
        const ld = playerData?.liveStreamingDetails;
        if (ld?.concurrentViewers) {
          currentViewers = parseInt(ld.concurrentViewers, 10) || 0;
          broadcastViewers();
          return;
        }
      } catch (e) {}
    }

    const cvMatch = html.match(/"concurrentViewers"\s*:\s*["']?(\d+)["']?/);
    if (cvMatch) {
      currentViewers = parseInt(cvMatch[1], 10) || 0;
      broadcastViewers();
    }
    viewerRetryAttempts = 0;
  } catch (err) {
    viewerRetryAttempts++;
    const backoff = Math.min(VIEWER_POLL_INTERVAL * Math.pow(2, viewerRetryAttempts), 120000);
    console.warn(`[Retry] viewer poll failed (attempt ${viewerRetryAttempts}), next in ${backoff}ms: ${err.message}`);
    // still re-broadcast last known count so the overlay keeps its cache/age
    broadcastViewers();
    setTimeout(fetchConcurrentViewers, backoff);
    return;
  }
}

function startViewerPolling() {
  fetchConcurrentViewers();
  setInterval(fetchConcurrentViewers, VIEWER_POLL_INTERVAL);
}

(async () => {
  console.log(`Chat server for video: ${VIDEO_ID}`);
  pollChat();
  startViewerPolling();
  startChatWatchdog();

  // Agent 3: overlay heartbeat every 2s so the health panel can flip red fast
  setInterval(broadcastHeartbeat, HEARTBEAT_INTERVAL);

  wss.on('connection', ws => {
    console.log('Client connected');
    ws.send(JSON.stringify({ type: 'connected', message: 'YouTube Chat Bridge ready', fake: usingFake }));
    ws.send(JSON.stringify({ type: 'viewers', count: currentViewers, age: Date.now() }));
    ws.send(JSON.stringify({ type: 'heartbeat', serverTime: Date.now(), lastChatAt, state: usingFake ? 'fake' : 'live', clients: wss.clients.size, viewers: currentViewers }));
    const recent = messageHistory.slice(-10);
    if (recent.length > 0) {
      recent.forEach((msg, i) => {
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
        }, i * 150);
      });
      console.log(`Replayed ${recent.length} historical messages to new client`);
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
