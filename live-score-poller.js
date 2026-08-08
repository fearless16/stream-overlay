require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const WebSocket = require('ws');
const cheerio = require('cheerio');

const WS_URL = process.env.WS_URL || 'ws://localhost:8765';
const POLL_INTERVAL = parseInt(process.env.SCORE_POLL_INTERVAL || process.env.POLL_INTERVAL || '6000', 10);
const MAX_BACKOFF = 60000;
const FETCH_TIMEOUT = 15000;

// ── Cricbuzz team image lookup ─────────────────────────────────────────────
let _cbTeamImages = null;
try {
  _cbTeamImages = require('./cricbuzz-team-images.json');
} catch (_) { /* file may not exist */ }

function _cbFlag(abbr, fullName) {
  if (!_cbTeamImages) return null;
  const name = (fullName || abbr || '').toLowerCase().trim();
  if (_cbTeamImages.byName[name]) return _cbTeamImages.byName[name];
  // try hyphenated form (if spaces present)
  const slug = name.replace(/\s+/g, '-');
  if (_cbTeamImages.byName[slug]) return _cbTeamImages.byName[slug];
  // try stripping common suffixes
  const noSuff = name.replace(/\s+(women|men|u19|u23|a|xi|legends)$/i, '').trim();
  if (noSuff !== name && _cbTeamImages.byName[noSuff]) return _cbTeamImages.byName[noSuff];
  // Abbreviations are fallback-only: DD is ambiguous across competitions,
  // while the full provider team name identifies Dindigul Dragons correctly.
  const key = (abbr || '').toLowerCase().trim();
  if (_cbTeamImages.byAbbr[key]) return _cbTeamImages.byAbbr[key];
  return null;
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let ws = null;
let lastData = '';
let consecutiveFailures = 0;
let sourceLabel = '';
let consecutiveHolds = 0;

// Per-URL state. The poller fans out across all configured URLs and
// maintains cricket-aware state for each match separately. lastMatchKey
// detects match switches.
const matchState = {
  lastMatchKey: null,
  // Last coherent Crex player set (batsmen + bowler) per delivery. Crex's
  // getSV3 blob fuses separately-cached upstream payloads, so the top-level
  // player fields can lag the fresh ball feed. Reused only on the same
  // delivery; a delivery advance without player data holds the snapshot.
  crexPlayers: null,
};

function _resetCrexPlayers() {
  matchState.crexPlayers = null;
}

function buildUrlChain(inputUrl) {
  if (!inputUrl || !inputUrl.trim()) return [];
  const urls = [];
  const seen = new Set();
  const add = (u) => { if (u && !seen.has(u)) { seen.add(u); urls.push(u); } };

  add(inputUrl.trim());

  if (inputUrl.includes('crex.com')) {
    const base = inputUrl.replace(/\/match-scorecard\/?$/, '');
    add(base + '/match-scorecard');
    add(base);
  }

  if (inputUrl.includes('cricbuzz.com')) {
    const m = inputUrl.match(/cricbuzz\.com\/(live-cricket-score(?:card|s))\/(\d+)\/(.+)/);
    if (m) {
      const id = m[2];
      const slug = m[3];
      add(`https://www.cricbuzz.com/live-cricket-scores/${id}/${slug}`);
      add(`https://www.cricbuzz.com/live-cricket-scorecard/${id}/${slug}`);
    }
  }

  return urls;
}

function parseScoreUrls() {
  const explicit = process.env.SCORE_URLS;
  if (explicit) {
    const urls = explicit.split(',').map(u => u.trim()).filter(Boolean);
    if (urls.length > 0) return urls;
  }
  const primary = process.env.SCORE_URL || 'https://crex.com/cricket-live-score/aus-vs-pak-2nd-odi-australia-tour-of-pakistan-2026-match-updates-11YY';
  const chain = buildUrlChain(primary);
  if (chain.length === 0) {
    console.error('[Init] No valid URLs configured. Set SCORE_URL or SCORE_URLS env var.');
    process.exit(1);
  }
  return chain;
}

const URLS = parseScoreUrls();

function connectWS() {
  ws = new WebSocket(WS_URL);
  ws.on('open', () => console.log('[WS] Connected to overlay server'));
  ws.on('close', () => {
    console.log('[WS] Disconnected, reconnecting in 5s...');
    setTimeout(connectWS, 5000);
  });
  ws.on('error', (err) => console.error('[WS] Error:', err && (err.message || err.code || err)));
}

async function fetchPage(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    redirect: 'follow',
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.text();
}

// ─────────────────────────────────────────────────────────────────────────────
// Cricket-aware helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect format from URL/title/description.
 * Order: T20 > ODI > Test (Test usually explicit in the URL).
 */
function detectFormat(url, title) {
  const s = ((url || '') + ' ' + (title || '')).toLowerCase();
  if (/\bt20i?\b|twenty20|t-?20\b/.test(s)) return 'T20';
  if (/\bodi\b|one[- ]?day|50[- ]?over/.test(s)) return 'ODI';
  if (/\btest\b/.test(s)) return 'Test';
  // The Hundred: 100 balls per innings, 5 balls per over (matchFormat "HUN").
  if (/\bthe[- ]?hundred\b|\bhundreds?\b|\.hun\b|\bhun\b/.test(s)) return 'HUN';
  return null;
}

// Every per-format rule lives here. Nothing in the poller (or the overlay)
// may special-case a format inline — ask the config. This is what makes a
// Test match, an ODI, a T20 and The Hundred all behave differently without
// sprinkling `if (fmt === ...)` across the code.
const FORMATS = {
  T20:  { ballsPerOver: 6, maxBalls: 120, maxRpo: 30, rateMetric: 'crr', rateMax: 12, innings: 2, showOvers: true, chaseBalls: true, sessions: false },
  ODI:  { ballsPerOver: 6, maxBalls: 300, maxRpo: 22, rateMetric: 'crr', rateMax: 10, innings: 2, showOvers: true, chaseBalls: true, sessions: false },
  Test: { ballsPerOver: 6, maxBalls: Infinity, maxRpo: 14, rateMetric: 'crr', rateMax: 6, innings: 4, showOvers: true, chaseBalls: false, sessions: true },
  HUN:  { ballsPerOver: 5, maxBalls: 100, maxRpo: 40, rateMetric: 'rpb', rateMax: 3, innings: 2, showOvers: false, chaseBalls: true, sessions: false },
};

function getFormatConfig(fmt) {
  return FORMATS[fmt] || null;
}

/**
 * Normalize "140-10" → "140/10".
 * Test matches use "X-Y" where Y can be 10 (all out) — preserve the "/10" form
 * so the scorecard widget knows it's an innings close.
 */
function normalizeScore(score) {
  if (!score) return score;
  const s = String(score).trim();
  if (!s || /^(?:-|--|yet\s+to\s+bat|dnb)$/i.test(s)) return '';
  return s.replace(/-/g, '/');
}

function formatScore(runs, wkts, opts = {}) {
  const r = runs == null ? '' : String(runs).trim();
  if (!r || /^(?:-|--|yet\s+to\s+bat|dnb)$/i.test(r)) return '';
  const w = wkts == null ? '' : String(wkts).trim();
  if (w) return normalizeScore(`${r}/${w}`);
  if (opts.completed) return `${r}/10`;
  if (opts.assumeNoWicket) return `${r}/0`;
  return r;
}

function isBlankScore(score) {
  if (score == null) return true;
  const s = String(score).trim();
  return !s || /^(?:-|--|yet\s+to\s+bat|dnb)$/i.test(s);
}

/**
 * "75b" / "10b" / "15b" → 75. The Hundred sources report exact balls
 * bowled (per innings / per bowler) with a "b" suffix — no overs at all.
 */
function parseBallsField(v) {
  if (v == null) return null;
  const m = String(v).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * "19.2" overs means 19 completed overs + 2 balls = N balls bowled.
 * The Hundred has 5-ball overs; all other formats use 6-ball overs.
 */
function oversToBalls(oversStr, fmt) {
  if (oversStr == null) return 0;
  const s = String(oversStr).trim();
  const m = s.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return 0;
  const whole = parseInt(m[1], 10);
  const partial = parseInt((m[2] || '0').slice(0, 1), 10); // "19.2" = 2 balls, never 20
  if (isNaN(whole) || isNaN(partial)) return 0;
  const perOver = (getFormatConfig(fmt) || FORMATS.ODI).ballsPerOver;
  return whole * perOver + partial;
}

function maxBallsForFormat(fmt) {
  const cfg = getFormatConfig(fmt);
  return cfg ? cfg.maxBalls : Infinity;
}

/**
 * Parse a score like "61/6" or "140-10" into {runs, wkts, allOut}.
 */
function parseScoreString(s) {
  if (!s) return null;
  // Wicket count is optional — providers routinely drop "0" for an opening
  // partnership ("107" instead of "107/0"). Default it to 0 downstream.
  const m = String(s).match(/^(\d{1,4})(?:\s*[\/\-]\s*(\d{1,2}))?$/);
  if (!m) return null;
  const runs = parseInt(m[1], 10);
  const wkts = m[2] != null ? parseInt(m[2], 10) : 0;
  return { runs, wkts, allOut: wkts >= 10 };
}

/**
 * Parse "19.2" overs into {overs, balls}. Cricket-correct: ball 6 of an over
 * is still shown as "5.6", never "6.0".
 */
function parseOversString(s) {
  if (s == null) return { overs: 0, balls: 0 };
  const m = String(s).match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return { overs: 0, balls: 0 };
  const overs = parseInt(m[1], 10);
  const balls = parseInt((m[2] || '0').slice(0, 1), 10);
  return { overs, balls };
}

/**
 * Parse a "(Name 6(10), Name 31(34))"-style batsman list. Tolerates unicode
 * and keeps "(c)" / "†" markers.
 */
function parseBatsmenList(raw) {
  if (!raw) return [];
  const batsmen = [];
  // Match: Name 123(45), … (allow &, ., accent chars, spaces)
  const re = /([A-ZÀ-Ý][A-Za-zÀ-Ýà-ÿ'.\-]+(?:\s+[A-ZÀ-Ýa-zÀ-ÿ][A-Za-zÀ-Ýà-ÿ'.\-]+)*)\s+(\d{1,3})\s*\(\s*(\d{1,3})\s*\)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    batsmen.push({ name: m[1].trim(), runs: m[2], balls: m[3] });
    if (batsmen.length >= 4) break;
  }
  return batsmen;
}

/**
 * Parse a bowler figures string "1-22" or "5/62" → {wkts, runs}.
 * If we already have a bowler object with overs, leave that alone.
 */
function parseFigures(fig) {
  if (!fig) return null;
  const m = String(fig).match(/^(\d{1,2})\s*[\-\/]\s*(\d{1,3})$/);
  if (!m) return null;
  return { wkts: m[1], runs: m[2] };
}

/**
 * Look at the last few overs and decide whether the score is *plausible*.
 * A "bogus" score is one where:
 *   - wickets > 10 in a single innings
 *   - run-rate > 25 (T20) / 18 (ODI) / 12 (Test) which never happens
 *   - overs is impossible (e.g. negative, 19.7 balls)
 *   - the previous-frame delta makes no sense (e.g. jumped 200 runs in 1 ball)
 */
function isPlausibleScore(score, overs, fmt) {
  const s = parseScoreString(score);
  if (!s) return false;
  // Never reject a real score: an early collapse CAN read 0/1 (wicket off the
  // first ball) and 0/0 (first over not yet bowled). Only impossible values
  // are dropped — a score like 0/X where X>10, or a negative run count.
  if (s.wkts > 10) return false;
  if (s.runs < 0 || s.runs > 1000) return false;

  const cfg = getFormatConfig(fmt);
  const perOver = (cfg || FORMATS.ODI).ballsPerOver;
  const o = parseOversString(overs);
  if (o.overs < 0 || o.balls < 0 || o.balls > perOver) return false;

  if (o.overs > 0 || o.balls > 0) {
    const balls = o.overs * perOver + o.balls;
    if (balls > 0 && cfg) {
      const rpo = (s.runs / balls) * perOver;
      if (rpo > cfg.maxRpo) return false;
    }
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// CREX — uses the rich getSV3 JSON payload embedded in the page
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decode a Crex "&q;…&a;…"-escaped JSON chunk.
 * The payload looks like JSON where all string values are wrapped in
 * &q;…&q; and the ampersands inside strings are &a;. We don't need a full
 * JSON.parse — we just need exact-key regex extraction. That's faster and
 * survives a missing closing brace.
 */
function extractCrexApiData(html, url) {
  if (!html.includes('api.goscorer.com/api/v3/getSV3')) return null;

  const sv3Idx = html.indexOf('getSV3');
  if (sv3Idx < 0) return null;
  // The payload is one giant JSON object; read generously.
  const raw = html.substring(sv3Idx, sv3Idx + 50000);

  const get = (key) => {
    // Try &q;key&q;:&q;value&q;
    let re = new RegExp(`&q;${key}&q;:&q;((?:(?!&q;).)*)&q;`, 'i');
    let m = raw.match(re);
    if (m) return m[1].replace(/&a;/g, '&').replace(/&l;/g, '<').replace(/&g;/g, '>');
    // Try &q;key&q;:value (numeric/bool/null)
    re = new RegExp(`&q;${key}&q;:([^,&}]+)`, 'i');
    m = raw.match(re);
    if (m) return m[1].replace(/&a;/g, '&');
    return null;
  };

  const metadataTitles = [...html.matchAll(/"(?:headline|name|description)"\s*:\s*"([^"]+)"/gi)].map(m => m[1]);
  const formatMetadata = metadataTitles.find(t => /\bt20i?\b|twenty20|t-?20|\bodi\b|one[- ]?day|50[- ]?over|\btest\b|the[- ]?hundred/i.test(t));
  const sourceTitle = formatMetadata || metadataTitles[0] || '';
  const out = {
    // Crex's JSON-LD headline is often the only reliable format marker. The
    // visible <title> may omit T20/ODI, while a later metadata field says it.
    sourceTitle,
    score1: get('score1'),
    over1: get('over1'),
    score2: get('score2'),
    over2: get('over2'),
    team1: get('team1'),
    team2: get('team2'),
    team1Full: get('team1_f_n'),
    team2Full: get('team2_f_n'),
    team1short: get('team1short'),
    team2short: get('team2short'),
    team1Img: get('team1_img') || get('team1_logo') || get('t1_img'),
    team2Img: get('team2_img') || get('team2_logo') || get('t2_img'),
    pname1: get('pname1'),
    pname2: get('pname2'),
    playerFull1: get('player_full_name1'),
    playerFull2: get('player_full_name2'),
    run1: get('run1'),
    ball1: get('ball1'),
    run2: get('run2'),
    ball2: get('ball2'),
    bname: get('bname'),
    bowlerFull: get('bowler_full_name'),
    bwr: get('bwr'),
    bover: get('bover'),
    beco: get('beco'),
    // The Hundred: Crex reports exact balls bowled ("75b") and the Five
    // labels ("15th Five"). There are no overs — just 100 balls.
    hballs1: get('hballs1'),
    hballs2: get('hballs2'),
    bBalls: get('bBalls'),
    over: get('over'),
    hOver: get('hOver'),
    crr: get('crr'),
    rrr: get('rrr'),
    comment1: get('comment1'),
    // Status primitives
    A: get('A'),
    B: get('B'),
    F: get('F'),
    L: get('L'),
    M: get('M'),
    S: get('S'),         // session table summary string
    // Partnership + last wicket
    partnerruns: get('partnerruns'),
    partnerballs: get('partnerballs'),
    lwname1: get('lwname1'),
    lwrun1: get('lwrun1'),
    lwball1: get('lwball1'),
    // Striker flags (os1/os2 = "on strike" 0/1; strikker1 may be present)
    strikker1: get('strikker1'),
    strikker2: get('strikker2'),
    os1: get('os1'),
    os2: get('os2'),
    // Match state
    inning: get('inning'),
    status: get('status'),
    day: get('dy'),
    session: get('session'),
    session2: get('session2'),
    target: get('target'),
    showDaySession: get('showDaySession'),
    // Toss / who batted first isn't in this payload — derive from innings
    lastoversRaw: null, // populated below
  };

  // Pull the lastovers block (per-over summary). It's an array of
  // {over, overinfo, total} objects serialized as JSON. The nested
  // overinfo arrays make a naive `],&q;` lazy match stop too early —
  // match up to the closing `}],&q;` of the whole array instead.
  const lastOversMatch = raw.match(/&q;lastovers&q;:\[([\s\S]*?)\}],&q;/);
  if (lastOversMatch) {
    out.lastoversRaw = lastOversMatch[1];
  }

  // The authoritative ball-by-ball feed — fresh on every delivery, unlike
  // lastovers which lags 3-6 balls behind. Drives currentOver, the last-ball
  // sequence number, and dismissal-mode detection.
  out.ballFeeds = parseCrexBallFeeds(html);
  if (out.ballFeeds.length) {
    const latest = out.ballFeeds[out.ballFeeds.length - 1];
    if (latest.del != null) out.lastBallSeq = latest.del;
  }

  // Best-effort dismissal mode: the recent ball commentary ("TAKES THE
  // CATCH!", "LBW!", "CLEAN BOWLED!") carries the HOW-OUT text the lastWicket
  // fields omit. Only read inside the commentary block — a bare &q;c&q;:&q;…
  // regex elsewhere matches unrelated short keys ("4.2.0.0", "2/13").
  out.commentaryTexts = [];
  const cmtStart = raw.indexOf('&q;commentary&q;:');
  if (cmtStart >= 0) {
    const cmtBlock = raw.substring(cmtStart, cmtStart + 60000);
    const c2re = /&q;c2&q;:&q;((?:(?!&q;).)*)&q;/g;
    let cm2;
    while ((cm2 = c2re.exec(cmtBlock)) !== null) {
      if (cm2[1].trim()) {
        out.commentaryTexts.push(cm2[1].replace(/&a;/g, '&').replace(/&l;/g, '<').replace(/&g;/g, '>').replace(/&s;/g, "'"));
      }
    }
  }

  // If we couldn't pull the core identifiers, this isn't a valid payload.
  if (!out.team1 || !out.team2) return null;

  return out;
}

/**
 * Extract Crex's authoritative ball-by-ball feed (getBallFeeds).
 *
 * The getSV3 payload embeds a `getBallFeeds` array (newest-first) of per-ball
 * entries: {o:"14.5", s:"71/5", b:"4", c2:"…", delivery:73, type:"b"}.
 * This feed is FRESH — it updates on every delivery — unlike the `lastovers`
 * block, which lags 3-6 balls behind and makes the overlay show stale balls
 * and fire (or miss) wicket/boundary animations late. We parse it raw (the
 * JSON is `&q;`/`&a;`-escaped and the opening brace can be missing) so a
 * single mismatched key never breaks the whole payload.
 *
 * Returns entries oldest → newest (raw payload is newest-first).
 */
function parseCrexBallFeeds(html) {
  const sv3Idx = (html || '').indexOf('getSV3');
  if (sv3Idx < 0) return [];
  const raw = html.substring(sv3Idx, sv3Idx + 60000);
  const keyIdx = raw.indexOf('getBallFeeds');
  if (keyIdx < 0) return [];
  let arrStart = raw.indexOf('&q;:[', keyIdx);
  if (arrStart < 0) arrStart = raw.indexOf('":[', keyIdx);
  if (arrStart < 0) return [];
  arrStart += 4;

  // Scan raw for the matching closing ] — &q; marks the start of a string
  // (treat it like a quote; the payload never uses a plain ").
  let depth = 0, inStr = false, end = -1;
  for (let i = arrStart; i < raw.length; i++) {
    if (inStr) {
      if (raw.startsWith('&q;', i)) { inStr = false; i += 2; }
      continue;
    }
    if (raw.startsWith('&q;', i)) { inStr = true; i += 2; continue; }
    const ch = raw[i];
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { depth--; if (depth <= 0) { end = i; break; } }
  }
  if (end < 0) return [];

  const dec = raw.substring(arrStart, end)
    .replace(/&q;/g, '"').replace(/&a;/g, '&').replace(/&s;/g, "'")
    .replace(/&l;/g, '<').replace(/&g;/g, '>');

  const feeds = [];
  for (const chunk of dec.split(/\},\{/)) {
    const ty = chunk.match(/"type":"([^"]*)"/);
    if (!ty || ty[1] !== 'b') continue;
    const o = chunk.match(/"o":"([\d.]+)"/);
    const s = chunk.match(/"s":"([^"]+)"/);
    const b = chunk.match(/"b":"([^"]*)"|"b":(\d+)/);
    const del = chunk.match(/"delivery":(\d+)/);
    const c2 = chunk.match(/"c2":"((?:\\.|[^"\\])*)"/);
    const c1 = chunk.match(/"c1":"((?:\\.|[^"\\])*)"/);
    const drop = chunk.match(/"is_catch_drop":(\w+)/);
    if (!o) continue;
    feeds.push({
      del: del ? parseInt(del[1], 10) : null,
      o: o[1],
      s: s ? s[1] : null,
      b: b ? (b[1] ?? b[2]) : null,
      c2: c2 ? c2[1] : '',
      c1: c1 ? c1[1] : '',
      drop: drop ? drop[1] : null,
    });
  }
  feeds.reverse(); // raw is newest-first
  return feeds;
}

/**
 * Build the current-over ball list from the getBallFeeds entries.
 * A ball counts as a wicket when the score's wicket count rises vs the
 * previous ball (crex never marks the delivery itself with a W). Falls back
 * to the ball's own run value (4/6/dot/runs); wide/no-ball from the prose.
 */
function currentOverFromCrexFeeds(feeds) {
  const balls = (feeds || []).filter(f => f && f.o);
  if (balls.length < 1) return [];
  const latest = balls[balls.length - 1];
  const overBase = latest.o.match(/^(\d+)\./);
  if (!overBase) return [];
  const over = overBase[1];
  const inOver = balls.filter(f => String(f.o).startsWith(over + '.'));
  const tokens = [];
  for (let i = 0; i < inOver.length; i++) {
    const f = inOver[i];
    const prev = i > 0 ? inOver[i - 1] : null;
    tokens.push(tokenFromCrexBall(f, prev));
  }
  return tokens;
}

/**
 * One feed entry → ball token. Wicket wins (score progression bump), then
 * the ball's own run field, then — only as a tiebreak — the prose.
 *
 * Commentary words are NOT trusted for wide/no-ball: cricket prose uses
 * "wide" constantly to describe LINE ("wide yorker", "wide outside off",
 * "full and wide") for perfectly legal deliveries, which previously turned
 * dots and even SIXES into 'wd' on screen. The score is the ground truth —
 * a real wide adds runs without consuming a legal ball — so 'wd'/'nb' is only
 * emitted when the run field is empty/zero AND the score actually moved.
 */
function parseBallScore(ball) {
  if (!ball || !ball.s) return null;
  const m = String(ball.s).split('/');
  const runs = parseInt(m[0], 10);
  const wkts = parseInt(m[1], 10);
  return (!isNaN(runs) || !isNaN(wkts)) ? { runs: runs || 0, wkts: wkts || 0 } : null;
}

function tokenFromCrexBall(ball, prevBall) {
  const prevScore = parseBallScore(prevBall);
  const curScore = parseBallScore(ball);
  if (prevScore && curScore && curScore.wkts > prevScore.wkts) return 'W';
  const b = String((ball && ball.b) || '').trim().toLowerCase();
  const text = String((ball && (ball.c2 || ball.c1)) || '').toLowerCase();

  if (/^(?:\d+)?wd/.test(b)) return 'wd';       // explicit wd marker ("1wd")
  if (/^(?:\d+)?nb/.test(b)) return 'nb';       // explicit nb marker ("2nb")
  if (/^\d+lb$/.test(b)) return 'lb';           // leg byes
  if (/^\d+by$/.test(b)) return 'by';           // byes
  if (b === 'w' || b === 'wk' || b === 'wicket') return 'W';
  if (b === '' || b === '0' || b === '.' || b === 'dot') {
    // Dot ball — unless the score moved, which only a wide/no-ball can do
    // without being a legal delivery. Prose only distinguishes wd vs nb here.
    const runDelta = prevScore && curScore ? curScore.runs - prevScore.runs : null;
    if (runDelta != null && runDelta >= 1) {
      return /\bno\s*-?\s*ball\b/.test(text) ? 'nb' : 'wd';
    }
    return '·';
  }
  if (/^\d+$/.test(b)) return b;                // 1-7 runs: trust the number
  return normalizeBallToken(b);
}

/**
 * Convert the Crex lastovers blob into an array of per-over ball lists.
 *   {over:"Over 17", overinfo:["0","1","0","0","0","1"], total:2}
 * → [["0","1","0","0","0","1"], …]
 */
function parseCrexLastOvers(raw) {
  if (!raw) return [];
  // Split on },{ to get per-over objects
  const objStrings = raw.split(/\},\{/);
  const overs = [];
  for (const obj of objStrings) {
    // The Hundred labels them "13th Five"; normal formats "Over 13".
    const overMatch = obj.match(/&q;over&q;:&q;(?:Over\s+)?(\d+)/i);
    const infoMatch = obj.match(/&q;overinfo&q;:\[(.*?)\]/);
    if (!infoMatch) continue;
    const balls = infoMatch[1].match(/&q;([^&]*)&q;/g) || [];
    const cleaned = balls
      .map(b => b.replace(/&q;/g, ''))
      .map(b => b.toLowerCase())
      .map(normalizeBallToken)
      .filter(Boolean);
    if (cleaned.length > 0) overs.push({ over: overMatch ? parseInt(overMatch[1], 10) : null, balls: cleaned });
  }
  return overs;
}

function normalizeBallToken(token) {
  const t = String(token || '').trim().toLowerCase();
  if (!t) return '';
  if (t === '0' || t === '.' || t === 'dot') return '·';
  if (t === 'w' || t === 'wk' || t === 'wicket') return 'W';
  if (t === 'wd' || t === 'wide' || /^(?:\d+)?wd/.test(t)) return 'wd';
  if (t === 'nb' || t === 'no ball' || t === 'noball' || /^(?:\d+)?nb/.test(t)) return 'nb';
  if (/^\d+lb$/.test(t)) return 'lb';
  if (/^\d+by$/.test(t)) return 'by';
  return t;
}

/**
 * Derive the current-over ball list from Cricbuzz's ball-by-ball commentary.
 * The commentary rows carry a ball number + a W/6/4 marker. The Hundred uses
 * 5-ball overs and a 100-ball innings; all other formats use 6-ball overs.
 * rows = [{ num, marker, text }] with the page order (newest first); we keep
 * only the balls that fall inside the current over bucket and order them
 * oldest → newest.
 *
 * The bucket comes from the rows themselves, NOT from ballNbr: in a Test,
 * Cricbuzz reports the COMPLETED innings' total balls (e.g. 634 after 105.4
 * overs) while the live innings is on ball ~192 — trusting ballNbr zeroes the
 * current over and kills every boundary/wicket animation.
 */
function currentOverFromCommentary({ ballNbr, format, rows }) {
  if (!rows || !rows.length) return [];
  const ballsPerOver = (getFormatConfig(format) || FORMATS.ODI).ballsPerOver;
  const nums = rows.map(r => parseInt(r.num, 10)).filter(n => !isNaN(n));
  if (!nums.length) return [];
  const latestBall = Math.max(...nums);
  const currentOverStart = Math.floor((latestBall - 1) / ballsPerOver) * ballsPerOver + 1;
  const inOver = rows
    .map(r => ({ n: parseInt(r.num, 10), r }))
    .filter(x => !isNaN(x.n) && x.n >= currentOverStart && x.n <= latestBall)
    .sort((a, b) => a.n - b.n)
    .map(x => tokenFromCommentary(x.r));
  return inOver;
}

function tokenFromCommentary(row) {
  if (!row) return '';
  const marker = String(row.marker || '').trim().toUpperCase();
  if (marker === 'W' || marker === '6' || marker === '4') return marker === 'W' ? 'W' : marker;
  const t = String(row.text || '').toLowerCase();
  if (/out|wicket|batsman.*gone/i.test(t) && /\b(caught|bowled|lbw|run\s*out|stumped|hit\s*wicket)\b/i.test(t)) return 'W';
  if (/\bsix\b/i.test(t)) return '6';
  if (/\bfour\b/i.test(t)) return '4';
  if (/\bwide\b/i.test(t)) return 'wd';
  if (/\bno\s*-?\s*ball\b/i.test(t)) return 'nb';
  if (/\bno\s*run\b/i.test(t)) return '·';
  const m = t.match(/(\d+)\s+run/);
  if (m) return m[1];
  if (/\bleg\s*bye\b/i.test(t)) return 'lb';
  if (/\bbye\b/i.test(t)) return 'by';
  return '·';
}

/**
 * Build the current-over ball list from the lastovers block, knowing which
 * over number we're on.
 */
function currentOverFromLastOvers(lastOvers, currentOverStr) {
  if (!lastOvers || !currentOverStr) return null;
  const o = parseOversString(currentOverStr);
  if (!o.overs && !o.balls) return null;
  const targetOver = o.overs; // over number 0-indexed: 19.2 = over 19, ball 2
  if (targetOver < 0) return null;
  // The lastovers are most-recent first; pick the entry whose label matches.
  for (const entry of lastOvers) {
    if (!entry || !entry.balls || entry.balls.length < 1) continue;
    if (entry.over === targetOver + 1 || entry.over === targetOver) {
      return entry.balls.slice(0, o.balls || entry.balls.length);
    }
  }
  if (lastOvers[0]?.balls) return lastOvers[0].balls.slice(0, o.balls || lastOvers[0].balls.length);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CRICBUZZ — parses the miniscore HTML block (not the OG title)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cricbuzz's score page has a JSON-ish miniscore block we can extract.
 * We look for the score pattern "TEAM 123/4 (12.3)" inside the rendered
 * scorecard, and the batsman / bowler tables for live stats.
 */
function parseCricbuzz(html, url) {
  const $ = cheerio.load(html);
  const slugTeams = (() => {
    const m = (url || '').match(/\/([a-z]{2,4})-vs-([a-z]{2,4})-/i);
    return m ? [m[1].toUpperCase(), m[2].toUpperCase()] : [];
  })();
  const addTeamRow = (row) => {
    // Dedupe by name+runs+wkts (NOT overs): the page repeats the same live
    // innings in several places (desktop/mobile widgets, JSON blocks) and
    // The Hundred renders "(20 Balls)" as if it were 20 overs.
    const key = `${row.name}|${row.runs}|${row.wkts || ''}`;
    if (!teamRows.find(r => r.key === key)) teamRows.push({ key, ...row });
  };

  // 1. Status text — e.g. "Day 1: Stumps - New Zealand trail by 79 runs"
  //    or "England need 150 runs in 93 balls".
  //    The status lives in `.text-cbLive` (live) or `.text-cbTxtLive` (other).
  let status = '';
  $('div').each((_, el) => {
    const t = $(el).text().trim();
    // Skip live-commentary sentences (they contain commas) and anything that
    // looks like a score line ("MSG 19-0 ..."), which is never a status.
    if (!t || t.length > 200 || t.includes(',') || /\b\d{1,4}\s*[\/\-]\s*\d{1,2}\b/.test(t)) return;
    // "Day N: Session - …" or "won by N runs/wkts"
    if (/^(Day\s+\d+[: ]|.*\bwon by\b|.*\bneed\b.*\bruns?\b.*\bballs?\b|.*\bInnings Break\b|.*\bLunch\b|.*\bTea\b|.*\bStumps\b|.*\bDrawn\b|.*\bTied\b|.*\bMatch ends\b|.*\bopt to (?:bat|bowl)\b)/i.test(t)) {
      if (!status || t.length < status.length) status = t;
    }
  });
  status = status.split('\n')[0].trim().replace(/\s+/g, ' ');
  // Trim very long statuses
  if (status.length > 180) status = status.substring(0, 180).trim();

  // 2. Score lines. Cricbuzz renders each team as a row with class names.
  //    We grab ALL "NNN/W" patterns and then pair them with team names.
  const teamRows = [];
  $('.miniscore-branding-container').find('div').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    // Look for "ENG 140" or "NZ 61-6 (19.2)" or "WI 262 (49.2)"
    const m = text.match(/^([A-Z]{2,4}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(\d{1,4})\s*(?:[\/\-]\s*(\d{1,2}))?\s*(?:\(\s*(\d+(?:\.\d+)?)\s*\))?$/);
    if (m && m[1].length <= 25) {
      addTeamRow({
        name: m[1],
        runs: m[2],
        wkts: m[3] || null,
        overs: m[4] || null,
      });
    }
  });

  if (teamRows.length < 2) {
    // Cricbuzz embeds the state as an "inningsScoreList" JSON array. Each
    // innings has its own batTeamName/score. This is the most reliable
    // source (correct overs, all innings), so try it before text fallbacks.
    const arrStart = html.indexOf('inningsScoreList');
    const innHtml = arrStart >= 0 ? html.substring(arrStart, arrStart + 20000) : html;
    const inningsRe = /\{\\"inningsId\\":(\d+),\\"batTeamId\\":(\d+),\\"batTeamName\\":\\"([^\\"]+)\\",\\"score\\":(\d+),\\"wickets\\":(\d+),\\"overs\\":([\d.]+)/g;
    let m;
    while ((m = inningsRe.exec(innHtml)) !== null) {
      addTeamRow({
        name: m[3],
        runs: m[4],
        wkts: m[5],
        overs: m[6],
      });
      if (teamRows.length >= 2) break;
    }
  }

  // The full innings history — every Test innings, deduped by inningsId (the
  // page repeats rows; the first occurrence is the freshest). This powers the
  // Test innings strip in the overlay. Parsed unconditionally: the miniscore
  // text above only surfaces the live + last completed innings.
  const inningsList = [];
  {
    const arrStart = html.indexOf('inningsScoreList');
    const innHtml = arrStart >= 0 ? html.substring(arrStart, arrStart + 20000) : html;
    const inningsRe = /\{\\"inningsId\\":(\d+),\\"batTeamId\\":(\d+),\\"batTeamName\\":\\"([^\\"]+)\\",\\"score\\":(\d+),\\"wickets\\":(\d+),\\"overs\\":([\d.]+)/g;
    const seen = new Set();
    let m;
    while ((m = inningsRe.exec(innHtml)) !== null) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      inningsList.push({ inningsId: parseInt(m[1], 10), name: m[3], runs: m[4], wkts: m[5], overs: m[6] });
      if (inningsList.length >= 6) break;
    }
  }

  if (teamRows.length < 2) {
    const pageText = $('body').text().replace(/\s+/g, ' ').trim();
    const compactScoreRe = /\b([A-Z]{2,4})\s+(\d{1,4})(?:\s*[\/\-]\s*(\d{1,2}))?\s*(?:\(\s*(\d+(?:\.\d+)?)\s*\))/g;
    let m;
    while ((m = compactScoreRe.exec(pageText)) !== null) {
      addTeamRow({
        name: m[1],
        runs: m[2],
        wkts: m[3] || null,
        overs: m[4] || null,
      });
      if (teamRows.length >= 2) break;
    }
  }

  // If we still don't have two distinct teams (e.g. the opponent hasn't
  // batted yet), fall back to the URL slug ("msg-vs-tre" → MSG vs TRE).
  if (slugTeams.length === 2 && new Set(teamRows.map(r => (r.name || '').toUpperCase())).size < 2) {
    const have = new Set(teamRows.map(r => (r.name || '').toUpperCase()));
    for (const s of slugTeams) {
      if (!have.has(s)) {
        addTeamRow({ name: s, runs: null, wkts: null, overs: null });
        have.add(s);
      }
    }
  }

  // Heuristic: the active batting side is usually the side mentioned in the
  // status ("NZ need...", "New Zealand trail..."). If that isn't available,
  // prefer an incomplete innings; only then fall back to the last score row.
  let batRow = null;
  const statusLower = status.toLowerCase();
  if (statusLower) {
    batRow = teamRows.find(r => {
      const name = String(r.name || '').toLowerCase();
      return name && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(statusLower);
    });
  }
  if (!batRow && slugTeams.length === 2 && /need\s+\d+\s+runs?/i.test(status)) {
    const needTeam = status.match(/\b([A-Z]{2,4})\b\s+need/i)?.[1];
    if (needTeam) batRow = teamRows.find(r => r.name === needTeam);
  }
  if (!batRow) batRow = teamRows.find(r => r.wkts !== null && parseInt(r.wkts, 10) < 10);
  if (!batRow) batRow = teamRows[teamRows.length - 1];

  if (!batRow) return null;

  // 3+4. Batsmen + Bowler. Cricbuzz's live widget reuses .scorecard-bat-grid
  //    for both sections; "Batter"/"Bowler"/"Key Stats" header rows switch
  //    the active section. Older layouts use dedicated grids — fall back below.
  const fmt = detectFormat(url, html.match(/<title>([^<]*)<\/title>/)?.[1]);
  const batsmen = [];
  let bowler = null;
  let section = null;
  $('.scorecard-bat-grid').each((_, el) => {
    const cells = $(el).children();
    if (cells.length < 3) return;
    const first = $(cells[0]).text().replace(/\s+/g, ' ').trim();
    const header = first.toLowerCase();
    if (/^(batter|bowler|key\s*stats|fow|extras|did\s+not\s+bat|how\s+out)$/.test(header)) {
      section = header;
      return;
    }
    if (section === 'bowler' && !bowler) {
      // Cricbuzz's live-widget columns depend on the format:
      //   - The Hundred: [Bowler, B, D, R, W, RPB] (balls, dots, runs, wkts, runs-per-ball)
      //   - everything else: [Bowler, O, M, R, W, ECO] (overs, maidens, runs, wkts, economy)
      const name = first.replace(/\s*\*\s*$/, '').trim();
      const c1 = $(cells[1]).text().trim(); // HUN: B(alls); else O(vers)
      const c2 = $(cells[2]).text().trim(); // HUN: D(ots); else M(aidens)
      const runs = $(cells[3]).text().trim(); // R
      const wkts = $(cells[4]).text().trim(); // W
      const c5 = $(cells[5]).text().trim();   // HUN: RPB; else ECO
      if (name && /^\d+(\.\d+)?$/.test(c1) && /^\d+$/.test(runs) && /^\d+$/.test(wkts)) {
        if (fmt === 'HUN') {
          const b = parseInt(c1, 10);
          bowler = { name, wickets: wkts, runs, balls: b, overs: `${Math.floor(b / 5)}.${b % 5}` };
          if (c2 && /^\d+$/.test(c2)) bowler.dots = c2;
          if (c5 && !isNaN(parseFloat(c5))) bowler.rpb = c5;
        } else {
          const o = parseOversString(c1);
          bowler = { name, wickets: wkts, runs, overs: c1, balls: o.overs * 6 + o.balls };
          if (c2 && /^\d+$/.test(c2)) bowler.maidens = c2;
          if (c5 && !isNaN(parseFloat(c5))) bowler.eco = c5;
        }
      }
      return;
    }
    if (section === 'batter' && batsmen.length < 2) {
      // Strip " * " (striker marker) and trailing role
      const name = first.replace(/\s*\*\s*$/, '').replace(/\s*\((?:c|wk|†|&amp;c|&amp;wk)\)\s*$/i, '').trim();
      const runs = $(cells[1]).text().trim();
      const balls = $(cells[2]).text().trim();
      if (name && /^\d+$/.test(runs) && /^\d+$/.test(balls)) {
        batsmen.push({ name, runs, balls, striker: first.includes('*') });
      }
    }
  });

  // Fallback for classic Cricbuzz layouts that don't use the shared grid.
  if (batsmen.length === 0) {
    $('.scorecard-bat-grid').each((_, el) => {
      if (batsmen.length >= 2) return;
      const cells = $(el).children();
      if (cells.length < 3) return;
      const nameCell = $(cells[0]).text().replace(/\s+/g, ' ').trim();
      const name = nameCell.replace(/\s*\*\s*$/, '').replace(/\s*\((?:c|wk|†|&amp;c|&amp;wk)\)\s*$/i, '').trim();
      if (!name) return;
      const runs = $(cells[1]).text().trim();
      const balls = $(cells[2]).text().trim();
      if (!/^\d+$/.test(runs) || !/^\d+$/.test(balls)) return;
      batsmen.push({ name, runs, balls, striker: nameCell.includes('*') });
    });
  }
  if (!bowler) {
    $('.sc-bowler-grid, .scorecard-bowl-grid').each((_, el) => {
      if (bowler) return;
      const cells = $(el).children();
      if (cells.length < 4) return;
      const name = $(cells[0]).text().replace(/\s+/g, ' ').trim();
      const wkts = $(cells[1]).text().trim();
      const runs = $(cells[2]).text().trim();
      const overs = $(cells[3]).text().trim();
      if (name && /^\d+$/.test(wkts) && /^\d+$/.test(runs) && /^\d+(\.\d+)?$/.test(overs)) {
        bowler = { name, wickets: wkts, runs, overs };
      }
    });
  }

  // 5. CRR / RRR — usually small labels next to the score
  let crr = '';
  let rrr = '';
  let rpb = '';
  $('span').each((_, el) => {
    const t = $(el).text().trim();
    if (t === 'CRR:') {
      const next = $(el).next().text().trim();
      if (next) crr = next;
    }
    if (t === 'RPB:') {
      const next = $(el).next().text().trim();
      if (next) rpb = next;
    }
    if (t === 'REQ:' || t === 'RRR:') {
      const next = $(el).next().text().trim();
      if (next) rrr = next;
    }
  });

  // 6. Partnership — "32 (38)" pattern
  let partnership = '';
  $('span').each((_, el) => {
    if (partnership) return;
    const t = $(el).text().trim();
    if (t === "P'SHIP") {
      const next = $(el).next().text().trim();
      if (next) partnership = next;
    }
  });

  // 7. Last wicket — Cricbuzz embeds it in the match-state JSON
  //    ("lastWicket":"Tim Seifert  c Tim David b Craig Overton 12(9)  - 39/1").
  //    The overlay uses it to pick the right wicket animation type.
  let lastWicket = '';
  const lwJson = html.match(/\\"lastWicket\\":\\"([^\\"]*)\\"/);
  if (lwJson && lwJson[1]) {
    lastWicket = lwJson[1].replace(/\s+/g, ' ').trim();
  } else {
    // HTML fallback: "Last Wkt: </span>Heinrich Klaasen  c Finn Allen b Craig Overton 0(2)  - 56/3</div>"
    const lwHtml = html.match(/Last Wkt:\s*<\/span>\s*([^<]*)/i);
    if (lwHtml && lwHtml[1]) {
      lastWicket = lwHtml[1].replace(/\s+/g, ' ').trim();
    }
  }

  // 8. Current over — rebuilt from the ball-by-ball commentary. The innings
  //    JSON gives the latest ball number; the commentary rows carry the ball
  //    number + a W/6/4 marker, which lets the overlay fire wicket/boundary
  //    animations on the live page (The Hundred = 5-ball overs, others = 6).
  const ballNbrMatch = html.match(/\\"ballNbr\\":(\d+)/);
  const ballNbr = ballNbrMatch ? parseInt(ballNbrMatch[1], 10) : null;
  const commentaryRows = [];
  const cmtRe = /<div class="font-bold text-center(?: !min-w-\[1\.5rem\])?">([^<]*)<\/div>(?:<div class="bg-cbLive[^"]*">W<\/div>|<div class="bg-cbSix[^"]*">6<\/div>|<div class="bg-cbFour[^"]*">4<\/div>)?<\/div><div>([^<]*(?:<[^>]*>[^<]*<\/[^>]*>[^<]*)*)<\/div>/g;
  let cm;
  while ((cm = cmtRe.exec(html)) !== null) {
    const num = cm[1].trim();
    const text = cm[2].replace(/<[^>]+>/g, '').trim();
    if (!text) continue;
    const markerMatch = cm[0].match(/bg-cb(?:Live|Six|Four)[^>]*>(W|6|4)<\/div>/);
    commentaryRows.push({ num, marker: markerMatch ? markerMatch[1] : '', text });
    if (commentaryRows.length >= 40) break;
  }
  const currentOver = currentOverFromCommentary({ ballNbr, format: fmt, rows: commentaryRows });

  return {
    source: 'cricbuzz',
    batRow,
    teamRows,
    batsmen,
    bowler,
    status,
    crr,
    rrr,
    rpb,
    partnership,
    lastWicket,
    currentOver,
    ballNbr,
    inningsList,
    html,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CRICKET FAST LIVE LINE (CFLL) — title-based parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CFLL puts the score right in the <title>:
 *   "PAK: 161/6 (41.5) | PAK vs AUS Live score,  3rd Match | Australia tour of Pakistan, 2026 - CFLL"
 * Sometimes it has a ":" separator (PAK: 161/6) and sometimes not.
 */
function parseCFLL(title, url) {
  if (!title) return null;
  const m = title.match(/([A-Z]{2,4})\s*:?\s*(\d{1,4})\s*(?:[\/\-]\s*(\d{1,2}))?\s*\(\s*(\d+(?:\.\d+)?)\s*\)/);
  if (!m) return null;
  return {
    source: 'cfll',
    batTeamAbbr: m[1],
    score: formatScore(m[2], m[3], { assumeNoWicket: true }),
    overs: m[4],
    title,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Status / target / lead-trail math
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "Day 1: Stumps - New Zealand trail by 79 runs" → "Day 1: Stumps"
 * "NZ need 150 runs in 93 balls" → "NZ need 150 runs in 93 balls"
 * Don't surface cross-match noise (won by, from another match, etc.)
 */
function cleanStatus(raw, batTeamAbbr, oppTeamAbbr) {
  if (!raw) return '';
  // Crex uses custom escapes (&s;, &l;, &g;) around inline HTML in comment1.
  // Decode those markers, remove provider markup, then normalize whitespace so
  // the overlay receives display text rather than escaped HTML.
  let s = String(raw)
    .replace(/&s;/gi, "'")
    .replace(/&q;/gi, '"')
    .replace(/&l;/gi, '<')
    .replace(/&g;/gi, '>')
    .replace(/&a;/gi, '&')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  // Reject anything that names a team that isn't either of our two
  // participating teams, unless it's a generic "X won by Y".
  // First pass: shorten "Day N: Stumps - X trail/lead by Y runs" → "Day N: Stumps"
  s = s.replace(/\s+[—-]\s+[A-Z][\w\s]+?\s+(trail|lead)s?\s+by\s+\d+\s+runs?\s*$/i, '').trim();
  // Also strip "X won by N runs/wkts" appendages if they don't match our teams
  s = s.replace(/\s+[A-Z][\w\s]+?\s+won\s+by\s+\d+\s+(runs?|wkts?|wickets?)\s*$/i, '').trim();
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-source data-builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Take a Crex-API dump and build the final scorecard payload.
 */
function resolveCrexFormat(api, url, title = '') {
  const hints = [url, title, api?.sourceTitle].filter(Boolean).join(' ');
  const detected = detectFormat(hints);
  if (detected) return detected;
  // Exact balls are a provider-level invariant for The Hundred.
  if (api?.hballs1 || api?.hballs2 || api?.bBalls) return 'HUN';
  // Unknown is intentionally left unknown; silently treating it as Test
  // changes innings, rate, and target semantics with no evidence.
  return null;
}

/**
 * Coherence gate for the getSV3 blob. The page fuses separately-cached
 * upstream payloads, so the top-level team score can lag (or even regress —
 * observed 245/5 → 243/5) versus the fresh getBallFeeds array. The newest
 * feed entry carries the score after its ball; when that disagrees with
 * score1, the page is a torn snapshot and must not be broadcast.
 */
function crexScoreCoherent(api) {
  const feeds = Array.isArray(api?.ballFeeds) ? api.ballFeeds : null;
  if (!feeds || feeds.length === 0) return { ok: true };
  const latest = feeds[feeds.length - 1];
  if (!latest || !latest.s) return { ok: true };
  const feedScore = normalizeScore(latest.s);
  const topScore = normalizeScore(api.score1 || '');
  if (!feedScore || !topScore) return { ok: true };
  if (feedScore === topScore) return { ok: true };
  return { ok: false, reason: `ball feed ${feedScore} vs top-level ${topScore}` };
}

function buildFromCrex(api, url, title = '') {
  const fmt = resolveCrexFormat(api, url, title);
  const cfg = getFormatConfig(fmt);
  const team1 = api.team1;          // currently batting (abbreviation)
  const team2 = api.team2;          // other side
  const team1Full = api.team1Full || team1;
  const team2Full = api.team2Full || team2;

  const score1 = normalizeScore(api.score1 || '0/0');
  const over1 = api.over1 || '0.0';
  const rawScore2 = normalizeScore(api.score2 || '');
  const score2 = isBlankScore(rawScore2) || rawScore2 === '0/0' ? '' : rawScore2;
  const over2 = score2 ? (api.over2 || '0.0') : '';

  if (!isPlausibleScore(score1, over1, fmt)) return null;

  // Crex convention (verified against the getSV3 payload):
  //   - `team1` is ALWAYS the team currently batting (live).
  //   - `score1` is ALWAYS that batting team's live score.
  //   - `team2` is the opponent (either yet-to-bat or already bowled).
  //   - `score2` is the opponent's last completed innings total (or 0/0).
  //   - `inning` is the current innings number (1, 2, 3, 4 in a Test).
  //   - `target` is what the batting team needs to win.
  //
  // Cricket sanity check: if the live score is *higher* than the
  // opponent's first-innings total and there's no target, the batting
  // team has already passed — usually means we've crossed over (e.g.
  // 3rd innings of a Test). We still trust the labels as-is.
  const batAbbr = team1;
  const batFull = team1Full;
  const batScore = score1;
  const batOvers = over1;
  const oppAbbr = team2;
  const oppFull = team2Full;
  const oppScore = score2;
  const oppOvers = over2;

  // Detect innings switch / new match
  const matchKey = `${batAbbr}-${oppAbbr}-${api.inning || '1'}`;
  if (matchState.lastMatchKey && matchState.lastMatchKey !== matchKey) {
    if (!matchState.lastMatchKey.startsWith(`${oppAbbr}-${batAbbr}`)) {
      console.log(`[Poll] Crex: new match detected (${matchState.lastMatchKey} → ${matchKey})`);
    }
    matchState.crexPlayers = null;
  }
  matchState.lastMatchKey = matchKey;

  const batCb = _cbFlag(batAbbr, batFull);
  const batTeam = { name: batFull, score: batScore, overs: batOvers, abbr: batAbbr };
  batTeam.flag = batCb || api.team1Img || null;
  const oppCb = _cbFlag(oppAbbr, oppFull);
  const oppTeam = { name: oppFull, score: oppScore, overs: oppOvers, abbr: oppAbbr };
  oppTeam.flag = oppCb || api.team2Img || null;
  if (!oppScore) oppTeam.note = 'Yet to bat';

  // The Hundred: no overs — report exact balls bowled ("75b").
  if (cfg && !cfg.showOvers) {
    const batBalls = parseBallsField(api.hballs1);
    if (batBalls != null) batTeam.balls = batBalls;
    const oppBalls = parseBallsField(api.hballs2);
    if (oppBalls != null) oppTeam.balls = oppBalls;
  }

  // Batsmen
  let batsmen = [];
  // The `os1`/`os2` fields encode who is on strike: 1 = on strike, 0 = off.
  // Fall back to the `strikker1`/`strikker2` boolean if present, then to
  // the `*` marker in pname1/pname2.
  const p1OnStrike = api.os1 === '1' || api.os1 === 1 ||
                     api.strikker1 === '1' || api.strikker1 === 'true' ||
                     /\*/.test(api.pname1 || '');
  const p2OnStrike = api.os2 === '1' || api.os2 === 1 ||
                     api.strikker2 === '1' || api.strikker2 === 'true' ||
                     /\*/.test(api.pname2 || '');
  if (api.playerFull1 && api.run1 != null) {
    batsmen.push({
      name: api.playerFull1,
      runs: api.run1,
      balls: (api.ball1 || '(0)').replace(/[()]/g, ''),
      striker: p1OnStrike,
    });
  }
  if (api.playerFull2 && api.run2 != null) {
    batsmen.push({
      name: api.playerFull2,
      runs: api.run2,
      balls: (api.ball2 || '(0)').replace(/[()]/g, ''),
      striker: p2OnStrike,
    });
  }

  // Bowler
  let bowler = null;
  if (api.bname || api.bowlerFull) {
    const figs = parseFigures(api.bwr);
    bowler = {
      name: api.bowlerFull || api.bname,
      wickets: figs?.wkts || '0',
      runs: figs?.runs || '0',
      overs: api.bover || '0.0',
    };
    if (fmt === 'HUN') {
      const bowlBalls = parseBallsField(api.bBalls);
      if (bowlBalls != null) bowler.balls = bowlBalls;
      const bowlRuns = parseInt(figs?.runs || '0', 10);
      if (bowlBalls > 0 && !isNaN(bowlRuns)) bowler.rpb = (bowlRuns / bowlBalls).toFixed(2);
    }
  }

  // Current over (this over) – prefer the fresh ball-by-ball feed; the
  // explicit lastovers block lags 3-6 balls behind, so a feed-driven list is
  // used first and lastovers only as a fallback when the feed is missing.
  let currentOver = [];
  const feedOver = currentOverFromCrexFeeds(api.ballFeeds);
  if (feedOver.length > 0) {
    currentOver = feedOver;
  } else {
    const lastOvers = parseCrexLastOvers(api.lastoversRaw);
    currentOver = currentOverFromLastOvers(lastOvers, batOvers) || [];
  }

  // Status — crex's only trustworthy status TEXT is comment1 ("WF opt to
  // Bowl", "NZ trail by 79 runs", ...). The B/session fields are numeric IDs
  // or overloaded placeholders ("0", "Over", "Spin Bowler") — never shown.
  let leadTrail = '';
  let status = cleanStatus(api.comment1 || '', batAbbr, oppAbbr);
  if (status) {
    const m = status.match(/·?([A-Z][\w\s]+?)\s+(trail|lead)s?\s+by\s+(\d+)\s+runs?/i);
    if (m) {
      leadTrail = `${m[1].trim()} ${m[2].toLowerCase()} by ${m[3]} runs`;
    }
  }
  // Crex pads comment1 with placeholder tokens when there's no live status
  // text ("0", "Over", "Ball") — don't surface them as the status line.
  if (/^(?:\d+|Over|Ball|Overs?|Balls?)$/i.test(status || '')) status = '';

  // Build "Target" / "Need" math. In Tests, Crex can expose a first-innings
  // reference total as `target`; only show it as a target in an actual chase.
  let target = null;
  const inningsNo = parseInt(api.inning || '0', 10);
  const isTestChase = fmt === 'Test' && (inningsNo >= 4 || /need\s+\d+\s+runs?/i.test(api.comment1 || ''));
  if (api.target && parseInt(api.target, 10) > 0 && (fmt !== 'Test' || isTestChase)) {
    const tgt = parseInt(api.target, 10);
    const batting = parseScoreString(batScore);
    const need = Math.max(0, tgt - (batting?.runs || 0));
    target = {
      current: String(batting?.runs || 0),
      total: String(tgt),
      need: String(need),
    };
    if (cfg && cfg.chaseBalls) {
      // The Hundred reports exact balls bowled ("51b"); deriving them from
      // overs is wrong (Crex reports "0.0" overs). Fall back to overs only
      // when no exact ball count exists.
      const ballsBowled = batTeam.balls != null ? batTeam.balls : oversToBalls(batOvers, fmt);
      const remaining = maxBallsForFormat(fmt) - ballsBowled;
      target.balls = String(Math.max(0, remaining));
    }
  }

  // Player-stat coherence: Crex's top-level player fields can lag the fresh
  // ball feed (a DRS review or innings break drops them for a poll or two).
  // Reuse the last coherent set on the SAME delivery; hold the snapshot when
  // a new delivery arrived but the players didn't — otherwise the overlay
  // would render a fresh team score glued to stale batter/bowler figures.
  let playerHold = false;
  let holdReason = '';
  const scoreCoherent = crexScoreCoherent(api);
  if (!scoreCoherent.ok) {
    playerHold = true;
    holdReason = scoreCoherent.reason || 'score mismatch';
  }
  const seq = api.lastBallSeq != null
    ? api.lastBallSeq
    : (Array.isArray(api.ballFeeds) && api.ballFeeds.length > 0 && api.ballFeeds[api.ballFeeds.length - 1].del != null
        ? api.ballFeeds[api.ballFeeds.length - 1].del
        : null);
  // Only a COMPLETE set (both current batters + the bowler) may replace the
  // stored coherent set; a partial set is indistinguishable from a lagging
  // payload and must not overwrite a good one.
  const playersPresent = batsmen.length >= 2 && bowler != null;
  if (playersPresent && !playerHold) {
    // Only a COHERENT poll may update the stored set. A torn (score-mismatched)
    // page has top-level player fields that lag the feed just like score1 does;
    // stamping those with the feed's seq would let the next poll reuse stale
    // figures and glue them onto a fresh score. Never poison the store.
    matchState.crexPlayers = { seq, batsmen: batsmen.slice(0, 2), bowler };
  } else if (matchState.crexPlayers) {
    // Reuse only when we can PROVE it is the same delivery. When either side
    // has no delivery marker we cannot prove identity, and gluing stale
    // players onto an advanced ball re-creates the sync bug — hold instead.
    const storedSeq = matchState.crexPlayers.seq;
    const sameDelivery = storedSeq != null && seq != null && Number(seq) === Number(storedSeq);
    if (sameDelivery) {
      batsmen = matchState.crexPlayers.batsmen.slice();
      bowler = matchState.crexPlayers.bowler;
    } else {
      playerHold = true;
    }
  } else {
    // No stored set (fresh process / match change) AND player data is
    // incomplete. Identity is unprovable, and broadcasting this empty-player
    // payload would let the overlay glue its stale figures onto a fresh score
    // after a poller restart — hold until a complete set arrives.
    playerHold = true;
    holdReason = holdReason || 'missing player data (no stored set)';
  }

  // Result construction
  const result = {
    teams: [batTeam, oppTeam],
    batsmen: batsmen.slice(0, 2),
    status: status || '',
  };
  if (bowler) result.bowler = bowler;
  if (playerHold) {
    result._hold = true;
    result._holdReason = holdReason;
  }
  // The Hundred has no run rate — its official scoring metric is RPB (runs
  // per ball), so it replaces CRR/RRR on every display. Other formats keep
  // CRR (and RRR when a chase target is live).
  if (cfg && cfg.rateMetric === 'rpb') {
    const batRuns = parseScoreString(batScore)?.runs;
    const balls = batTeam.balls;
    if (balls > 0 && batRuns != null) result.rpb = (batRuns / balls).toFixed(2);
  } else {
    if (api.crr && api.crr !== '--') result.crr = api.crr;
    if (api.rrr && api.rrr !== '--') result.rrr = api.rrr;
  }
  if (api.partnerruns) result.partnership = `${api.partnerruns}${api.partnerballs ? ' (' + api.partnerballs + ')' : ''}`;
  if (api.lwname1) {
    // Prepend the how-out mode when the recent commentary disclosed it, so the
    // overlay can pick the right wicket animation (CAUGHT!/LBW!/RUN OUT!/…).
    // Unknown mode → the overlay shows a neutral WICKET! burst.
    const mode = detectCrexDismissalMode(api.commentaryTexts, api.ballFeeds);
    result.lastWicket = `${api.lwname1}${mode ? ' ' + mode : ''} ${api.lwrun1 || 0}${api.lwball1 ? ' (' + String(api.lwball1).replace(/[()]/g, '') + ')' : ''}`;
  }
  if (leadTrail) result.leadTrail = leadTrail;
  if (currentOver.length > 0) result.currentOver = currentOver;
  if (api.lastBallSeq != null) result.lastBallSeq = api.lastBallSeq;
  if (target) result.target = target;
  if (fmt) result.format = fmt;
  if (cfg) {
    // The overlay never special-cases a format; it renders from these stamped
    // flags so the poller's FORMATS config stays the single source of truth.
    result.showBalls = !cfg.showOvers;
    result.rateMetric = cfg.rateMetric;
    result.rateMax = cfg.rateMax;
  }
  if (api.inning) result.inning = parseInt(api.inning, 10);
  // Crex sends numeric session placeholders for limited-overs matches too;
  // only Test format may expose day/session context to the overlay.
  if (fmt === 'Test') {
    if (api.day) result.day = api.day;
    if (api.session && api.session !== '--') result.session = api.session;
    if (api.session2 && api.session2 !== '--') result.session2 = api.session2;
  }
  return result;
}

/**
 * Take a Cricbuzz parse and build the final payload.
 */
function buildFromCricbuzz(parsed, url) {
  if (!parsed) return null;
  // Never silently default an unknown match to ODI: a Test whose URL/title
  // omits the word "test" must still behave like a Test. Infer it from the
  // live status when the URL is silent.
  let fmt = detectFormat(url);
  if (!fmt && parsed.status && /\b(?:Day\s+\d|Stumps|Lunch|Tea|trail\s+by|lead\s+by)\b/i.test(parsed.status)) {
    fmt = 'Test';
  }
  const cfg = getFormatConfig(fmt);

  // Use the teamRows to figure out the batting side and the other side.
  // The teamRows in cricbuzz are in the order they appear on the page
  // (bowled-out team first, then batting team, in 2nd-innings layout).
  // We have already picked batRow; pair it with the other row.
  const bat = parsed.batRow;
  // Pick the opponent by NAME, not row key — duplicate names (same innings
  // scraped from two JSON blocks) used to pair a team with itself.
  const other = parsed.teamRows.find(r => (r.name || '').toUpperCase() !== (bat.name || '').toUpperCase());
  if (!bat) return null;

  const batAbbr = bat.name;
  const batScore = formatScore(bat.runs, bat.wkts, { assumeNoWicket: true });
  const batOvers = bat.overs || '0.0';
  const batName = batAbbr;
  const oppAbbr = other?.name || '';
  const oppScore = other ? formatScore(other.runs, other.wkts, { completed: other.key !== bat.key }) : '';
  const oppOvers = oppScore ? (other?.overs || '0.0') : '';

  // Pre-match state (toss done, play not started): both sides scoreless. Hand
  // a minimal payload so the overlay switches to the new match immediately and
  // shows a "Waiting" badge instead of keeping the previous match on screen.
  // Gated on a not-started status so a live scorecard page that the parser
  // can't fully read never masquerades as "Waiting".
  const preMatchStatus = /(opt(?:ing)?\s+to\s+(?:bat|bowl|field)|won\s+the\s+toss|toss|not\s+started|yet\s+to\s+start|start\s+time)/i.test(parsed.status || '');
  if (preMatchStatus && isBlankScore(batScore) && isBlankScore(oppScore)) {
    const result = {
      teams: [
        { name: batName, score: '', overs: '', abbr: batAbbr, flag: _cbFlag(batAbbr, batName) },
        { name: oppAbbr || 'Opponent', score: '', overs: '', abbr: oppAbbr || '', flag: _cbFlag(oppAbbr, oppAbbr || ''), note: 'Yet to bat' },
      ],
      batsmen: [],
      status: cleanStatus(parsed.status, batAbbr, oppAbbr),
    };
    if (fmt) result.format = fmt;
    return result;
  }

  if (!isPlausibleScore(batScore, batOvers, fmt)) return null;

  const matchKey = `${batAbbr}-${oppAbbr}`;
  if (matchState.lastMatchKey && matchState.lastMatchKey !== matchKey && !matchState.lastMatchKey.startsWith(`${oppAbbr}-${batAbbr}`)) {
    console.log(`[Poll] Cricbuzz: new match detected (${matchState.lastMatchKey} → ${matchKey})`);
  }
  matchState.lastMatchKey = matchKey;

  // Infer innings number from teamRows count + status
  let inning = null;
  const rowCount = parsed.teamRows.length;
  const statusL = (parsed.status || '').toLowerCase();
  const oppBlank = !oppScore || /^(?:\s*|-|--|yet to bat|dnb)$/i.test(String(oppScore).trim());
  if (rowCount >= 4) inning = 4;
  else if (rowCount >= 3 && (statusL.includes('trail') || statusL.includes('lead'))) inning = 3;
  else if (rowCount >= 3) inning = 3;
  else if (rowCount >= 2 && /need\s+\d+\s+runs?/i.test(statusL)) inning = 2;
  else if (rowCount >= 2 && !oppBlank) inning = 2;
  else if (rowCount >= 2) inning = 1;
  else inning = 1;

  const result = {
    teams: [
      { name: batName, score: batScore, overs: batOvers, abbr: batAbbr, flag: _cbFlag(batAbbr, batName) },
      { name: oppAbbr || 'Opponent', score: oppScore, overs: oppOvers, abbr: oppAbbr || '', flag: _cbFlag(oppAbbr, oppAbbr || ''), note: oppScore ? '' : 'Yet to bat' },
    ],
    batsmen: (parsed.batsmen || []).slice(0, 2),
    status: cleanStatus(parsed.status, batAbbr, oppAbbr),
  };

  // The Hundred: no overs — Cricbuzz's "ballNbr" is the exact balls bowled.
  if (cfg && !cfg.showOvers && parsed.ballNbr != null) {
    result.teams[0].balls = parsed.ballNbr;
  }
  if (parsed.bowler) result.bowler = parsed.bowler;
  // Formats with a per-ball metric report RPB; formats with a per-over metric
  // report CRR (and RRR while a chase target is live).
  if (cfg && cfg.rateMetric === 'rpb') {
    if (parsed.rpb) {
      result.rpb = parsed.rpb;
    } else {
      const batRuns = parseScoreString(batScore)?.runs;
      const balls = parsed.ballNbr;
      if (balls > 0 && batRuns != null) result.rpb = (batRuns / balls).toFixed(2);
    }
  } else {
    if (parsed.crr) result.crr = parsed.crr;
    if (parsed.rrr) result.rrr = parsed.rrr;
  }
  if (parsed.partnership) result.partnership = parsed.partnership;
  if (parsed.lastWicket) result.lastWicket = parsed.lastWicket;
  if (parsed.currentOver?.length) result.currentOver = parsed.currentOver;
  if (parsed.ballNbr != null) result.lastBallSeq = parsed.ballNbr;

  // A Test's innings strip: every innings so far, with the last one flagged
  // live. The overlay renders this instead of guessing from two team rows.
  if (fmt === 'Test' && Array.isArray(parsed.inningsList) && parsed.inningsList.length) {
    result.innings = parsed.inningsList.map((inn, i, arr) => ({
      name: inn.name,
      score: formatScore(inn.runs, inn.wkts, { completed: parseInt(inn.wkts, 10) >= 10 }),
      overs: inn.overs,
      live: i === arr.length - 1,
    }));
  }

  if (fmt) result.format = fmt;
  if (cfg) {
    result.showBalls = !cfg.showOvers;
    result.rateMetric = cfg.rateMetric;
    result.rateMax = cfg.rateMax;
  }
  if (inning) result.inning = inning;

  const leadM = (parsed.status || '').match(/([A-Z][A-Za-z\s]+|[A-Z]{2,4})\s+(trail|lead)s?\s+by\s+(\d+)\s+runs?/i);
  if (leadM) result.leadTrail = `${leadM[1].trim()} ${leadM[2].toLowerCase()} by ${leadM[3]} runs`;

  // Try to build a target from the status text ("X need N runs in M balls").
  // In a Test the "in M balls" part never appears — a bare "need N runs" is a
  // 4th-innings chase and must produce a target too (with no ball count).
  if (parsed.status) {
    const needM = parsed.status.match(/need\s+(\d+)\s+runs?(?:\s+in\s+(\d+)\s+balls)?/i);
    if (needM) {
      const batting = parseScoreString(batScore);
      const total = (batting?.runs || 0) + parseInt(needM[1], 10);
      const targetObj = {
        current: String(batting?.runs || 0),
        total: String(total),
        need: needM[1],
      };
      if (needM[2]) targetObj.balls = needM[2];
      result.target = targetObj;
    }
  }

  return result;
}

/**
 * CFLL → final payload. Minimal but enough for a live score overlay.
 */
function buildFromCFLL(parsed, url) {
  if (!parsed) return null;
  const fmt = detectFormat(url, parsed.title) || 'ODI';
  if (!isPlausibleScore(parsed.score, parsed.overs, fmt)) return null;

  // Try to extract the opponent from the title
  //   "PAK: 161/6 (41.5) | PAK vs AUS Live score,  3rd Match | ..."
  const m = parsed.title.match(/(\w+)\s+vs\.?\s+(\w+)\s+Live/i);
  const oppAbbr = m ? (m[1] === parsed.batTeamAbbr ? m[2] : m[1]) : '';

  // Try to extract a status (need X runs in Y balls)
  let status = '', target = null;
  const needM = parsed.title.match(/need\s+(\d+)\s+runs?\s+in\s+(\d+)\s+balls/i);
  if (needM) {
    status = parsed.title.match(/(.*?need\s+\d+\s+runs?\s+in\s+\d+\s+balls)/i)?.[1].trim();
    const batting = parseScoreString(parsed.score);
    const total = (batting?.runs || 0) + parseInt(needM[1], 10);
    target = {
      current: String(batting?.runs || 0),
      total: String(total),
      need: needM[1],
      balls: needM[2],
    };
  }

  const result = {
    teams: [
      { name: parsed.batTeamAbbr, score: parsed.score, overs: parsed.overs, abbr: parsed.batTeamAbbr },
      { name: oppAbbr || 'Opponent', score: '', overs: '', abbr: oppAbbr || '', note: 'Yet to bat' },
    ],
    status,
    format: fmt,
  };
  if (target) result.target = target;
  return result;
}

function detectCrexDismissalMode(texts, feeds) {
  // 1. The authoritative getBallFeeds window (oldest → newest): find the
  //    NEWEST ball whose score shows a wicket falling, and read THAT ball's
  //    prose. Crex writes "TOP EDGE … TAKES THE CATCH!", "LBW!", "CLEAN
  //    BOWLED!", "RUN OUT!" there — this is fresh and aligned with the moment
  //    the W enters currentOver, unlike commentaryTexts which can scroll past
  //    the wicket before the lagging lastovers ever surface it.
  if (Array.isArray(feeds) && feeds.length) {
    const balls = feeds.filter(f => f && f.o && f.s);
    for (let i = balls.length - 1; i >= 1; i--) {
      const prevW = parseInt(String(balls[i - 1].s).split('/')[1] || '0', 10);
      const curW = parseInt(String(balls[i].s).split('/')[1] || '0', 10);
      if (curW > prevW) {
        const prose = (balls[i].c2 || balls[i].c1 || '') + ' ' + (balls[i - 1].c2 || balls[i - 1].c1 || '');
        const mode = matchDismissalMode(prose);
        if (mode) return mode;
        break;
      }
    }
  }

  // 2. Fallback: the commentary text window (only the freshest entries — a
  //    wicket's how-out text is among the newest balls, and scanning the whole
  //    window risks a stale match from dropped catches, "off the stump" prose).
  if (!Array.isArray(texts)) return null;
  const recent = texts.slice(0, 4).join(' ');
  return matchDismissalMode(recent);
}

function matchDismissalMode(prose) {
  if (!prose) return null;
  if (/\brun\s*out\b/i.test(prose)) return 'runout';
  if (/\blbw\b|\bplumb\b/i.test(prose)) return 'lbw';
  if (/\bcaught\b|\bcatch\b|\btakes?\s+(?:a\s+|the\s+)?catch\b/i.test(prose)) return 'caught';
  if (/\bbowled\b|\bclean\s*bowled\b|\bcleaned?\s+up\b|\bclean(?:ed)?\s+(?:him|her)\s+up\b/i.test(prose)) return 'bold';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────────────────────────────────────

function tryParse(html, url, title = extractTitle(html || '')) {
  if (url.includes('crex.com')) {
    const api = extractCrexApiData(html, url);
    if (api) return buildFromCrex(api, url, title);
  }
  if (url.includes('cricbuzz.com')) {
    const cb = parseCricbuzz(html, url);
    if (cb && cb.batRow) return buildFromCricbuzz(cb, url);
  }
  if (url.includes('cricketfastliveline.in') || url.includes('cfl.in')) {
    const c = parseCFLL(title, url);
    if (c) return buildFromCFLL(c, url);
  }
  return null;
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

function labelForUrl(url) {
  if (url.includes('crex.com') && url.includes('match-scorecard')) return 'Crex Scorecard';
  if (url.includes('crex.com')) return 'Crex Live';
  if (url.includes('live-cricket-scorecard')) return 'Cricbuzz Scorecard';
  if (url.includes('live-cricket-scores')) return 'Cricbuzz Live';
  if (url.includes('cricketfastliveline')) return 'CFLL';
  return url;
}

function getBackoff() {
  return Math.min(POLL_INTERVAL * Math.pow(2, consecutiveFailures), MAX_BACKOFF);
}

// Source stability: once one URL wins, stick with it so the overlay's
// currentOver / lastBallSeq stay coherent. Without this, a single crex hiccup
// hands the poll to cricbuzz and the very next poll hands it back — each flip
// re-derives a different currentOver array and can re-trigger animations.
let preferredUrl = URLS[0];
let preferredFailures = 0;
const SOURCE_SWITCH_THRESHOLD = 2;

// A held (torn) Crex snapshot must never be broadcast to the overlay.
function _shouldBroadcast(data) {
  return !(data && data._hold);
}

async function poll() {
  // Try every URL in order; use the first one that yields a plausible result.
  // The previously-winning URL is tried first, and only after two consecutive
  // failures does another source take over (hysteresis).
  let data = null;
  let winnerLabel = '';
  let winnerUrl = '';
  const order = [preferredUrl, ...URLS.filter(u => u !== preferredUrl)];

  for (const url of order) {
    const label = labelForUrl(url);
    try {
      const html = await fetchPage(url);
      const title = extractTitle(html);
      const parsed = tryParse(html, url, title);
      if (parsed && parsed.teams && parsed.teams.length >= 2) {
        if (parsed._hold) {
          // Torn Crex snapshot (feed vs top-level score disagree, or a new
          // delivery arrived without player stats). Not a usable winner:
          // skip this source so a healthy fallback gets its turn, and count
          // the hold so a permanently-torn source escalates like a failure.
          consecutiveHolds++;
          if (consecutiveHolds === 1 || consecutiveHolds % 10 === 0) {
            console.warn(`[Poll] ${label}: holding torn snapshot (${consecutiveHolds} consecutive) ${parsed._holdReason ? '- ' + parsed._holdReason : ''}`);
          }
          continue;
        }
        data = parsed;
        winnerLabel = label;
        winnerUrl = url;
        break;
      } else {
        console.log(`[Poll] ${label}: parse returned no data`);
      }
    } catch (err) {
      console.error(`[Poll] ${label}: ${err.message}`);
    }
  }

  if (!data) {
    consecutiveFailures++;
    setTimeout(poll, getBackoff());
    return;
  }

  consecutiveFailures = 0;
  consecutiveHolds = 0;
  sourceLabel = winnerLabel;

  if (winnerUrl === preferredUrl) {
    preferredFailures = 0;
  } else {
    preferredFailures++;
    if (preferredFailures >= SOURCE_SWITCH_THRESHOLD) {
      console.log(`[Poll] Switching preferred source to ${winnerLabel}`);
      preferredUrl = winnerUrl;
      preferredFailures = 0;
    }
  }

  const dataStr = JSON.stringify(data);
  if (!_shouldBroadcast(data)) {
    // A held (torn) snapshot is never broadcast and must not move lastData,
    // so the next coherent snapshot is still delivered to the overlay.
    consecutiveHolds++;
    if (consecutiveHolds === 1 || consecutiveHolds % 10 === 0) {
      console.warn(`[Poll] holding torn snapshot (${consecutiveHolds} consecutive)`);
    }
    setTimeout(poll, getBackoff());
    return;
  }
  if (dataStr !== lastData && ws && ws.readyState === WebSocket.OPEN) {
    lastData = dataStr;
    try {
      ws.send(JSON.stringify({ type: 'score', data, source: winnerLabel, url: winnerUrl }));
    } catch (e) {
      console.error('[WS] Send failed:', e.message);
    }
    const isHun = data.format === 'HUN';
    const info = data.teams.map(t => `${t.name} ${t.score} (${isHun && t.balls != null ? `${t.balls}b` : `${t.overs} ov`})`).join(' vs ');
    const extras = [
      data.status,
      data.rpb ? `RPB ${data.rpb}` : (data.crr ? `CRR ${data.crr}` : ''),
      data.rrr ? `RRR ${data.rrr}` : '',
      data.leadTrail,
      data.target ? `Target ${data.target.current}/${data.target.total} (need ${data.target.need})` : '',
    ].filter(Boolean).join(' | ');
    console.log(`[Poll] ${winnerLabel} | ${info}${extras ? ' | ' + extras : ''}`);
  }

  setTimeout(poll, POLL_INTERVAL);
}

module.exports = {
  _resetCrexPlayers,
  _shouldBroadcast,
  buildFromCFLL,
  buildFromCrex,
  buildFromCricbuzz,
  buildUrlChain,
  cleanStatus,
  crexScoreCoherent,
  currentOverFromCommentary,
  currentOverFromCrexFeeds,
  currentOverFromLastOvers,
  detectCrexDismissalMode,
  detectFormat,
  extractCrexApiData,
  extractTitle,
  getFormatConfig,
  isPlausibleScore,
  matchDismissalMode,
  normalizeBallToken,
  normalizeScore,
  oversToBalls,
  parseBallsField,
  parseBatsmenList,
  parseCFLL,
  parseCrexBallFeeds,
  parseCrexLastOvers,
  parseCricbuzz,
  parseOversString,
  parseScoreString,
  tokenFromCrexBall,
  tryParse,
};

if (require.main === module) {
  connectWS();
  console.log(`\nLive Score Poller (Cricket-Aware)`);
  console.log(`Sources (${URLS.length}):`);
  URLS.forEach((u, i) => console.log(`  [${i}] ${labelForUrl(u)}: ${u}`));
  console.log(`Interval: ${POLL_INTERVAL}ms | Max backoff: ${MAX_BACKOFF}ms\n`);
  poll();
}
