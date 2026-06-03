/**
 * mock-server.js
 * Simulates a live stream WebSocket feed on ws://localhost:8765
 * Run: node mock-server.js
 */

const { WebSocketServer } = require('ws');

const PORT = 8765;
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
    currentOver: ['·', '1', '4', '·', 'W', '·'],
    crr: '6.24',
    rrr: '8.50',
    partnership: '44 (38)',
    lastWicket: 'KL Rahul c Carey b Starc 12',
    status: 'India batting — need 58 runs to win'
  },
  {
    teams: [
      { name: 'India', score: '167/4', overs: '28.1' },
      { name: 'Australia', score: '0/0', overs: '0.0' }
    ],
    batsmen: [
      { name: 'Virat Kohli',  runs: '55', balls: '62', striker: true },
      { name: 'KL Rahul',     runs: '12', balls: '18' }
    ],
    bowler: { name: 'Josh Hazlewood', overs: '6.0', wickets: '1', runs: '28' },
    currentOver: ['2', '·', '4', '1', '·', '6'],
    crr: '5.93',
    rrr: '7.80',
    partnership: '25 (22)',
    lastWicket: 'Rohit Sharma c Smith b Cummins 67',
    status: 'India need 13 runs off 22 balls'
  },
  {
    teams: [
      { name: 'India', score: '180/4', overs: '31.0' },
      { name: 'Australia', score: '0/0', overs: '0.0' }
    ],
    batsmen: [
      { name: 'Virat Kohli',  runs: '72', balls: '79', striker: true },
      { name: 'KL Rahul',     runs: '18', balls: '24' }
    ],
    bowler: { name: 'Mitchell Starc', overs: '9.0', wickets: '1', runs: '42' },
    currentOver: ['6'],
    crr: '5.81',
    rrr: '-',
    partnership: '38 (30)',
    lastWicket: 'Rohit Sharma c Smith b Cummins 67',
    status: '🏆 India win by 6 wickets!'
  }
];

// ── Simulation timeline ──────────────────────────────────────────────────────
let chatIdx = 0;
let scoreIdx = 1; /* index 0 sent on connect */

function sendNextChat() {
  const msg = chatMessages[chatIdx % chatMessages.length];
  chatIdx++;
  broadcast({ type: 'youtube-chat', ...msg, profileImageUrl: profileUrl(msg.name) });
}

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
function scheduleChat() {
  const delay = 3000 + Math.random() * 3000;
  setTimeout(() => {
    if (wss.clients.size > 0) sendNextChat();
    scheduleChat();
  }, delay);
}

// Score updates: at 20s, 60s, 120s
setTimeout(() => sendNextScore(), 20000);
setTimeout(() => sendNextScore(), 60000);
setTimeout(() => sendNextScore(), 120000);

// Goals update at 45s
setTimeout(() => sendGoals({
  todayGoal: '$28 / $50', todayGoalFill: 56,
  winStreak: 5,
  subGoal: '63 / 100', subGoalFill: 63
}), 45000);

// Start chat stream after 1s
setTimeout(scheduleChat, 1000);

console.log('Timeline:');
console.log('  0s   — initial score + goals sent on connect');
console.log('  1s+  — chat messages every 3-6s');
console.log('  20s  — score update #2');
console.log('  45s  — goals update');
console.log('  60s  — score update #3');
console.log('  120s — final score (India win)\n');
