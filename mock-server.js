/**
 * mock-server.js
 * Simulates a fake live stream WebSocket feed on ws://localhost:8770
 * DISABLED by policy — only runs with ALLOW_FAKE_CHAT=1. Must NOT feed OBS.
 * Run: ALLOW_FAKE_CHAT=1 node mock-server.js
 *
 * Milestone walkthrough mode (fake-server demo of the milestone animations):
 * Run: ALLOW_FAKE_CHAT=1 FAKE_MILESTONES=1 node mock-server.js
 * Broadcasts a baseline score, then one score crossing each milestone
 * (50 / 100 / 150 / 200 / 250 / 3W / 4W / 5W) roughly every ~4.8s so the
 * overlay celebrates them one after another.
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

const MILESTONE_MODE = process.env.FAKE_MILESTONES === '1';

// A score payload that keeps a batter (Virat Kohli) at `runs` and a bowler
// (Jasprit Bumrah) at `wickets`. No 4s/6s/Ws in the current over so the classic
// boundary/wicket celebrations stay quiet and only milestones animate.
function milestoneScore(runs, wickets, seq) {
  return {
    teams: [
      { name: 'India', abbr: 'IND', score: runs + '/1', overs: '24.3' },
      { name: 'Australia', abbr: 'AUS', score: '110/5', overs: '28.0' }
    ],
    batsmen: [
      { name: 'Virat Kohli', runs: String(runs), balls: String(Math.round(runs * 1.15 + 14)), striker: true },
      { name: 'Rohit Sharma', runs: '23', balls: '28' }
    ],
    bowler: { name: 'Jasprit Bumrah', overs: '9.0', wickets: String(wickets), runs: '42' },
    currentOver: ['1', '1', '2', '1'],
    lastBallSeq: seq,
    format: 'ODI',
    crr: '6.4',
    status: 'India need 210 runs from 150 balls'
  };
}

// Milestone walkthrough: baseline, then one milestone every ~4.8s. Refresh the
// overlay page to replay the sequence.
const MILESTONE_STEPS = [
  { s: 0,     score: milestoneScore(48, 1, 400) },   // baseline (never animates — no prev)
  { s: 4800,  score: milestoneScore(54, 1, 401) },   // crosses 50 → FIFTY
  { s: 9600,  score: milestoneScore(106, 1, 402) },  // crosses 100 → CENTURY
  { s: 14400, score: milestoneScore(152, 1, 403) },  // crosses 150 → 150 UP
  { s: 19200, score: milestoneScore(206, 1, 404) },  // crosses 200 → DOUBLE
  { s: 24000, score: milestoneScore(254, 1, 405) },  // crosses 250 → 250 UP
  { s: 28800, score: milestoneScore(254, 3, 406) },  // bowler 3rd → 3W HAUL
  { s: 33600, score: milestoneScore(254, 4, 407) },  // bowler 4th → 4W HAUL
  { s: 38400, score: milestoneScore(254, 5, 408) },  // bowler 5th → 5W HAUL
  { s: 43200, score: milestoneScore(254, 5, 409) }   // hold
];

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

  if (MILESTONE_MODE) {
    // Initial score immediately on connect
    ws.send(JSON.stringify({ type: 'score', data: MILESTONE_STEPS[0].score }));
    // Run the walkthrough fresh for THIS client so a late refresh still
    // replays every milestone from the start.
    MILESTONE_STEPS.slice(1).forEach(st => {
      setTimeout(() => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'score', data: st.score }));
      }, st.s);
    });
    ws.on('close', () => console.log(`[-] Client disconnected (${wss.clients.size} remaining)`));
    return;
  }

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

// Chat stream scheduler: every 3–6 seconds
function scheduleChat() {
  const delay = 3000 + Math.random() * 3000;
  setTimeout(() => {
    if (wss.clients.size > 0) sendNextChat();
    scheduleChat();
  }, delay);
}

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

// Keep the default timeline noise off in milestone walkthrough mode
if (!MILESTONE_MODE) {
  setTimeout(scheduleRetraction, 10000);
  setTimeout(scheduleChat, 1000);
  setTimeout(scheduleLike, 8000);
}

console.log('Timeline:');
console.log('  0s   — initial score + goals sent on connect');
console.log('  1s+  — chat messages every 3-6s');
console.log('  10s+ — retraction events every 8-16s (random, ~50% chance)');
console.log('  20s  — score update #2');
console.log('  45s  — goals update');
console.log('  60s  — score update #3');
console.log('  120s — final score (India win)\n');

// ── Milestone walkthrough timeline (FAKE_MILESTONES=1) ──────────────────────
// Runs per-connection inside the connection handler so every refresh replays
// the full sequence from the start.
if (MILESTONE_MODE) {
  console.log('Milestone walkthrough mode:');
  console.log('  0s    — baseline score (no animation)');
  console.log('  4.8s  — FIFTY (50)');
  console.log('  9.6s  — CENTURY (100)');
  console.log('  14.4s — 150 UP');
  console.log('  19.2s — DOUBLE (200)');
  console.log('  24s   — 250 UP');
  console.log('  28.8s — 3-WICKET HAUL');
  console.log('  33.6s — 4-WICKET HAUL');
  console.log('  38.4s — 5-WICKET HAUL');
  console.log('  Refresh the overlay page to replay.\n');
}
