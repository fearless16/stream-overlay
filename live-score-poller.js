require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const WebSocket = require('ws');
const cheerio = require('cheerio');

const WS_URL = process.env.WS_URL || 'ws://localhost:8765';
const POLL_INTERVAL = parseInt(process.env.SCORE_POLL_INTERVAL || process.env.POLL_INTERVAL || '6000', 10);
const MAX_BACKOFF = 60000;
const FETCH_TIMEOUT = 15000;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let ws = null;
let lastData = '';
let consecutiveFailures = 0;
let activeUrlIdx = 0;
let sourceLabel = '';

// Per-URL state. The poller fans out across all configured URLs and
// maintains cricket-aware state for each match separately.
const matchState = {
  lastMatchKey: null,
  innings: {},        // keyed by team-abbr -> {score, overs, declared?}
  batting: null,      // abbr of team currently batting
  lastBallScore: null,// last seen "runs/wkts" string for the batting side
  lastWicketAt: 0,    // runs at the time the previous wicket fell (for fallback)
  history: [],        // rolling buffer of last 5 over-summaries for sanity
  lastStatus: '',
  urlState: {},       // per-URL running state for rotation scoring
};

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
  ws.on('error', () => ws.close());
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
  return null;
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
 * "19.2" overs means 19 completed overs + 2 balls = 116 balls bowled.
 * Used to compute remaining balls in a limited-overs innings.
 */
function oversToBalls(oversStr) {
  if (oversStr == null) return 0;
  const s = String(oversStr).trim();
  const m = s.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return 0;
  const whole = parseInt(m[1], 10);
  const partial = parseInt((m[2] || '0').slice(0, 1), 10); // "19.2" = 2 balls, never 20
  if (isNaN(whole) || isNaN(partial)) return 0;
  return whole * 6 + partial;
}

function maxBallsForFormat(fmt) {
  if (fmt === 'T20') return 120;
  if (fmt === 'ODI') return 300;
  return Infinity; // Test – no over limit
}

function maxWicketsForInnings(fmt) {
  // In a Test, 10 wickets per innings (1st/2nd/3rd/4th).
  // Limited overs, also 10.
  return 10;
}

/**
 * Parse a score like "61/6" or "140-10" into {runs, wkts, allOut}.
 */
function parseScoreString(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,4})\s*[\/\-]\s*(\d{1,2})$/);
  if (!m) return null;
  const runs = parseInt(m[1], 10);
  const wkts = parseInt(m[2], 10);
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
  if (s.wkts > maxWicketsForInnings(fmt)) return false;
  if (s.runs < 0) return false;
  if (s.runs === 0 && s.wkts > 0) return false;

  const o = parseOversString(overs);
  if (o.overs < 0 || o.balls < 0 || o.balls > 5) return false;

  if (o.overs > 0 || o.balls > 0) {
    const balls = o.overs * 6 + o.balls;
    if (balls > 0) {
      const rpo = (s.runs / balls) * 6;
      const maxRpo = fmt === 'T20' ? 30 : fmt === 'ODI' ? 22 : 14;
      if (rpo > maxRpo) return false;
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

  const out = {
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
  // {over, overinfo, total} objects serialized as JSON.
  const lastOversMatch = raw.match(/&q;lastovers&q;:\[([\s\S]*?)\],&q;/);
  if (lastOversMatch) {
    out.lastoversRaw = lastOversMatch[1];
  }

  // If we couldn't pull the core identifiers, this isn't a valid payload.
  if (!out.team1 || !out.team2) return null;

  return out;
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
    const overMatch = obj.match(/&q;over&q;:&q;Over\s+(\d+)&q;/i);
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
  if (t === 'wd' || t === 'wide') return 'wd';
  if (t === 'nb' || t === 'no ball' || t === 'noball') return 'nb';
  return t;
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
    const key = `${row.name}|${row.runs}|${row.wkts || ''}|${row.overs || ''}`;
    if (!teamRows.find(r => r.key === key)) teamRows.push({ key, ...row });
  };

  // 1. Status text — e.g. "Day 1: Stumps - New Zealand trail by 79 runs"
  //    or "England need 150 runs in 93 balls".
  //    The status lives in `.text-cbLive` (live) or `.text-cbTxtLive` (other).
  let status = '';
  $('div').each((_, el) => {
    const t = $(el).text().trim();
    if (!t || t.length > 200) return;
    // "Day N: Session - …" or "won by N runs/wkts"
    if (/^(Day\s+\d+[: ]|.*\bwon by\b|.*\bneed\b.*\bruns?\b.*\bballs?\b|.*\bInnings Break\b|.*\bLunch\b|.*\bTea\b|.*\bStumps\b|.*\bDrawn\b|.*\bTied\b|.*\bMatch ends\b)/i.test(t)) {
      if (!status || t.length < status.length) status = t;
    }
  });
  status = status.split('\n')[0].trim().replace(/\s+/g, ' ');
  // Trim very long statuses
  if (status.length > 180) status = status.substring(0, 180).trim();

  // 2. Score lines. Cricbuzz renders each team as a row with class names.
  //    We grab ALL "NNN/W" patterns and then pair them with team names.
  const scoreRegex = /\b([A-Z]{2,4}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b\s*[:\-]?\s*(\d{1,4})\s*(?:\/\s*(\d{1,2})|-(\d{1,2}))?\s*(?:\(\s*(\d+(?:\.\d+)?)\s*\))?/g;
  // That's too greedy. Simpler: walk the miniscore block.
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

  if (teamRows.length < 2) {
    const inningsRe = /(?:batTeamName|teamName)\\":\\"([A-Z]{2,4})\\",\\"score\\":(\d+),\\"wickets\\":(\d+),\\"overs\\":([\d.]+)/g;
    let m;
    while ((m = inningsRe.exec(html)) !== null) {
      addTeamRow({
        name: m[1],
        runs: m[2],
        wkts: m[3],
        overs: m[4],
      });
      if (teamRows.length >= 2) break;
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

  // 3. Batsmen
  //    Look for grid rows with name + R + B + 4s + 6s + SR columns.
  const batsmen = [];
  $('.scorecard-bat-grid').each((_, el) => {
    if (batsmen.length >= 2) return;
    const cells = $(el).children();
    if (cells.length < 3) return;
    const nameCell = $(cells[0]).text().replace(/\s+/g, ' ').trim();
    // Strip " * " (striker marker) and trailing role
    const name = nameCell.replace(/\s*\*\s*$/, '').replace(/\s*\((?:c|wk|†|&amp;c|&amp;wk)\)\s*$/i, '').trim();
    if (!name) return;
    const runs = $(cells[1]).text().trim();
    const balls = $(cells[2]).text().trim();
    if (!/^\d+$/.test(runs) || !/^\d+$/.test(balls)) return;
    const isStriker = nameCell.includes('*');
    batsmen.push({ name, runs, balls, striker: isStriker });
  });

  // 4. Bowler — first row of bowler-grid in the live page
  let bowler = null;
  // The bowler live widget renders "Bowler Name  ECO X.YY  W/R (Ovs)" inline
  // or in a separate row. Look for the labelled "Bowler" or recent "this over".
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

  // 5. CRR / RRR — usually small labels next to the score
  let crr = '';
  let rrr = '';
  $('span').each((_, el) => {
    const t = $(el).text().trim();
    if (t === 'CRR:') {
      const next = $(el).next().text().trim();
      if (next) crr = next;
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

  return {
    source: 'cricbuzz',
    batRow,
    teamRows,
    batsmen,
    bowler,
    status,
    crr,
    rrr,
    partnership,
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
  // Reject anything that names a team that isn't either of our two
  // participating teams, unless it's a generic "X won by Y".
  // First pass: shorten "Day N: Stumps - X trail/lead by Y runs" → "Day N: Stumps"
  let s = raw.replace(/\s+[—-]\s+[A-Z][\w\s]+?\s+(trail|lead)s?\s+by\s+\d+\s+runs?\s*$/i, '').trim();
  // Also strip "X won by N runs/wkts" appendages if they don't match our teams
  s = s.replace(/\s+[A-Z][\w\s]+?\s+won\s+by\s+\d+\s+(runs?|wkts?|wickets?)\s*$/i, '').trim();
  return s;
}

/**
 * Compute a lead/trail phrase from two innings lines.
 *   battingRuns  = 61,  firstInningsRuns = 140 → "trail by 79"
 *   firstInningsRuns = 250,  battingRuns = 280 → "lead by 30"
 * Only used in Tests (limited-overs have explicit "need N runs" status).
 */
function leadOrTrail(battingRuns, firstInningsRuns) {
  const diff = battingRuns - firstInningsRuns;
  if (diff === 0) return 'level';
  if (diff > 0) return `lead by ${diff}`;
  return `trail by ${-diff}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-source data-builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Take a Crex-API dump and build the final scorecard payload.
 */
function buildFromCrex(api, url) {
  const fmt = detectFormat(url) || 'Test';
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
      matchState.innings = {};
      matchState.history = [];
    }
  }
  matchState.lastMatchKey = matchKey;

  // Update innings ledger
  matchState.innings[batAbbr] = { score: batScore, overs: batOvers, full: batFull };
  matchState.innings[oppAbbr] = { score: oppScore, overs: oppOvers, full: oppFull };

  const batTeam = { name: batFull, score: batScore, overs: batOvers, abbr: batAbbr };
  const oppTeam = { name: oppFull, score: oppScore, overs: oppOvers, abbr: oppAbbr };
  if (!oppScore) oppTeam.note = 'Yet to bat';

  // Batsmen
  const batsmen = [];
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
  }

  // Current over (this over) – prefer the explicit lastovers array
  let currentOver = [];
  const lastOvers = parseCrexLastOvers(api.lastoversRaw);
  currentOver = currentOverFromLastOvers(lastOvers, batOvers) || [];

  // Status — prefer the rich comment1 ("NZ trail by 79 runs") but trim the
  // session/lead/trail suffix into a separate "leadTrail" field.
  let leadTrail = '';
  let status = api.comment1 || '';
  if (status) {
    const m = status.match(/·?([A-Z][\w\s]+?)\s+(trail|lead)s?\s+by\s+(\d+)\s+runs?/i);
    if (m) {
      leadTrail = `${m[1].trim()} ${m[2].toLowerCase()} by ${m[3]} runs`;
      status = cleanStatus(status, batAbbr, oppAbbr);
    }
  }
  if (api.B && api.B !== '--') {
    status = `${api.day ? 'Day ' + api.day + ': ' : ''}${api.B}`;
  }

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
    if (fmt !== 'Test') {
      const ballsBowled = oversToBalls(batOvers);
      const remaining = maxBallsForFormat(fmt) - ballsBowled;
      target.balls = String(Math.max(0, remaining));
    }
  }

  // Result construction
  const result = {
    teams: [batTeam, oppTeam],
    batsmen: batsmen.slice(0, 2),
    status: status || '',
  };
  if (bowler) result.bowler = bowler;
  if (api.crr && api.crr !== '--') result.crr = api.crr;
  if (api.rrr && api.rrr !== '--') result.rrr = api.rrr;
  if (api.partnerruns) result.partnership = `${api.partnerruns}${api.partnerballs ? ' (' + api.partnerballs + ')' : ''}`;
  if (api.lwname1) result.lastWicket = `${api.lwname1} ${api.lwrun1 || 0}${api.lwball1 ? ' (' + String(api.lwball1).replace(/[()]/g, '') + ')' : ''}`;
  if (leadTrail) result.leadTrail = leadTrail;
  if (currentOver.length > 0) result.currentOver = currentOver;
  if (target) result.target = target;
  if (fmt) result.format = fmt;
  if (api.day) result.day = api.day;
  if (api.session && api.session !== '--') result.session = api.session;
  if (api.session2 && api.session2 !== '--') result.session2 = api.session2;
  return result;
}

/**
 * Take a Cricbuzz parse and build the final payload.
 */
function buildFromCricbuzz(parsed, url) {
  if (!parsed) return null;
  const fmt = detectFormat(url);

  // Use the teamRows to figure out the batting side and the other side.
  // The teamRows in cricbuzz are in the order they appear on the page
  // (bowled-out team first, then batting team, in 2nd-innings layout).
  // We have already picked batRow; pair it with the other row.
  const bat = parsed.batRow;
  const other = parsed.teamRows.find(r => r.key !== bat.key);
  if (!bat) return null;

  const batAbbr = bat.name;
  const batScore = formatScore(bat.runs, bat.wkts, { assumeNoWicket: true });
  const batOvers = bat.overs || '0.0';
  const batName = (() => {
    // If we have a longer name from elsewhere, use that; otherwise abbr
    return batAbbr;
  })();
  const oppAbbr = other?.name || '';
  const oppScore = other ? formatScore(other.runs, other.wkts, { completed: other.key !== bat.key }) : '';
  const oppOvers = oppScore ? (other?.overs || '0.0') : '';

  if (!isPlausibleScore(bat.wkts ? batScore : `${batScore}/0`, batOvers, fmt || 'ODI')) return null;

  const matchKey = `${batAbbr}-${oppAbbr}`;
  if (matchState.lastMatchKey && matchState.lastMatchKey !== matchKey && !matchState.lastMatchKey.startsWith(`${oppAbbr}-${batAbbr}`)) {
    console.log(`[Poll] Cricbuzz: new match detected (${matchState.lastMatchKey} → ${matchKey})`);
    matchState.innings = {};
    matchState.history = [];
  }
  matchState.lastMatchKey = matchKey;

  matchState.innings[batAbbr] = { score: batScore, overs: batOvers };
  if (oppAbbr) matchState.innings[oppAbbr] = { score: oppScore, overs: oppOvers };

  const result = {
    teams: [
      { name: batName, score: batScore, overs: batOvers, abbr: batAbbr },
      { name: oppAbbr || 'Opponent', score: oppScore, overs: oppOvers, abbr: oppAbbr || '', note: oppScore ? '' : 'Yet to bat' },
    ],
    batsmen: (parsed.batsmen || []).slice(0, 2),
    status: cleanStatus(parsed.status, batAbbr, oppAbbr),
  };
  if (parsed.bowler) result.bowler = parsed.bowler;
  if (parsed.crr) result.crr = parsed.crr;
  if (parsed.rrr) result.rrr = parsed.rrr;
  if (parsed.partnership) result.partnership = parsed.partnership;

  if (fmt) result.format = fmt;

  const leadM = (parsed.status || '').match(/([A-Z][A-Za-z\s]+|[A-Z]{2,4})\s+(trail|lead)s?\s+by\s+(\d+)\s+runs?/i);
  if (leadM) result.leadTrail = `${leadM[1].trim()} ${leadM[2].toLowerCase()} by ${leadM[3]} runs`;

  // Try to build a target from the status text ("X need N runs in M balls")
  if (parsed.status) {
    const needM = parsed.status.match(/need\s+(\d+)\s+runs?\s+in\s+(\d+)\s+balls/i);
    if (needM) {
      const batting = parseScoreString(batScore);
      const total = (batting?.runs || 0) + parseInt(needM[1], 10);
      result.target = {
        current: String(batting?.runs || 0),
        total: String(total),
        need: needM[1],
        balls: needM[2],
      };
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

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────────────────────────────────────

function tryParse(html, url, title = extractTitle(html || '')) {
  if (url.includes('crex.com')) {
    const api = extractCrexApiData(html, url);
    if (api) return buildFromCrex(api, url);
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

async function poll() {
  // Try every URL in order; use the first one that yields a plausible result.
  let data = null;
  let winnerLabel = '';
  let winnerUrl = '';

  for (let i = 0; i < URLS.length; i++) {
    const url = URLS[i];
    const label = labelForUrl(url);
    try {
      const html = await fetchPage(url);
      const title = extractTitle(html);
      const parsed = tryParse(html, url, title);
      if (parsed && parsed.teams && parsed.teams.length >= 2) {
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
  sourceLabel = winnerLabel;

  const dataStr = JSON.stringify(data);
  if (dataStr !== lastData && ws && ws.readyState === WebSocket.OPEN) {
    lastData = dataStr;
    try {
      ws.send(JSON.stringify({ type: 'score', data, source: winnerLabel, url: winnerUrl }));
    } catch (e) {
      console.error('[WS] Send failed:', e.message);
    }
    const info = data.teams.map(t => `${t.name} ${t.score} (${t.overs} ov)`).join(' vs ');
    const extras = [
      data.status,
      data.crr ? `CRR ${data.crr}` : '',
      data.rrr ? `RRR ${data.rrr}` : '',
      data.leadTrail,
      data.target ? `Target ${data.target.current}/${data.target.total} (need ${data.target.need})` : '',
    ].filter(Boolean).join(' | ');
    console.log(`[Poll] ${winnerLabel} | ${info}${extras ? ' | ' + extras : ''}`);
  }

  setTimeout(poll, POLL_INTERVAL);
}

module.exports = {
  buildFromCFLL,
  buildFromCrex,
  buildFromCricbuzz,
  buildUrlChain,
  cleanStatus,
  currentOverFromLastOvers,
  detectFormat,
  extractCrexApiData,
  extractTitle,
  isPlausibleScore,
  normalizeBallToken,
  normalizeScore,
  parseBatsmenList,
  parseCFLL,
  parseCrexLastOvers,
  parseCricbuzz,
  parseOversString,
  parseScoreString,
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
