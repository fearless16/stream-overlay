require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const GLOBAL_USERS_FILE = path.join(__dirname, 'global-users.json');
const SESSION_USERS_FILE = path.join(__dirname, 'session-users.json');
const GREETINGS_FILE = path.join(__dirname, 'greetings.json');

// --- State and Config ---
const botStartTime = Date.now();
const LATE_THRESHOLD_MS = 30 * 60 * 1000; // 30 mins
let globalUsers = [];
let sessionUsers = new Set();
let greetingsConfig = {};

// Clear session users on startup (per-stream tracking)
fs.writeFileSync(SESSION_USERS_FILE, '[]');

try { globalUsers = JSON.parse(fs.readFileSync(GLOBAL_USERS_FILE, 'utf8')); } catch (e) {}
try { greetingsConfig = JSON.parse(fs.readFileSync(GREETINGS_FILE, 'utf8')); } catch (e) {}

function saveGlobalUsers() { fs.writeFileSync(GLOBAL_USERS_FILE, JSON.stringify(globalUsers, null, 2)); }
function saveSessionUsers() { fs.writeFileSync(SESSION_USERS_FILE, JSON.stringify([...sessionUsers], null, 2)); }

const crypto = require('crypto');
function generateAuthHeader(cookiesStr, origin) {
  const match = cookiesStr.match(/SAPISID=([^;]+)/);
  if (!match) return null;
  const time = Math.floor(Date.now() / 1000);
  const sha1 = crypto.createHash('sha1').update(`${time} ${match[1]} ${origin}`).digest('hex');
  return `SAPISIDHASH ${time}_${sha1}`;
}

// --- InnerTube Sender (Option 2) ---
const VIDEO_ID = process.env.VIDEO_ID;
let authCookies = process.env.YOUTUBE_COOKIES || '';
if (authCookies.trim().startsWith('[')) {
  try {
    const arr = JSON.parse(authCookies);
    authCookies = arr.map(c => `${c.name}=${c.value}`).join('; ');
  } catch (e) {
    console.error('[BOT] Failed to parse YOUTUBE_COOKIES JSON payload');
  }
} else if (!authCookies && process.env.COOKIES_FILE && fs.existsSync(process.env.COOKIES_FILE)) {
  try {
    const raw = fs.readFileSync(process.env.COOKIES_FILE, 'utf8');
    authCookies = raw.split('\n')
      .filter(l => l && !l.startsWith('#') && !l.startsWith('Http') && l.includes('\t'))
      .map(l => l.split('\t'))
      .filter(parts => parts.length >= 7)
      .map(parts => `${parts[5]}=${parts[6]}`)
      .join('; ');
    if (!authCookies) authCookies = raw.trim();
  } catch (e) {}
}

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Origin': 'https://www.youtube.com',
  'Referer': `https://www.youtube.com/live_chat?v=${VIDEO_ID}`,
  ...(authCookies ? { 'Cookie': authCookies } : {})
};

let innertubeApiKey = null;
let innertubeContext = null;
let sendMessageParams = null; // The critical token needed to POST a message

async function initInnerTubeSender() {
  if (!authCookies) {
    console.warn('[BOT] No YOUTUBE_COOKIES found. Bot cannot send messages to YouTube! Only OBS Alerts will work.');
    return;
  }
  try {
    const url = `https://www.youtube.com/live_chat?v=${VIDEO_ID}`;
    const res = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error('Live chat fetch failed');
    const html = await res.text();

    const keyMatch = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
    const ctxMatch = html.match(/"INNERTUBE_CONTEXT"\s*:\s*({[\s\S]+?}),\s*"INNERTUBE_/);
    if (keyMatch && ctxMatch) {
      innertubeApiKey = keyMatch[1];
      innertubeContext = JSON.parse(ctxMatch[1]);
    }

    const initialDataMatch = html.match(/(?:var\s+)?(?:window\[")?ytInitialData(?:"\])?\s*=\s*({[\s\S]+?});\s*(?:\n|<)/);
    if (initialDataMatch) {
      const data = JSON.parse(initialDataMatch[1]);
      // Dive into the data struct to find the send_message params
      try {
        const renderers = [
          data?.contents?.liveChatRenderer,
          data?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer,
        ];
        const renderer = renderers.find(r => r?.actionPanel);
        const actionPanel = renderer?.actionPanel;
        const inputRenderer = actionPanel?.liveChatMessageInputRenderer || 
                              actionPanel?.liveChatParticipantInputRenderer || 
                              actionPanel?.liveChatActionPanelRenderer?.panelToShow?.liveChatParticipantInputRenderer ||
                              actionPanel?.liveChatActionPanelRenderer?.panelToShow?.item?.liveChatParticipantInputRenderer ||
                              actionPanel?.liveChatActionPanelRenderer?.panelToShow?.liveChatMessageInputRenderer;
        
        sendMessageParams = inputRenderer?.sendButton?.buttonRenderer?.serviceEndpoint?.sendLiveChatMessageEndpoint?.params;
      } catch (e) {
        console.warn('[BOT] Could not find sendMessageParams in initial data.');
      }
    }

    if (innertubeApiKey && sendMessageParams) {
      console.log('[BOT] InnerTube Sender initialized successfully. Bot is LIVE and can chat!');
    } else {
      console.warn('[BOT] Failed to initialize InnerTube Sender. Bot cannot chat. (Check cookies or stream status)');
    }
  } catch (err) {
    console.error('[BOT] InnerTube Initialization Error:', err.message);
  }
}

async function sendYouTubeMessage(text) {
  console.log(`[BOT REPLIES] -> ${text}`);
  if (!innertubeApiKey || !innertubeContext || !sendMessageParams) {
    console.warn('[BOT] Cannot send: InnerTube config missing. (Waiting for cookies/stream)');
    return;
  }

  try {
    const url = `https://www.youtube.com/youtubei/v1/live_chat/send_message?key=${innertubeApiKey}`;
    const payload = {
      context: innertubeContext,
      richMessage: {
        textSegments: [{ text: text }]
      },
      params: sendMessageParams,
      clientMessageId: Date.now().toString() + Math.floor(Math.random() * 1000).toString()
    };

    const reqHeaders = { ...FETCH_HEADERS, 'Content-Type': 'application/json' };
    const authHeader = generateAuthHeader(authCookies, 'https://www.youtube.com');
    if (authHeader) reqHeaders['Authorization'] = authHeader;

    const res = await fetch(url, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.error) {
      console.error('[BOT] YouTube send error:', data.error);
    } else {
      console.log('[BOT] Message successfully sent to YouTube!');
    }
  } catch (err) {
    console.error('[BOT] Network error sending message:', err.message);
  }
}

// --- WebSocket Client ---
const WS_PORT = process.env.WS_PORT || 8765;
let ws;

function connect() {
  console.log(`[BOT] Connecting to Chat Server on ws://localhost:${WS_PORT}...`);
  ws = new WebSocket(`ws://localhost:${WS_PORT}`);

  ws.on('open', () => {
    console.log('[BOT] Connected to WS. Listening for chats...');
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type !== 'youtube-chat' && msg.type !== 'chat') return;

      const name = msg.name;
      const userId = msg.authorChannelId || name; // Fallback to name if ID is somehow missing
      if (!name) return;

      if (sessionUsers.has(userId)) return; // Already greeted this stream

      // New for this stream!
      sessionUsers.add(userId);
      saveSessionUsers();

      // If this is a historical replay from the server, we just register them in the session silently to avoid spamming alerts.
      if (msg.isHistory) return;

      // Lifetime check for global alert
      const isCompletelyNew = !globalUsers.some(u => u.id === userId);
      if (isCompletelyNew) {
        globalUsers.push({ id: userId, name: name, firstSeen: Date.now() });
        saveGlobalUsers();
        triggerObsAlert(name);
      }

      // Generate text greeting
      generateGreeting(name, userId, isCompletelyNew);
    } catch (err) {}
  });

  ws.on('close', () => { setTimeout(connect, 5000); });
  ws.on('error', () => { /* ignore */ });
}

// --- Greeting Logic ---
function generateGreeting(name, userId, isCompletelyNew) {
  const timeElapsed = Date.now() - botStartTime;
  const isLate = timeElapsed > LATE_THRESHOLD_MS;

  // 1. Specific mapping (Check explicit channelId first, then fallback to partial name match)
  let specificConfig = null;
  if (Array.isArray(greetingsConfig.specific_users)) {
    for (const userConfig of greetingsConfig.specific_users) {
      if (userConfig.channelId && userConfig.channelId === userId) {
        specificConfig = userConfig;
        break;
      }
      if (!specificConfig && userConfig.matchNames && userConfig.matchNames.some(alias => name.toLowerCase().includes(alias.toLowerCase()))) {
        specificConfig = userConfig;
        break;
      }
    }
  }

  if (specificConfig) {
    let reply = "";
    if (isLate && specificConfig.late) {
      reply = specificConfig.late;
    } else if (specificConfig.early) {
      reply = specificConfig.early;
    } else if (specificConfig.anytime) {
      reply = specificConfig.anytime;
    }
    if (reply) sendYouTubeMessage(reply.replace(/\{name\}/g, name));
    return;
  }

  // 2. Generic mappings
  let templates = [];
  if (isCompletelyNew && greetingsConfig.generic_new_user) {
    templates = greetingsConfig.generic_new_user;
  } else if (!isCompletelyNew && greetingsConfig.generic_returning_user) {
    templates = greetingsConfig.generic_returning_user;
  }

  if (templates.length > 0) {
    const randomTemplate = templates[Math.floor(Math.random() * templates.length)];
    sendYouTubeMessage(randomTemplate.replace(/\{name\}/g, name));
  }
}

// --- OBS Alert ---
function triggerObsAlert(name) {
  console.log(`[BOT ALERT] Broadcasting new user alert for ${name}`);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'new_user_alert', name: name }));
  }
}

// Boot up
initInnerTubeSender().then(connect);
