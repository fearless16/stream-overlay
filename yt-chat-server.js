require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const VIDEO_ID = process.env.VIDEO_ID || 'Gtm65By2uwg';
const WS_PORT = parseInt(process.env.WS_PORT || '8765', 10);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '3000', 10);

const SEEN_PATH = path.join(__dirname, '.chat_seen.json');
const HISTORY_PATH = path.join(__dirname, '.chat_history.json');

const wss = new WebSocket.Server({ port: WS_PORT });
console.log(`WebSocket server on ws://localhost:${WS_PORT}`);

let seenIds = new Set();
let continuationToken = null;
let messageHistory = [];
let usingFake = false;
let fakeInterval = null;
const MAX_HISTORY = 50;

if (fs.existsSync(HISTORY_PATH)) {
  try { messageHistory = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')); } catch(e) {}
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
  const isSuperchat = includeSuperchat && Math.random() < 0.08;
  if (isSuperchat) {
    const sc = pick(FAKE_SUPERCHATS);
    return { name: sc.name, text: sc.text, msgType: 'superchat', amount: sc.amt, profileImageUrl: null };
  }
  const isMembership = Math.random() < 0.03;
  if (isMembership) {
    return { name: pick(FAKE_NAMES), text: 'Joined as a member! 🎉', msgType: 'membership', amount: null, profileImageUrl: null };
  }
  return {
    name: pick(FAKE_NAMES),
    text: pick(FAKE_MESSAGES),
    msgType: 'chat',
    amount: null,
    profileImageUrl: null,
  };
}

function broadcastMessage(d) {
  const payload = JSON.stringify({ type: 'youtube-chat', ...d });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
  const badge = d.msgType === 'superchat' ? ` [$${d.amount}]` :
                d.msgType === 'membership' ? ' [MEMBER]' : '';
  console.log(`[Fake] ${d.name}${badge}: ${d.text}`);
}

function seedFakeHistory(count = 15) {
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
  const url = `https://www.youtube.com/live_chat?v=${VIDEO_ID}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  if (!res.ok) throw new Error(`live_chat page ${res.status}`);
  const html = await res.text();
  const match = html.match(/ytInitialData\s*=\s*({[\s\S]+?});\s*(?:\n|<)/);
  if (!match) throw new Error('Could not find ytInitialData');
  const data = JSON.parse(match[1]);
  const continuations = data?.contents?.liveChatRenderer?.continuations;
  if (!continuations || !continuations.length) throw new Error('No continuations in liveChatRenderer');
  const cont = continuations[0]?.nextContinuationData?.continuation;
  if (!cont) throw new Error('No continuation token found');
  console.log('Got initial continuation token');
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
  } else if (item.liveChatMembershipItemRenderer) {
    renderer = item.liveChatMembershipItemRenderer;
    msgType = 'membership';
  } else return null;

  const id = renderer.id;
  if (!id || seenIds.has(id)) return null;
  seenIds.add(id);

  const messageRuns = renderer.message?.runs;
  const text = messageRuns ? messageRuns.map(r => r.text || r.emoji?.shortcuts?.[0] || '').join('') : '';

  let authorName = 'Viewer';
  if (renderer.authorName?.simpleText) authorName = renderer.authorName.simpleText;
  else if (renderer.authorName?.runs) authorName = renderer.authorName.runs.map(r => r.text).join('');

  const profileImageUrl = renderer.authorPhoto?.thumbnails?.[0]?.url || null;

  return { type: 'youtube-chat', name: authorName, text, msgType, amount, profileImageUrl };
}

async function pollChat() {
  if (!continuationToken) {
    try {
      continuationToken = await getInitialContinuation();
      if (usingFake) {
        stopFakeChat();
        console.log('Stream came online, switched to live chat');
      }
    } catch (err) {
      if (!usingFake) startFakeChat();
      setTimeout(pollChat, 30000);
      return;
    }
  }

  try {
    const url = `https://www.youtube.com/live_chat/get_live_chat?continuation=${encodeURIComponent(continuationToken)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'x-youtube-client-version': '2.20240101.00.00',
        'x-youtube-client-name': '1',
      },
    });
    if (!res.ok) throw new Error(`get_live_chat ${res.status}`);
    const data = await res.json();
    const continuation = data?.continuationContents?.liveChatContinuation;
    if (!continuation) {
      continuationToken = null;
      setTimeout(pollChat, 15000);
      return;
    }

    const nextCont = continuation.continuations?.[0]?.nextContinuationData?.continuation;
    if (nextCont) continuationToken = nextCont;

    const actions = continuation.actions || [];
    const newMessages = [];

    for (const action of actions) {
      const d = parseChatAction(action);
      if (!d) continue;
      newMessages.push(d);
      messageHistory.push(d);
      if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
      saveHistory();

      const badge = d.msgType === 'superchat' ? ` [$${d.amount || 'SUPER'}]` :
                    d.msgType === 'membership' ? ' [MEMBER]' : '';
      console.log(`${d.name}${badge}: ${d.text}`);
    }

    if (newMessages.length > 0) {
      newMessages.forEach((d, i) => {
        setTimeout(() => {
          const payload = JSON.stringify(d);
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(payload);
          });
        }, i * 300);
      });
      console.log(`Broadcasting ${newMessages.length} messages`);
    }

    if (seenIds.size > 3000) saveSeen();
    const timeoutMs = continuation.continuations?.[0]?.nextContinuationData?.timeoutMs || POLL_INTERVAL;
    setTimeout(pollChat, timeoutMs);
  } catch (err) {
    if (err.message.includes('404') || err.message.includes('Not Found')) {
      continuationToken = null;
    }
    setTimeout(pollChat, POLL_INTERVAL);
  }
}

(async () => {
  console.log(`Chat server for video: ${VIDEO_ID}`);
  pollChat();

  wss.on('connection', ws => {
    console.log('Client connected');
    ws.send(JSON.stringify({ type: 'connected', message: 'YouTube Chat Bridge ready', fake: usingFake }));
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
