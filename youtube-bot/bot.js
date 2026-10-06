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

      if (sessionUsers.has(userId) && msg.text !== '!testgreet') return; // Already greeted this stream

      if (msg.text === '!testgreet') {
         console.log(`[BOT] !testgreet command received from ${name}. Forcing greeting...`);
      } else {
        // New for this stream!
        sessionUsers.add(userId);
        saveSessionUsers();
      }

      // If this is a historical replay from the server, we just register them in the session silently to avoid spamming alerts.
      if (msg.isHistory && msg.text !== '!testgreet') return;

      // Lifetime check for global alert
      const isCompletelyNew = !globalUsers.some(u => u.id === userId);
      if (isCompletelyNew && msg.text !== '!testgreet') {
        globalUsers.push({ id: userId, name: name, firstSeen: Date.now() });
        saveGlobalUsers();
        triggerObsAlert(name);
      }

      console.log(`[BOT] Triggering greeting flow for ${name}...`);
      // Generate text greeting
      generateGreeting(name, userId, isCompletelyNew);
    } catch (err) {
      console.error('[BOT] Websocket parse error:', err);
    }
  });

  ws.on('close', () => { setTimeout(connect, 5000); });
  ws.on('error', () => { /* ignore */ });
}

// --- Greeting Logic ---
async function fetchLLMGreeting(llmPrompt) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout for local LLMs

    const apiUrl = process.env.LLM_API_URL || 'http://127.0.0.1:8080/v1/chat/completions';
    const apiModel = process.env.LLM_MODEL || 'qwen3-0.6b';

    console.log(`[BOT] Fetching LLM greeting from ${apiUrl} for ${apiModel}...`);
    const systemPrompt = [
      'You are the live-chat host of a Hindi cricket stream. You greet one viewer at a time with a single short line.',
      'HOW TO WRITE:',
      '- Think first, briefly, about a fresh opener. Do not print your thinking.',
      '- Then output ONLY the final greeting line. No quotes, no label, no explanation.',
      '- Roman Hinglish only: Latin letters with Hindi words typed in English. Never Devanagari.',
      '- One sentence, 4 to 10 words. Never write the viewer\'s name or handle, it is added for you.',
      '- Never start with \'Aaj\', \'Aao\' or \'Swagat\'.',
      '- The instruction under Mood tells you the direction. Follow it.',
      '- Take the ENERGY of the examples, never their exact words. A copy is rejected.',
      '- Finish with 1 to 3 emojis.',
      'EXAMPLES:',
      ...GREETING_EXAMPLES.map(e => '- ' + e)
    ].join('\n');

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: apiModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: llmPrompt }
        ],
        temperature: 0.95,
        top_p: 0.95,
        min_p: 0.05,
        repetition_penalty: 1.15,
        max_tokens: 400,
        chat_template_kwargs: { enable_thinking: true }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) return null;
    const data = await response.json();
    if (data && data.choices && data.choices[0] && data.choices[0].message) {
        let reply = data.choices[0].message.content.trim();
        // Remove <think>...</think> block if present, even if malformed/unclosed at the end
        reply = reply.replace(/<think>[\s\S]*?(<\/think>|$)\n*/gi, '').trim();
        reply = reply.replace(/^["']|["']$/g, '');
        // Chat must be a single short line
        reply = reply.replace(/\s+/g, ' ').trim();
        if (reply.length > 180) reply = reply.slice(0, 180).trim() + '…';
        return reply;
    }
    return null;
  } catch (error) {
    console.warn("[LLM WARN] Falling back to static greetings:", error.message);
    return null;
  }
}

// Rotating style directives. A 0.6B model cannot reliably self-vary, so we hand it a
// different creative direction for each greeting instead of always asking for the same thing.
const STYLE_DIRECTIVES = [
  'Open with a one-time crack joke about how late they are.',
  'Open by hyping them up as if they are a star batsman.',
  'Open with a question about which team they support.',
  'Open by teasing them for not subscribing yet.',
  'Open by referencing the tension of a live match.',
  'Open by welcoming them in the style of a stadium announcement.',
  'Open with a playful Hinglish compliment.',
  'Open by asking them to predict the next ball.',
  'Open by comparing them to a famous cricketer.',
  'Open with a dramatic filmi-style declaration.'
];

let styleIndex = 0;
function nextStyleDirective() {
  const d = STYLE_DIRECTIVES[styleIndex % STYLE_DIRECTIVES.length];
  styleIndex++;
  return d;
}

// Few-shot bank. Single source of truth: rendered into the system prompt AND used by
// isBadGreeting() to reject replies the model copied word-for-word from an example.
const GREETING_EXAMPLES = [
  'Baarish ho rahi, par batting garam! 🏏',
  'Chai khatam ho gayi, comments bhi? ☕',
  'Autograph milega, pehle form bharo! 📝',
  'Comment army, namaste! 🙏',
  'Bowling attack aa gaya, dhyaan se! 🎯',
  'Six maaroge toh chai meri! 💥',
  'Stands bhar gaye, dil bhar gaya! 🏟️',
  'Pitch report sun liya kya? 📊',
  'Ropes ke paar se sochna, deep field hai! 😄',
  'Signal slow hai, ball tez hai! 📡',
  'Century ka intezaar ho raha hai! 🏏',
  'Over ki ginti shuru, ghabrao mat! ⏱️',
  'Boundary pe khade ho, darne ka waqt nahi! 😎',
  'Spiner daal raha hai, dhyaan! 🌀',
  'Nayi innings, bilkul naya josh! 🔥',
  'Dew on grass, action on screen! 🌱'
];

// Emoji/punctuation-free signature used for verbatim-copy detection.
const EXAMPLE_SIGNATURES = GREETING_EXAMPLES.map(e =>
  e.toLowerCase().replace(/[^a-zऀ-ॿ ]/g, '').replace(/\s+/g, ' ').trim()
);

// A 0.6B model often parrots the instruction or repeats its last opening.
// We reject those replies and retry once with a different creative direction.
const INSTRUCTION_LEAKS = [
  'new to this chat', 'never been here', 'do not reuse', 'wording from this instruction',
  'write only the greeting', 'mood for this message', 'the instruction tells you',
  'they are new', 'they have watched', 'subscribe now', 'make them want'
];
const recentOpeners = [];
const recentFallbacks = [];

function openerOf(text) {
  return String(text).toLowerCase().replace(/[^a-zऀ-ॿ ]/g, '').trim().split(/\s+/).slice(0, 2).join(' ');
}

// Sanitise a YouTube handle for display: strip @, remove junk, clamp length.
function sanitizeHandle(name) {
  return String(name || '').replace(/^@+/, '').replace(/[^\wऀ-ॿ .-]/g, '').trim().slice(0, 24) || 'friend';
}

// Strips any handle/name the model invented, leaving only the greeting words.
// Validation runs on THIS body (before the real handle is added), otherwise the
// "@handle" prefix would defeat the banned-opener and copied-example checks.
function cleanBody(text, name) {
  const handle = sanitizeHandle(name);
  let body = String(text || '').trim();
  body = body.replace(/^@[\wऀ-ॿ.-]+\s*/u, '');
  const esc = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  body = body.replace(new RegExp(`@?${esc}\\b`, 'i'), '');
  return body.replace(/^[\s,!.:;-]+/, '').trim();
}

// Guarantees every outgoing greeting starts with the recipient's @handle exactly once.
function buildGreeting(name, body) {
  const handle = sanitizeHandle(name);
  let text = String(body || '').trim().replace(/^@[\wऀ-ॿ.-]+\s*/u, '');
  const esc = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  text = text.replace(new RegExp(`@?${esc}\\b`, 'i'), '');
  text = text.replace(/[\s,!.:;-]+/g, ' ').trim();
  if (!text) text = 'welcome to the stream!';
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return `@${handle} ${text}`;
}

function isBadGreeting(text) {
  if (!text || text.length < 6) return 'empty';
  const low = text.toLowerCase();
  if (/[ऀ-ॿ؀-ۿ一-鿿぀-ヿ]/.test(text)) return 'non-latin-script';
  if (INSTRUCTION_LEAKS.some(l => low.includes(l))) return 'instruction-leak';
  if (/as an ai|\bi\b|i'?ll|think:|instruction/.test(low)) return 'ai-leak';
  if (/^(aaj|swagat|aao)\b/.test(low)) return 'banned-opener';
  if (text.split(/\s+/).filter(Boolean).length < 4) return 'too-short';
  const sig = low.replace(/[^a-zऀ-ॿ ]/g, '').replace(/\s+/g, ' ').trim();
  if (EXAMPLE_SIGNATURES.includes(sig)) return 'copied-example';
  const op = openerOf(text);
  if (recentOpeners.includes(op)) return 'repeated-opener';
  if (text.split(/\s+/).length > 16) return 'too-long';
  return null;
}

async function generateGreeting(name, userId, isCompletelyNew) {
  console.log(`[BOT] generateGreeting called for ${name}`);
  const timeElapsed = Date.now() - botStartTime;
  const isLate = timeElapsed > LATE_THRESHOLD_MS;

  // 1. Specific mapping
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

  // 2. Try LLM first, with up to 3 attempts if the reply is unusable
  const shortName = sanitizeHandle(name);

  const buildContext = () => {
    if (specificConfig) {
      return isLate ? 'They just arrived late.' : 'They are a VIP.';
    } else if (isCompletelyNew) {
      return 'First time here.';
    } else {
      return 'Back again.';
    }
  };

  let finalReply = null;
  let usedDirective = null;

  for (let attempt = 0; attempt < 3 && !finalReply; attempt++) {
    const directive = nextStyleDirective();
    usedDirective = directive;
    const llmPrompt = `${directive} ${buildContext()} Write only the greeting words.`;

    const llmGreeting = await fetchLLMGreeting(llmPrompt);

    if (llmGreeting && llmGreeting.length > 5) {
      const body = cleanBody(llmGreeting, shortName) || llmGreeting;
      // Validate the bare body so the @handle prefix cannot mask a banned opener,
      // a copied example or a repeat.
      const bad = isBadGreeting(body);
      if (!bad) {
        const candidate = buildGreeting(shortName, body);
        recentOpeners.push(openerOf(body));
        if (recentOpeners.length > 25) recentOpeners.shift();
        finalReply = candidate;
        console.log(`[BOT] LLM returned greeting: ${finalReply}`);
      } else {
        console.warn(`[LLM WARN] Rejected greeting (${bad}): ${body}`);
      }
    }
  }

  if (finalReply) {
    sendYouTubeMessage(finalReply);
    return;
  }
  
  console.log(`[BOT] LLM produced no usable greeting after 3 attempts. Falling back to static logic for ${name}`);

  // 3. Fallback to existing static logic (handle is still guaranteed)
  if (specificConfig) {
    let reply = "";
    if (isLate && specificConfig.late) {
      reply = specificConfig.late;
    } else if (specificConfig.early) {
      reply = specificConfig.early;
    } else if (specificConfig.anytime) {
      reply = specificConfig.anytime;
    }
    if (reply) sendYouTubeMessage(buildGreeting(shortName, reply.replace(/\{name\}/g, '')));
    return;
  }

  let templates = [];
  if (isCompletelyNew && greetingsConfig.generic_new_user) {
    templates = greetingsConfig.generic_new_user;
  } else if (!isCompletelyNew && greetingsConfig.generic_returning_user) {
    templates = greetingsConfig.generic_returning_user;
  }

  if (templates.length > 0) {
    // Never hand two consecutive viewers the same fallback line.
    const fresh = templates.filter(t => !recentFallbacks.includes(openerOf(t)));
    const pool = fresh.length > 0 ? fresh : templates;
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    recentFallbacks.push(openerOf(chosen));
    if (recentFallbacks.length > templates.length) recentFallbacks.shift();
    sendYouTubeMessage(buildGreeting(shortName, chosen.replace(/\{name\}/g, '')));
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
