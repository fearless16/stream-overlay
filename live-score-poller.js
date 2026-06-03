require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const WebSocket = require('ws');

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
let matchState = { innings: {}, lastMatchKey: null };

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
connectWS();

async function fetchPage(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
    redirect: 'follow',
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.text();
}

function extractMetaContent(html, attr, value) {
  const patterns = [
    new RegExp(`<meta\\s+[^>]*${attr}="${value}"[^>]*content="([^"]+)"`, 'i'),
    new RegExp(`<meta\\s+[^>]*content="([^"]+)"[^>]*${attr}="${value}"`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1].replace(/\s+/g, ' ').trim();
  }
  return null;
}

function extractOgTitle(html) {
  return extractMetaContent(html, 'property', 'og:title');
}

function extractDescription(html) {
  return extractMetaContent(html, 'name', 'description');
}

function normalizeScore(score) {
  return score.replace(/-/g, '/');
}

function parseOverBalls(raw) {
  if (!raw) return [];
  return raw.split(/[,\s]+/).filter(Boolean).map(b => {
    const t = b.trim().toLowerCase();
    if (t === 'w' || t === 'wicket') return 'W';
    if (t === 'wd' || t === 'wide') return 'wd';
    if (t === 'nb' || t === 'noball') return 'nb';
    if (t === '0' || t === '.' || t === 'dot') return '·';
    if (/^[1-6]$/.test(t)) return t;
    return t;
  });
}

function detectFormat(url, title) {
  const s = ((url || '') + ' ' + (title || '')).toLowerCase();
  if (/\bt20\b|twenty20|t-?20/.test(s)) return 'T20';
  if (/\bodi\b|one[- ]?day|50[- ]?over/.test(s)) return 'ODI';
  if (/\btest\b/.test(s)) return 'Test';
  return null;
}

function parseBatsmen(raw) {
  const batsmen = [];
  const batRe = /([A-Z][a-z]+(?:\s+(?:[a-z]+\s+)*[A-Z][a-z]+)*|[A-Z]{2,}(?:\s+(?:[a-z]+\s+)*[A-Z][a-z]+)*)\s*(\d{1,3})\((\d{1,3})\)/g;
  let m;
  while ((m = batRe.exec(raw)) !== null) {
    batsmen.push({ name: m[1].trim(), runs: m[2], balls: m[3] });
  }
  return batsmen;
}

function parseCrex(title, url) {
  const cleaned = title.replace(/\s*-\s*CREX\s*$/i, '').trim();

  const vsIdx = cleaned.indexOf(' vs ');
  if (vsIdx < 0) return null;

  const left = cleaned.substring(0, vsIdx).trim();
  const right = cleaned.substring(vsIdx + 4).trim();

  const leftM = left.match(/^(.+?)\s+(\d+[-/]\d+)\s+\(([\d.]+)\)\s*\((.+)\)$/);
  if (!leftM) return null;

  const batTeamAbbr = leftM[1].trim();
  const score = normalizeScore(leftM[2]);
  const overs = leftM[3];
  const batsmenRaw = leftM[4];

  const oppMatch = right.match(/^(.+?)\s+\d+[-.]?(?:st|nd|rd|th)/i);
  const oppName = oppMatch ? oppMatch[1].trim() : right.split('|')[0].trim();

  const batsmen = parseBatsmen(batsmenRaw);

  return { batTeamAbbr, score, overs, batsmen, oppName, format: detectFormat(url, title), source: 'crex' };
}

function parseCricbuzz(title, url) {
  if (title.startsWith('Cricket scorecard')) return null;

  const pipeIdx = title.indexOf(' | ');
  if (pipeIdx < 0) return null;

  const left = title.substring(0, pipeIdx).trim();
  const right = title.substring(pipeIdx + 3).trim();

  const leftM = left.match(/^(.+?)\s+(\d+[-/]\d+)\s+\(([\d.]+)\)\s*\((.+)\)$/);
  if (!leftM) return null;

  const batTeamAbbr = leftM[1].trim();
  const score = normalizeScore(leftM[2]);
  const overs = leftM[3];
  const batsmenRaw = leftM[4];

  const vsMatch = right.match(/^(.+?)\s+vs\s+(.+?),/);
  let oppName = '';
  if (vsMatch) {
    const team1 = vsMatch[1].trim();
    const team2 = vsMatch[2].trim();
    oppName = team1 === batTeamAbbr ? team2 : team1;
  }

  const batsmen = parseBatsmen(batsmenRaw);

  return { batTeamAbbr, score, overs, batsmen, oppName, format: detectFormat(url, title), source: 'cricbuzz' };
}

function parseCricbuzzDescription(desc, url) {
  if (!desc) return null;
  const m = desc.match(/^Follow\s+(.+?)\s+\|\s+/);
  if (!m) return null;
  const scorePart = m[1];
  const scoreM = scorePart.match(/^(.+?)\s+(\d+[-/]\d+)\s+\(([\d.]+)\)\s*\((.+)\)$/);
  if (!scoreM) return null;
  return {
    batTeamAbbr: scoreM[1].trim(),
    score: normalizeScore(scoreM[2]),
    overs: scoreM[3],
    batsmen: parseBatsmen(scoreM[4]),
    oppName: '',
    format: detectFormat(url, desc),
    source: 'cricbuzz-desc',
  };
}

function extractStatusFromHtml(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  const needM = text.match(/need\s+(\d+)\s+runs?\s+in\s+(\d+)\s+balls/i);
  if (needM) return `Need ${needM[1]} runs in ${needM[2]} balls`;

  const winM = text.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(won|win)\s+by\s+(\d+)\s+(runs?|wickets?|wkts?)/i);
  if (winM) return `${winM[1]} won by ${winM[3]} ${winM[4]}`;

  const winSimple = text.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(won|win)\b/i);
  if (winSimple) return `${winSimple[1]} won`;

  const breakM = text.match(/(Drinks Break|Innings Break|Lunch|Tea|Rain|Stumps)/i);
  if (breakM) return breakM[1];

  return '';
}

function extractCrexApiData(html, url) {
  if (!html.includes('api.goscorer.com/api/v3/getSV3')) return null;

  const sv3Idx = html.indexOf('getSV3');
  if (sv3Idx < 0) return null;
  const raw = html.substring(sv3Idx, sv3Idx + 10000);

  const get = (key) => {
    const reQuoted = new RegExp(`&q;${key}&q;:&q;([^&]*)&q;`, 'i');
    const m1 = raw.match(reQuoted);
    if (m1) return m1[1].replace(/&a;/g, '&');
    const reRaw = new RegExp(`&q;${key}&q;:([^,&}]+)`, 'i');
    const m2 = raw.match(reRaw);
    return m2 ? m2[1].replace(/&a;/g, '&') : null;
  };

  const score1 = get('score1');
  const over1 = get('over1');
  const team1 = get('team1');
  const team2 = get('team2');
  const team1Full = get('team1_f_n');
  const team2Full = get('team2_f_n');
  const pname1 = get('player_full_name1');
  const pname2 = get('player_full_name2');
  const run1 = get('run1');
  const ball1 = get('ball1');
  const run2 = get('run2');
  const ball2 = get('ball2');
  const bname = get('bname');
  const bowlerFull = get('bowler_full_name');
  const bwr = get('bwr');
  const bover = get('bover');
  const crr = get('crr');
  const rrr = get('rrr');
  const comment1 = get('comment1');
  const partnerruns = get('partnerruns');
  const partnerballs = get('partnerballs');
  const lwname1 = get('lwname1');
  const lwrun1 = get('lwrun1');
  const lwball1 = get('lwball1');
  const strikker1 = get('strikker1');
  const strikker2 = get('strikker2');
  const thisOver = get('this_over') || get('over_balls') || get('balls');
  const targetRuns = get('target');

  if (!score1 || !team1) return null;

  return {
    batTeamAbbr: team1,
    batTeamFull: team1Full,
    oppTeamAbbr: team2,
    oppTeamFull: team2Full,
    score: normalizeScore(score1),
    overs: over1 || '0.0',
    batsmen: [
      pname1 ? { name: pname1.replace(/\*/g, '').trim(), runs: run1 || '0', balls: (ball1 || '(0)').replace(/[()]/g, ''), striker: strikker1 === '1' || strikker1 === 'true' || /[*]/.test(pname1) } : null,
      pname2 ? { name: pname2.replace(/\*/g, '').trim(), runs: run2 || '0', balls: (ball2 || '(0)').replace(/[()]/g, ''), striker: strikker2 === '1' || strikker2 === 'true' || /[*]/.test(pname2) } : null,
    ].filter(Boolean),
    bowler: bname ? { name: bowlerFull || bname, wickets: (bwr || '0-0').split('-')[0], runs: (bwr || '0-0').split('-')[1], overs: bover || '0.0' } : null,
    crr: crr || '',
    rrr: (rrr && rrr !== '--') ? rrr : '',
    partnership: partnerruns ? `${partnerruns} (${partnerballs || '?'})` : '',
    lastWicket: lwname1 ? `${lwname1} ${lwrun1 || '0'} (${(lwball1 || '0').replace(/[()]/g, '')})` : '',
    status: comment1 || '',
    currentOver: parseOverBalls(thisOver),
    target: targetRuns ? { total: targetRuns } : null,
    format: detectFormat(url),
    source: 'crex-api',
  };
}

function buildScoreData(parsed, html) {
  if (!parsed) return null;

  if (parsed.source === 'crex-api') {
    const matchKey = `${parsed.batTeamAbbr}-${parsed.oppTeamAbbr}`;
    if (matchState.lastMatchKey && matchState.lastMatchKey !== matchKey) {
      console.log(`[Poll] New match detected: ${matchKey}, resetting state`);
      matchState.innings = {};
    }
    matchState.lastMatchKey = matchKey;

    const batTeam = { name: parsed.batTeamAbbr, score: parsed.score, overs: parsed.overs };
    const oppScore = matchState.innings[parsed.oppTeamAbbr] || { score: '0/0', overs: '0.0' };
    const oppTeam = { name: parsed.oppTeamAbbr, score: oppScore.score, overs: oppScore.overs };

    matchState.innings[parsed.batTeamAbbr] = { score: parsed.score, overs: parsed.overs };

    const teams = [batTeam, oppTeam];

    const result = {
      teams,
      batsmen: parsed.batsmen.slice(0, 2),
      status: parsed.status,
    };

    if (parsed.bowler) result.bowler = parsed.bowler;
    if (parsed.crr) result.crr = parsed.crr;
    if (parsed.rrr) result.rrr = parsed.rrr;
    if (parsed.partnership) result.partnership = parsed.partnership;
    if (parsed.lastWicket) result.lastWicket = parsed.lastWicket;
    if (parsed.format) result.format = parsed.format;
    if (parsed.currentOver && parsed.currentOver.length > 0) result.currentOver = parsed.currentOver;
    if (parsed.target) {
      const tgt = { ...parsed.target };
      if (!tgt.current && parsed.score) {
        const runs = parseInt((parsed.score.split('/')[0] || '0').trim());
        if (!isNaN(runs)) tgt.current = String(runs);
      }
      if (tgt.total && tgt.current) {
        tgt.need = String(Math.max(0, parseInt(tgt.total) - parseInt(tgt.current) + 1));
      }
      if (!tgt.balls && parsed.overs) {
        const parts = parsed.overs.split('.');
        const completedOvers = parseInt(parts[0] || '0');
        const extraBalls = parseInt(parts[1] || '0');
        const totalBalls = completedOvers * 6 + extraBalls;
        const maxBalls = parsed.format === 'T20' ? 120 : parsed.format === 'ODI' ? 300 : 300;
        tgt.balls = String(Math.max(0, maxBalls - totalBalls));
      }
      result.target = tgt;
    } else if (matchState.innings[parsed.oppTeamAbbr] && matchState.innings[parsed.oppTeamAbbr].score !== '0/0') {
      const oppFirstInnings = matchState.innings[parsed.oppTeamAbbr];
      const oppRuns = parseInt((oppFirstInnings.score.split('/')[0] || '0').trim());
      const currentRuns = parseInt((parsed.score.split('/')[0] || '0').trim());
      if (!isNaN(oppRuns) && oppRuns > 0) {
        const tgtTotal = String(oppRuns + 1);
        const tgtCurrent = String(currentRuns);
        const parts = parsed.overs.split('.');
        const completedOvers = parseInt(parts[0] || '0');
        const extraBalls = parseInt(parts[1] || '0');
        const totalBalls = completedOvers * 6 + extraBalls;
        const maxBalls = parsed.format === 'T20' ? 120 : parsed.format === 'ODI' ? 300 : 300;
        result.target = {
          current: tgtCurrent,
          total: tgtTotal,
          need: String(Math.max(0, oppRuns + 1 - currentRuns)),
          balls: String(Math.max(0, maxBalls - totalBalls)),
        };
      }
    }

    return result;
  }

  const { batTeamAbbr, score, overs, batsmen, oppName } = parsed;

  const matchKey = `${batTeamAbbr}-${oppName}`;
  if (matchState.lastMatchKey && matchState.lastMatchKey !== matchKey && matchState.lastMatchKey !== `${oppName}-${batTeamAbbr}`) {
    console.log(`[Poll] New match detected: ${matchKey}, resetting state`);
    matchState.innings = {};
  }
  matchState.lastMatchKey = matchKey;

  matchState.lastBattingTeam = batTeamAbbr;
  matchState.innings[batTeamAbbr] = { score, overs };

  const batTeam = { name: batTeamAbbr, score, overs };
  const oppScore = matchState.innings[oppName] || { score: '0/0', overs: '0.0' };
  const oppTeam = { name: oppName, score: oppScore.score, overs: oppScore.overs };

  const isBattingFirst = !matchState.innings[oppName];
  const teams = isBattingFirst ? [batTeam, oppTeam] : [oppTeam, batTeam];

  const status = extractStatusFromHtml(html);

  const result = {
    teams,
    batsmen: batsmen.slice(0, 2),
    status,
  };
  if (parsed.format) result.format = parsed.format;
  if (parsed.currentOver && parsed.currentOver.length > 0) result.currentOver = parsed.currentOver;
  if (parsed.target) result.target = parsed.target;
  return result;
}

function tryParse(html, url) {
  if (url.includes('crex.com')) {
    const apiResult = extractCrexApiData(html, url);
    if (apiResult) return apiResult;
  }

  const title = extractOgTitle(html);
  if (title) {
    if (url.includes('crex.com')) {
      const result = parseCrex(title, url);
      if (result) return result;
    }

    if (url.includes('cricbuzz.com')) {
      const result = parseCricbuzz(title, url);
      if (result) return result;
    }

    const crexResult = parseCrex(title, url);
    if (crexResult) return crexResult;

    const cbResult = parseCricbuzz(title, url);
    if (cbResult) return cbResult;
  }

  if (url.includes('cricbuzz.com')) {
    const desc = extractDescription(html);
    const descResult = parseCricbuzzDescription(desc, url);
    if (descResult) return descResult;
  }

  return null;
}

function labelForUrl(url) {
  if (url.includes('crex.com') && url.includes('match-scorecard')) return 'Crex Scorecard';
  if (url.includes('crex.com')) return 'Crex Match';
  if (url.includes('live-cricket-scorecard')) return 'Cricbuzz Scorecard';
  if (url.includes('live-cricket-scores')) return 'Cricbuzz Live';
  return url;
}

function getBackoff() {
  return Math.min(POLL_INTERVAL * Math.pow(2, consecutiveFailures), MAX_BACKOFF);
}

async function poll() {
  const url = URLS[activeUrlIdx % URLS.length];
  const label = labelForUrl(url);

  try {
    const html = await fetchPage(url);
    const parsed = tryParse(html, url);

    if (!parsed || !parsed.batTeamAbbr) {
      consecutiveFailures++;
      const nextIdx = (activeUrlIdx + 1) % URLS.length;
      if (consecutiveFailures >= 3 && nextIdx !== activeUrlIdx) {
        console.log(`[Poll] ${label}: parse failed (${consecutiveFailures}x), rotating to ${labelForUrl(URLS[nextIdx])}`);
        activeUrlIdx = nextIdx;
      } else {
        console.log(`[Poll] ${label}: could not parse score (attempt ${consecutiveFailures})`);
      }
      setTimeout(poll, getBackoff());
      return;
    }

    const data = buildScoreData(parsed, html);
    if (!data || !data.teams || data.teams.length < 2) {
      consecutiveFailures++;
      console.log(`[Poll] ${label}: score build failed`);
      setTimeout(poll, getBackoff());
      return;
    }

    consecutiveFailures = 0;
    sourceLabel = label;

    const dataStr = JSON.stringify(data);
    if (dataStr !== lastData && ws && ws.readyState === WebSocket.OPEN) {
      lastData = dataStr;
      try {
        ws.send(JSON.stringify({ type: 'score', data }));
      } catch (e) {
        console.error('[WS] Send failed:', e.message);
      }
      const info = data.teams.map(t => `${t.name} ${t.score} (${t.overs})`).join(' vs ');
      console.log(`[Poll] ${label} | ${info} ${data.status ? '| ' + data.status : ''}`);
    }
  } catch (err) {
    consecutiveFailures++;
    const nextIdx = (activeUrlIdx + 1) % URLS.length;
    if (consecutiveFailures >= 2 && nextIdx !== activeUrlIdx) {
      console.log(`[Poll] ${label}: ${err.message} — rotating to ${labelForUrl(URLS[nextIdx])}`);
      activeUrlIdx = nextIdx;
    } else {
      console.error(`[Poll] ${label}: ${err.message}`);
    }
  }

  setTimeout(poll, consecutiveFailures > 0 ? getBackoff() : POLL_INTERVAL);
}

console.log(`\nLive Score Poller (Resilient)`);
console.log(`Sources (${URLS.length}):`);
URLS.forEach((u, i) => console.log(`  [${i}] ${labelForUrl(u)}: ${u}`));
console.log(`Interval: ${POLL_INTERVAL}ms | Max backoff: ${MAX_BACKOFF}ms\n`);
poll();
