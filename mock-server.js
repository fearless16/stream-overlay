/**
 * mock-server.js
 * Simulates a fake live stream WebSocket feed on ws://localhost:8770
 * DISABLED by policy — only runs with ALLOW_FAKE_CHAT=1. Must NOT feed OBS.
 * Run: ALLOW_FAKE_CHAT=1 node mock-server.js
 */

const { WebSocketServer } = require('ws');

// ⛔ Fake chat is DISABLED by policy. This server only emits simulated (fake)
// chat and must never feed the live OBS overlay. For local UI testing only,
// opt in explicitly with ALLOW_FAKE_CHAT=1.
if (process.env.ALLOW_FAKE_CHAT !== '1') {
  console.error('\n⛔  Fake chat is disabled.');
  console.error('     This mock server emits simulated chat and must NOT feed the live OBS overlay.');
  console.error('     To run it for local UI testing anyway, set ALLOW_FAKE_CHAT=1\n');
  process.exit(1);
}

// Distinct port so it can NEVER collide with or replace the real yt-chat-server
// (which owns 8765 / 8766). Point a test overlay at ws://localhost:8770 instead.
const PORT = 8770;
const wss = new WebSocketServer({ port: PORT });

console.log(`\n🎙  Mock stream server running on ws://localhost:${PORT}`);
console.log('   Open chat-overlay.html in OBS browser source or Chrome\n');

// ── Broadcast to all connected clients ──────────────────────────────────────
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
  console.log('[→]', msg.substring(0, 120));
}

// ── Mock data pools ──────────────────────────────────────────────────────────
const avatars = {
  'Rahul S.': 'https://api.dicebear.com/7.x/avataaars/svg?seed=Rahul&backgroundColor=ff6b6b',
  'Ankit Verma': 'https://api.dicebear.com/7.x/avataaars/svg?seed=Ankit&backgroundColor=4d96ff',
  'CricketFan07': 'https://api.dicebear.com/7.x/avataaars/svg?seed=Cricket&backgroundColor=6bcb77',
  'Priya K.': 'https://api.dicebear.com/7.x/avataaars/svg?seed=Priya&backgroundColor=ffd93d',
  'Vikram': 'https://api.dicebear.com/7.x/avataaars/svg?seed=Vikram&backgroundColor=ff6bff',
  'BigFan2024': 'https://api.dicebear.com/7.x/avataaars/svg?seed=BigFan&backgroundColor=ff9f43',
  'Prajjwal': 'https://api.dicebear.com/7.x/avataaars/svg?seed=Prajjwal&backgroundColor=ff2d55',
  'Meera S.': 'https://api.dicebear.com/7.x/avataaars/svg?seed=Meera&backgroundColor=CE93D8',
};

function profileUrl(name) {
  return avatars[name] || null;
}

const chatMessages = [
  { name: 'Rahul S.',       text: 'What a six! Great timing! 🏏',           msgType: 'chat' },
  { name: 'Ankit Verma',    text: 'Loving the commentary bhai!',             msgType: 'chat' },
  { name: 'CricketFan07',   text: 'Keep it up brother! 🔥',                 msgType: 'chat' },
  { name: 'Priya K.',       text: 'First time watching, already hooked!',    msgType: 'chat' },
  { name: 'Vikram',         text: 'That was a no-ball for sure 😤',          msgType: 'chat' },
  { name: 'Deepak M.',      text: 'Best cricket analysis on YouTube!',       msgType: 'chat' },
  { name: 'SachinFan99',    text: 'Rohit is in sublime form today',          msgType: 'chat' },
  { name: 'Neha T.',        text: 'Can you explain the DRS rule again?',     msgType: 'chat' },
  { name: 'Arjun P.',       text: 'LBW should have been given!',             msgType: 'chat' },
  { name: 'Karan B.',       text: 'India winning this for sure 🇮🇳',        msgType: 'chat' },
  { name: 'Mod_Suresh',     text: 'Keeping chat clean folks, be respectful', msgType: 'moderator' },
  { name: 'Sunita R.',      text: 'Just subscribed! Amazing stream!',        msgType: 'membership' },
  { name: 'BigFan2024',     text: 'This pitch is a minefield!',              msgType: 'superchat', amount: '5' },
  { name: 'Rajesh D.',      text: 'Bumrah is unplayable today 🎯',           msgType: 'chat' },
  { name: 'Prajjwal',       text: '🔴 Welcome everyone! Drop a like!',       msgType: 'announcement' },
  { name: 'Amit Shah',      text: 'Great work on the overlay bhai!',         msgType: 'superchat', amount: '10' },
  { name: 'Pooja V.',       text: 'Finally a cricket channel worth watching',msgType: 'chat' },
  { name: 'TechCricket',    text: 'The spin is really gripping here',        msgType: 'chat' },
  { name: 'Gaurav N.',      text: 'Shami should bowl the next over',         msgType: 'chat' },
  { name: 'Meera S.',       text: 'Love the energy! Keep streaming! ❤️',    msgType: 'membership' },
  { name: 'StickerFan',     text: '[Sticker] 🎮 GG!',                        msgType: 'superchat', amount: '3' },
];

const scoreSequence = [
  // Score 1 — initial, shows a CAUGHT wicket in lastWicket, currentOver starts with 1 ball
  {
    teams: [
      { name: 'India', score: '142/3', overs: '22.4' },
      { name: 'Australia', score: '0/0', overs: '0.0' }
    ],
    batsmen: [
      { name: 'Rohit Sharma', runs: '67', balls: '54', striker: true },
      { name: 'Virat Kohli',  runs: '38', balls: '41' }
    ],
    bowler: { name: 'Pat Cummins', overs: '8.2', wickets: '2', runs: '34' },
    currentOver: ['·'],
    crr: '6.24',
    rrr: '8.50',
    partnership: '44 (38)',
    lastWicket: 'KL Rahul c Carey b Starc 12',
    status: 'India batting — need 58 runs to win'
  },
  // Score 2 — extends to 2 balls, last ball = 4 → FOUR animation
  {
    teams: [
      { name: 'India', score: '152/3', overs: '24.0' },
      { name: 'Australia', score: '0/0', overs: '0.0' }
    ],
    batsmen: [
      { name: 'Rohit Sharma', runs: '77', balls: '60', striker: true },
      { name: 'Virat Kohli',  runs: '38', balls: '41' }
    ],
    bowler: { name: 'Pat Cummins', overs: '9.0', wickets: '2', runs: '40' },
    currentOver: ['·', '4'],
    crr: '6.33',
    rrr: '7.50',
    partnership: '55 (44)',
    lastWicket: 'KL Rahul c Carey b Starc 12',
    status: 'India need 52 runs in 36 balls'
  },
  // Score 3 — extends to 3 balls, last ball = 6 → SIX animation
  {
    teams: [
      { name: 'India', score: '167/3', overs: '28.1' },
      { name: 'Australia', score: '0/0', overs: '0.0' }
    ],
    batsmen: [
      { name: 'Rohit Sharma', runs: '92', balls: '72', striker: true },
      { name: 'Virat Kohli',  runs: '38', balls: '41' }
    ],
    bowler: { name: 'Josh Hazlewood', overs: '6.1', wickets: '1', runs: '32' },
    currentOver: ['·', '4', '6'],
    crr: '5.93',
    rrr: '6.80',
    partnership: '68 (52)',
    lastWicket: 'KL Rahul c Carey b Starc 12',
    status: 'India need 37 runs in 22 balls'
  },
  // Score 4 — extends to 4 balls, last ball = W → BOWLED (lastWicket = "b ")
  {
    teams: [
      { name: 'India', score: '175/4', overs: '29.3' },
      { name: 'Australia', score: '0/0', overs: '0.0' }
    ],
    batsmen: [
      { name: 'Rohit Sharma', runs: '98', balls: '78', striker: true },
      { name: 'Hardik Pandya', runs: '4', balls: '3' }
    ],
    bowler: { name: 'Mitchell Starc', overs: '8.3', wickets: '2', runs: '44' },
    currentOver: ['·', '4', '6', 'W'],
    crr: '5.93',
    rrr: '8.00',
    partnership: '10 (7)',
    lastWicket: 'Virat Kohli b Starc 38',
    status: 'India need 29 runs in 15 balls'
  },
  // Score 5 — extends to 5 balls, last ball = W → CAUGHT (lastWicket = "c ... b ")
  {
    teams: [
      { name: 'India', score: '180/5', overs: '30.2' },
      { name: 'Australia', score: '0/0', overs: '0.0' }
    ],
    batsmen: [
      { name: 'Rohit Sharma', runs: '100', balls: '82', striker: true },
      { name: 'MS Dhoni', runs: '0', balls: '0' }
    ],
    bowler: { name: 'Josh Hazlewood', overs: '7.2', wickets: '2', runs: '38' },
    currentOver: ['·', '4', '6', 'W', 'W'],
    crr: '6.05',
    rrr: '12.00',
    partnership: '0 (0)',
    lastWicket: 'Hardik Pandya c Maxwell b Zampa 4',
    status: 'India need 24 runs in 10 balls'
  },
  // Score 6 — extends to 6 balls, last ball = W → LBW (batsmen change too)
  {
    teams: [
      { name: 'India', score: '185/6', overs: '31.0' },
      { name: 'Australia', score: '0/0', overs: '0.0' }
    ],
    batsmen: [
      { name: 'Rohit Sharma', runs: '102', balls: '85', striker: true },
      { name: 'Ravindra Jadeja', runs: '1', balls: '2' }
    ],
    bowler: { name: 'Pat Cummins', overs: '10.0', wickets: '3', runs: '52' },
    currentOver: ['·', '4', '6', 'W', 'W', 'W'],
    crr: '6.13',
    rrr: '18.00',
    partnership: '3 (4)',
    lastWicket: 'MS Dhoni lbw b Cummins 0',
    status: 'India need 19 runs in 6 balls'
  },
  // Score 7 — extends to 7 balls (new over), last ball = W → RUN OUT
  {
    teams: [
      { name: 'India', score: '186/7', overs: '31.3' },
      { name: 'Australia', score: '0/0', overs: '0.0' }
    ],
    batsmen: [
      { name: 'Rohit Sharma', runs: '103', balls: '86', striker: true },
      { name: 'Bhuvneshwar Kumar', runs: '0', balls: '1' }
    ],
    bowler: { name: 'Mitchell Starc', overs: '9.3', wickets: '2', runs: '48' },
    currentOver: ['·', '4', '6', 'W', 'W', 'W', 'W'],
    crr: '6.13',
    rrr: '24.00',
    partnership: '1 (2)',
    lastWicket: 'Ravindra Jadeja run out (Maxwell) 1',
    status: 'India need 18 runs in 3 balls'
  },
  // Score 8 — final over, 6,6,6 → SIX × 3, India win
  {
    teams: [
      { name: 'India', score: '204/7', overs: '32.0' },
      { name: 'Australia', score: '0/0', overs: '0.0' }
    ],
    batsmen: [
      { name: 'Rohit Sharma', runs: '121', balls: '92', striker: true },
      { name: 'Bhuvneshwar Kumar', runs: '0', balls: '1' }
    ],
    bowler: { name: 'Pat Cummins', overs: '11.0', wickets: '3', runs: '66' },
    currentOver: ['·', '4', '6', 'W', 'W', 'W', 'W', '6', '6', '6'],
    crr: '6.38',
    rrr: '-',
    partnership: '18 (6)',
    lastWicket: 'Ravindra Jadeja run out (Maxwell) 1',
    status: '🏆 India win by 3 wickets with 0 balls remaining!'
  }
];

// ── Simulation timeline ──────────────────────────────────────────────────────
let chatIdx = 0;
let scoreIdx = 1; /* index 0 sent on connect */

function sendNextScore() {
  if (scoreIdx >= scoreSequence.length) return;
  broadcast({ type: 'score', data: scoreSequence[scoreIdx] });
  scoreIdx++;
}

function sendGoals(d) {
  broadcast({ type: 'goals', data: d });
}

// ── Schedule ─────────────────────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  console.log(`[+] Client connected (${wss.clients.size} total)`);

  // Send initial score immediately on connect
  ws.send(JSON.stringify({ type: 'score', data: scoreSequence[0] }));

  // Send initial goals
  ws.send(JSON.stringify({ type: 'goals', data: {
    todayGoal: '$12 / $50', todayGoalFill: 24,
    winStreak: 5,
    subGoal: '47 / 100', subGoalFill: 47
  }}));

  ws.on('close', () => console.log(`[-] Client disconnected (${wss.clients.size} remaining)`));
});

// Chat: every 3–6 seconds
let mockMsgIdCounter = 1;
const mockMessageCache = new Map();

function sendNextChat() {
  const msg = chatMessages[chatIdx % chatMessages.length];
  chatIdx++;
  const msgId = 'mock_' + (mockMsgIdCounter++);
  mockMessageCache.set(msgId, { ...msg, id: msgId });
  broadcast({ type: 'youtube-chat', ...msg, id: msgId, profileImageUrl: profileUrl(msg.name) });
}

// Retract messages: randomly retract some messages 5-10s after they appear
function scheduleRetraction() {
  const delay = 8000 + Math.random() * 8000;
  setTimeout(() => {
    if (mockMessageCache.size > 0 && Math.random() > 0.5) {
      const keys = [...mockMessageCache.keys()];
      const targetId = keys[Math.floor(Math.random() * keys.length)];
      const cached = mockMessageCache.get(targetId);
      if (cached) {
        broadcast({
          type: 'retracted',
          targetId,
          deletedStateMessage: 'This message was removed',
          message: cached,
        });
        mockMessageCache.delete(targetId);
      }
    }
    scheduleRetraction();
  }, delay);
}

setTimeout(scheduleRetraction, 10000);

// Chat stream scheduler: every 3–6 seconds
function scheduleChat() {
  const delay = 3000 + Math.random() * 3000;
  setTimeout(() => {
    if (wss.clients.size > 0) sendNextChat();
    scheduleChat();
  }, delay);
}

setTimeout(scheduleChat, 1000);

// Like events: every 15–45 seconds
let likeCount = 142;
function scheduleLike() {
  const delay = 15000 + Math.random() * 30000;
  setTimeout(() => {
    likeCount++;
    const names = ['Rahul S.', 'Ankit Verma', 'CricketFan07', 'Priya K.', 'Vikram', 'Deepak M.', 'Neha T.', 'Arjun P.', 'Karan B.', 'Sunita R.'];
    const name = names[Math.floor(Math.random() * names.length)];
    broadcast({ type: 'like', count: likeCount, name });
    scheduleLike();
  }, delay);
}
setTimeout(scheduleLike, 8000);

// Score updates: at 20s, 35s, 50s, 65s, 80s, 95s, 110s, 125s
setTimeout(() => sendNextScore(), 20000);
setTimeout(() => sendNextScore(), 35000);
setTimeout(() => sendNextScore(), 50000);
setTimeout(() => sendNextScore(), 65000);
setTimeout(() => sendNextScore(), 80000);
setTimeout(() => sendNextScore(), 95000);
setTimeout(() => sendNextScore(), 110000);
setTimeout(() => sendNextScore(), 125000);

// Goals update at 45s
setTimeout(() => sendGoals({
  todayGoal: '$28 / $50', todayGoalFill: 56,
  winStreak: 5,
  subGoal: '63 / 100', subGoalFill: 63
}), 45000);

console.log('Timeline:');
console.log('  0s   — initial score + goals sent on connect (CAUGHT in lastWicket)');
console.log('  1s+  — chat messages every 3-6s');
console.log('  10s+ — retraction events every 8-16s (random, ~50% chance)');
console.log('  20s  — score #2: FOUR animation');
console.log('  35s  — score #3: SIX animation');
console.log('  50s  — score #4: BOWLED animation');
console.log('  65s  — score #5: CAUGHT animation');
console.log('  80s  — score #6: LBW animation');
console.log('  95s  — score #7: RUN OUT animation');
console.log('  110s — score #8: final score + 6\n');
