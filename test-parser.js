const assert = require('assert');
const fs = require('fs');
const path = require('path');
const poller = require('./live-score-poller.js');

const URL = 'https://www.cricbuzz.com/live-cricket-scores/144794/msg-vs-tre-14th-match-the-hundred-mens-competition-2026';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS:', name); }
  catch (e) { failed++; console.log('FAIL:', name, '-', e.message); }
}

test('parseCricbuzz extracts lastWicket from embedded JSON', () => {
  const html = fs.readFileSync(path.join(__dirname, '_cb-live.html'), 'utf8');
  const parsed = poller.parseCricbuzz(html, URL);
  assert.ok(parsed.lastWicket, 'lastWicket should be present');
  assert.match(parsed.lastWicket, /Heinrich Klaasen/, 'should name the dismissed batsman');
  assert.match(parsed.lastWicket, /Craig Overton/, 'should name the bowler');
  assert.match(parsed.lastWicket, /56\/3/, 'should include the score at the fall');
});

test('buildFromCricbuzz passes lastWicket through', () => {
  const html = fs.readFileSync(path.join(__dirname, '_cb-live.html'), 'utf8');
  const parsed = poller.parseCricbuzz(html, URL);
  const built = poller.buildFromCricbuzz(parsed, URL);
  assert.strictEqual(built.lastWicket, parsed.lastWicket);
  assert.match(built.lastWicket, /Heinrich Klaasen/);
});

test('parseCricbuzz lastWicket is empty when no wicket has fallen', () => {
  const html = fs.readFileSync(path.join(__dirname, '_cb-live.html'), 'utf8');
  const parsed = poller.parseCricbuzz(html, URL);
  // Simulate: strip the lastWicket from the page
  const noWkt = html
    .replace(/\\"lastWicket\\":\\"[^\\"]*\\"/, '\\"lastWicket\\":\\"\\"')
    .replace(/Last Wkt:\s*<\/span>[^<]*(<[^<]*>)?[^<]*/i, 'Last Wkt: </span>');
  const parsed2 = poller.parseCricbuzz(noWkt, URL);
  assert.ok(!parsed2.lastWicket, 'lastWicket should be falsy');
});

test('parseCricbuzz extracts this-over balls (currentOver)', () => {
  const html = fs.readFileSync(path.join(__dirname, '_cb-live.html'), 'utf8');
  const parsed = poller.parseCricbuzz(html, URL);
  assert.ok(Array.isArray(parsed.currentOver), 'currentOver must be an array (possibly empty)');
});

test('detectFormat identifies The Hundred as HUN', () => {
  assert.strictEqual(poller.detectFormat(URL), 'HUN');
});

test('parseCricbuzz currentOver balls are all valid tokens', () => {
  const html = fs.readFileSync(path.join(__dirname, '_cb-live.html'), 'utf8');
  const parsed = poller.parseCricbuzz(html, URL);
  const over = parsed.currentOver || [];
  const valid = new Set(['·', 'W', 'w', '4', '6', 'wd', 'nb', 'lb', 'by', '0', '1', '2', '3', '5', '7']);
  for (const b of over) assert.ok(valid.has(b), `unexpected token ${JSON.stringify(b)}`);
});

test('buildFromCricbuzz passes currentOver + HUN format', () => {
  const html = fs.readFileSync(path.join(__dirname, '_cb-live.html'), 'utf8');
  const parsed = poller.parseCricbuzz(html, URL);
  const built = poller.buildFromCricbuzz(parsed, URL);
  assert.strictEqual(built.format, 'HUN');
  assert.deepStrictEqual(built.currentOver, parsed.currentOver);
});

test('HUN balls-per-over math is 5 (not 6)', () => {
  // Ball numbers are 1-indexed (ball 1 = first ball). 43rd ball belongs to
  // over index 8 (balls 41-45); ball 40 is the previous over's last ball and
  // must NOT leak into the current over.
  const { currentOverFromCommentary } = poller;
  assert.ok(currentOverFromCommentary, 'currentOverFromCommentary helper should be exported');
  const over = currentOverFromCommentary({ ballNbr: 43, format: 'HUN', rows: [
    { num: '43', marker: 'W', text: 'out' },
    { num: '42', marker: '', text: 'no run' },
    { num: '41', marker: '', text: '1 run' },
    { num: '40', marker: '', text: 'SIX' },
    { num: '39', marker: '', text: 'no run' },
  ]});
  assert.deepStrictEqual(over, ['1', '·', 'W']);
});

test('normal formats use 6-ball overs for currentOver buckets', () => {
  const { currentOverFromCommentary } = poller;
  // 18th ball (1-indexed) ends over 3 (balls 13-18), so all 6 balls show.
  const over = currentOverFromCommentary({ ballNbr: 18, format: 'T20', rows: [
    { num: '18', marker: '', text: '4 runs' },
    { num: '17', marker: '', text: 'no run' },
    { num: '16', marker: '', text: '1 run' },
    { num: '15', marker: '', text: 'SIX' },
    { num: '14', marker: '', text: 'no run' },
    { num: '13', marker: '', text: '1 run' },
  ]});
  assert.deepStrictEqual(over, ['1', '·', '6', '1', '·', '4']);
});

test('HUN over boundary: first ball of new over must NOT include previous over balls', () => {
  const { currentOverFromCommentary } = poller;
  // Ball 6 (1-indexed) is the first ball of over 2 (HUN, 5-ball overs).
  // Previous over was balls 1-5; ball 5 must not leak in.
  const over = currentOverFromCommentary({ ballNbr: 6, format: 'HUN', rows: [
    { num: '6', marker: 'W', text: 'out' },
    { num: '5', marker: '', text: '4 runs' },
    { num: '4', marker: '', text: 'no run' },
  ]});
  assert.deepStrictEqual(over, ['W'], 'should only contain the new over\'s first ball');
});

test('HUN last ball of over is fully included', () => {
  const { currentOverFromCommentary } = poller;
  // Ball 5 (1-indexed) ends over 1 (HUN, 5-ball overs) → all 5 balls included.
  const over = currentOverFromCommentary({ ballNbr: 5, format: 'HUN', rows: [
    { num: '5', marker: '', text: '4 runs' },
    { num: '4', marker: '', text: 'no run' },
    { num: '3', marker: '', text: '1 run' },
    { num: '2', marker: '', text: 'SIX' },
    { num: '1', marker: '', text: 'no run' },
  ]});
  assert.deepStrictEqual(over, ['·', '6', '1', '·', '4'], 'should include all 5 balls');
});

test('T20 over boundary: first ball of new over must NOT include previous over balls', () => {
  const { currentOverFromCommentary } = poller;
  // Ball 7 (1-indexed) is the first ball of over 2 (6-ball) → only ball 7.
  const over = currentOverFromCommentary({ ballNbr: 7, format: 'T20', rows: [
    { num: '7', marker: '', text: 'SIX' },
    { num: '6', marker: '', text: 'no run' },
    { num: '5', marker: '', text: '1 run' },
  ]});
  assert.deepStrictEqual(over, ['6'], 'should only contain the new over\'s first ball');
});

test('Test match: currentOver from live innings even when ballNbr points at the completed innings', () => {
  const { currentOverFromCommentary } = poller;
  // Real WI vs PAK 2nd Test state: WI made 105.4 ov (634 balls), PAK are live
  // on their 32nd over (balls 187-192). Cricbuzz's ballNbr still says 634
  // (the completed innings). The rows must still yield PAK's live over.
  const over = currentOverFromCommentary({ ballNbr: 634, format: 'Test', rows: [
    { num: '192', marker: 'W', text: 'Azan Awais lbw b Warrican' },
    { num: '191', marker: '', text: 'no run' },
    { num: '190', marker: '', text: '1 run' },
    { num: '189', marker: '', text: 'no run' },
    { num: '188', marker: '', text: 'FOUR' },
    { num: '187', marker: '', text: 'no run' },
  ]});
  assert.deepStrictEqual(over, ['·', '4', '·', '1', '·', 'W'], 'live innings over, not the completed innings');
});

test('Test fixture: parseCricbuzz builds a live currentOver from the actual WI-PAK page', () => {
  const html = fs.readFileSync(path.join(__dirname, '_cb-test-live.html'), 'utf8');
  const parsed = poller.parseCricbuzz(html, 'https://www.cricbuzz.com/live-cricket-scores/152507/wi-vs-pak-2nd-test-west-indies-v-pakistan-2026');
  assert.ok(Array.isArray(parsed.currentOver), 'currentOver is an array');
  assert.ok(parsed.currentOver.length > 0, 'Test live innings must have a current over');
  assert.ok(parsed.currentOver.every(t => typeof t === 'string' && t.length > 0), 'all tokens valid');
});

test('Crex HUN: extractCrexApiData captures exact ball fields', () => {
  const html = fs.readFileSync(path.join(__dirname, '_crex-live.html'), 'utf8');
  const api = poller.extractCrexApiData(html, 'https://crex.com/cricket-live-score/msg-vs-tr-14th-match-the-hundred-2026-men-match-updates-ZKN');
  assert.ok(api, 'should extract Crex payload');
  assert.strictEqual(api.hballs1, '75b', 'hballs1 = exact balls bowled');
  assert.strictEqual(api.bBalls, '10b', 'bBalls = bowler balls');
  assert.strictEqual(api.team1, 'MSG');
  assert.strictEqual(api.score1, '91-3');
});

test('Crex HUN: buildFromCrex reports balls not overs', () => {
  const html = fs.readFileSync(path.join(__dirname, '_crex-live.html'), 'utf8');
  const api = poller.extractCrexApiData(html, 'https://crex.com/cricket-live-score/msg-vs-tr-14th-match-the-hundred-2026-men-match-updates-ZKN');
  const built = poller.buildFromCrex(api, 'https://crex.com/cricket-live-score/msg-vs-tr-14th-match-the-hundred-2026-men-match-updates-ZKN');
  assert.ok(built, 'should build');
  assert.strictEqual(built.format, 'HUN');
  assert.strictEqual(built.teams[0].balls, 75, 'batting team balls = 75');
  assert.strictEqual(built.teams[0].score, '91/3');
  assert.ok(built.bowler, 'bowler present');
  assert.strictEqual(built.bowler.balls, 10, 'bowler balls = 10');
  assert.ok(Array.isArray(built.currentOver), 'currentOver should be an array');
});

test('Crex HUN: lastovers parse "13th Five" labels (5-ball overs)', () => {
  const html = fs.readFileSync(path.join(__dirname, '_crex-live.html'), 'utf8');
  const api = poller.extractCrexApiData(html, 'https://crex.com/cricket-live-score/msg-vs-tr-14th-match-the-hundred-2026-men-match-updates-ZKN');
  const overs = poller.parseCrexLastOvers(api.lastoversRaw);
  assert.ok(overs.length >= 1, 'should have at least one over');
  const fiveteen = overs.find(o => o.over === 15);
  assert.ok(fiveteen, 'should parse "15th Five" label as over 15');
  assert.ok(fiveteen.balls.length <= 5, 'HUN over = max 5 balls');
});

test('Crex HUN: currentOverFromLastOvers handles 5-ball Five', () => {
  const html = fs.readFileSync(path.join(__dirname, '_crex-live.html'), 'utf8');
  const api = poller.extractCrexApiData(html, 'https://crex.com/cricket-live-score/msg-vs-tr-14th-match-the-hundred-2026-men-match-updates-ZKN');
  const overs = poller.parseCrexLastOvers(api.lastoversRaw);
  const cur = poller.currentOverFromLastOvers(overs, api.over1);
  assert.ok(cur && cur.length > 0, 'should return the current Five balls');
});

test('Cricbuzz HUN: ballNbr passes through to team balls', () => {
  const html = fs.readFileSync(path.join(__dirname, '_cb-live.html'), 'utf8');
  const parsed = poller.parseCricbuzz(html, URL);
  assert.strictEqual(parsed.ballNbr, 70, 'ballNbr extracted from innings JSON');
  const built = poller.buildFromCricbuzz(parsed, URL);
  assert.strictEqual(built.format, 'HUN');
  assert.strictEqual(built.teams[0].balls, 70, 'batting team balls = ballNbr');
  assert.strictEqual(built.teams[0].score, '86/3');
});

test('oversToBalls is format-aware (HUN 5-ball, others 6-ball)', () => {
  assert.strictEqual(poller.oversToBalls('15.0', 'HUN'), 75);
  assert.strictEqual(poller.oversToBalls('15.0', 'T20'), 90);
  assert.strictEqual(poller.oversToBalls('15.0', 'ODI'), 90);
  assert.strictEqual(poller.oversToBalls('11.4', 'HUN'), 59);
});

test('Crex feeds: parseCrexBallFeeds extracts ordered ball-by-ball feed', () => {
  const html = fs.readFileSync(path.join(__dirname, '_crex-live-current.html'), 'utf8');
  const feeds = poller.parseCrexBallFeeds(html);
  assert.ok(feeds.length >= 6, 'should extract the recent feed window');
  assert.strictEqual(feeds[feeds.length - 1].del, 79, 'newest delivery id = lastBallSeq source');
  assert.strictEqual(feeds[feeds.length - 1].s, '83/5', 'newest ball carries score after the ball');
  assert.ok(feeds.every(f => f.del != null && f.o && f.s && f.b != null), 'every feed entry has del/o/s/b');
  // feeds are oldest → newest
  for (let i = 1; i < feeds.length; i++) {
    assert.ok(feeds[i].del > feeds[i - 1].del, `feed del ordering monotonic (${feeds[i - 1].del} → ${feeds[i].del})`);
  }
});

test('Crex feeds: extractCrexApiData exposes lastBallSeq from feeds', () => {
  const html = fs.readFileSync(path.join(__dirname, '_crex-live.html'), 'utf8');
  const api = poller.extractCrexApiData(html, 'https://crex.com/cricket-live-score/x');
  assert.strictEqual(api.lastBallSeq, 75, 'lastBallSeq = newest feed delivery');
  assert.ok(Array.isArray(api.ballFeeds) && api.ballFeeds.length > 0, 'ballFeeds attached to api');
});

test('Crex feeds: currentOverFromCrexFeeds returns current Five balls', () => {
  const html = fs.readFileSync(path.join(__dirname, '_crex-live-current.html'), 'utf8');
  const feeds = poller.parseCrexBallFeeds(html);
  const over = poller.currentOverFromCrexFeeds(feeds);
  // del 78 = "1", del 79 = "1lb" → the live 16th Five only had 2 balls.
  assert.deepStrictEqual(over, ['1', 'lb'], 'current over balls from feed (lb normalized)');
});

test('Crex feeds: currentOverFromCrexFeeds marks a fresh wicket from the score bump', () => {
  // Feed window shows a W on the newest ball via wicket-count progression.
  const feeds = [
    { del: 1, o: '1.1', s: '0/0', b: '·' },
    { del: 2, o: '1.2', s: '1/0', b: '1' },
    { del: 3, o: '1.3', s: '1/1', b: '4' },   // wicket: count 0 → 1
  ];
  const over = poller.currentOverFromCrexFeeds(feeds);
  assert.deepStrictEqual(over, ['·', '1', 'W'], 'wicket token derived from score progression');
});

test('Crex feeds: tokenFromCrexBall maps wd/nb/lb and plain runs', () => {
  assert.strictEqual(poller.tokenFromCrexBall({ del: 5, o: '2.1', s: '10/0', b: '1wd' }, { s: '9/0' }), 'wd');
  assert.strictEqual(poller.tokenFromCrexBall({ del: 6, o: '2.2', s: '10/0', b: 'nb' }, { s: '10/0' }), 'nb');
  assert.strictEqual(poller.tokenFromCrexBall({ del: 7, o: '2.3', s: '14/0', b: '1lb' }, { s: '10/0' }), 'lb');
  assert.strictEqual(poller.tokenFromCrexBall({ del: 8, o: '2.4', s: '18/0', b: '4' }, { s: '14/0' }), '4');
});

test('Crex feeds: detectCrexDismissalMode finds mode in feeds prose (not commentary)', () => {
  const feeds = [
    { del: 9, o: '2.5', s: '20/0', b: '1', c2: 'Slower ball, dabbed to cover.' },
    { del: 10, o: '3.1', s: '20/1', b: '·', c2: '<b>CLEAN BOWLED! He goes low and swings, misses.' },
  ];
  const mode = poller.detectCrexDismissalMode([], feeds);
  assert.strictEqual(mode, 'bold', 'mode derived from the feed prose that carries the wicket');
});

test('Crex feeds: matchDismissalMode ranks runout > lbw > caught > bowled', () => {
  assert.strictEqual(poller.matchDismissalMode('RUN OUT! direct hit'), 'runout');
  assert.strictEqual(poller.matchDismissalMode('Hawk-Eye says PLUMB! LBW'), 'lbw');
  assert.strictEqual(poller.matchDismissalMode('TAKES THE CATCH! edges and gone'), 'caught');
  assert.strictEqual(poller.matchDismissalMode('Cleaned up middle stump'), 'bold');
  assert.strictEqual(poller.matchDismissalMode('some random text'), null);
});

test('Crex feeds: buildFromCrex emits lastBallSeq + feed-driven currentOver', () => {
  const html = fs.readFileSync(path.join(__dirname, '_crex-live-current.html'), 'utf8');
  const api = poller.extractCrexApiData(html, 'https://crex.com/cricket-live-score/x');
  const built = poller.buildFromCrex(api, 'https://crex.com/cricket-live-score/x');
  assert.strictEqual(built.lastBallSeq, 79, 'lastBallSeq in built payload');
  assert.deepStrictEqual(built.currentOver, ['1', 'lb'], 'currentOver driven by feeds');
});

test('HUN: buildFromCrex reports RPB, never CRR (The Hundred has no run rate)', () => {
  const html = fs.readFileSync(path.join(__dirname, '_crex-live.html'), 'utf8');
  const api = poller.extractCrexApiData(html, 'https://crex.com/cricket-live-score/msg-vs-tr-14th-match-the-hundred-2026-men-match-updates-ZKN');
  const built = poller.buildFromCrex(api, 'https://crex.com/cricket-live-score/msg-vs-tr-14th-match-the-hundred-2026-men-match-updates-ZKN');
  assert.strictEqual(built.format, 'HUN');
  assert.ok(built.rpb, 'HUN payload must carry RPB');
  assert.strictEqual(built.rpb, '1.21', '91 runs / 75 balls = 1.21 RPB');
  assert.ok(!built.crr, 'HUN payload must NOT carry CRR');
  assert.ok(!built.rrr, 'HUN payload must NOT carry RRR');
  assert.ok(built.bowler.rpb, 'HUN bowler carries RPB');
});

test('HUN: buildFromCricbuzz reports RPB, never CRR', () => {
  const html = fs.readFileSync(path.join(__dirname, '_cb-live.html'), 'utf8');
  const parsed = poller.parseCricbuzz(html, URL);
  const built = poller.buildFromCricbuzz(parsed, URL);
  assert.strictEqual(built.format, 'HUN');
  assert.ok(built.rpb, 'HUN payload must carry RPB');
  assert.ok(!built.crr, 'HUN payload must NOT carry CRR');
  assert.ok(!built.rrr, 'HUN payload must NOT carry RRR');
});

test('FORMATS config: every format has correct per-format rules', () => {
  const t20 = poller.getFormatConfig('T20');
  assert.strictEqual(t20.ballsPerOver, 6, 'T20: 6 balls/over');
  assert.strictEqual(t20.maxBalls, 120, 'T20: 120 balls');
  assert.strictEqual(t20.maxRpo, 30, 'T20: max RPO 30');
  assert.strictEqual(t20.rateMetric, 'crr', 'T20 rates in CRR');
  assert.strictEqual(t20.innings, 2, 'T20: 2 innings');
  assert.strictEqual(t20.showOvers, true, 'T20 shows overs');

  const odi = poller.getFormatConfig('ODI');
  assert.strictEqual(odi.ballsPerOver, 6, 'ODI: 6 balls/over');
  assert.strictEqual(odi.maxBalls, 300, 'ODI: 300 balls');
  assert.strictEqual(odi.maxRpo, 22, 'ODI: max RPO 22');
  assert.strictEqual(odi.rateMetric, 'crr', 'ODI rates in CRR');

  const test = poller.getFormatConfig('Test');
  assert.strictEqual(test.ballsPerOver, 6, 'Test: 6 balls/over');
  assert.strictEqual(test.maxBalls, Infinity, 'Test: no ball limit');
  assert.strictEqual(test.maxRpo, 14, 'Test: max RPO 14');
  assert.strictEqual(test.rateMetric, 'crr', 'Test rates in CRR');
  assert.strictEqual(test.innings, 4, 'Test: up to 4 innings');
  assert.strictEqual(test.sessions, true, 'Test has day/session status');
  assert.strictEqual(test.chaseBalls, false, 'Test has no balls-to-chase target');

  const hun = poller.getFormatConfig('HUN');
  assert.strictEqual(hun.ballsPerOver, 5, 'HUN: 5 balls/over');
  assert.strictEqual(hun.maxBalls, 100, 'HUN: 100 balls');
  assert.strictEqual(hun.rateMetric, 'rpb', 'HUN rates in RPB');
  assert.strictEqual(hun.showOvers, false, 'HUN never shows overs');
  assert.strictEqual(hun.chaseBalls, true, 'HUN target counts balls');

  const fallback = poller.getFormatConfig('GARBAGE');
  assert.strictEqual(fallback, null, 'unknown format has no config');
});

test('T20: buildFromCricbuzz still carries CRR/RRR', () => {
  const parsed = { batRow: { name: 'IND', runs: '150', wkts: '3', overs: '15.0' }, teamRows: [{ name: 'IND', runs: '150', wkts: '3', overs: '15.0' }, { name: 'AUS', runs: '160', wkts: '6', overs: '20.0' }], crr: '10.00', rrr: '9.50', status: 'IND need 11 runs' };  const built = poller.buildFromCricbuzz(parsed, 'https://www.cricbuzz.com/live-cricket-scores/12345/ind-vs-aus-2nd-t20i-2026');
  assert.strictEqual(built.format, 'T20');
  assert.strictEqual(built.crr, '10.00', 'T20 keeps CRR');
  assert.strictEqual(built.rrr, '9.50', 'T20 keeps RRR');
  assert.ok(!built.rpb, 'T20 must not report RPB');
});

test('CRITICAL: isPlausibleScore accepts 0/1 early-collapse and 0/0 scores', () => {
  assert.ok(poller.isPlausibleScore('0/1', '0.1', 'Test'), '0/1 after a wicket off the first ball is a REAL score (Test)');
  assert.ok(poller.isPlausibleScore('0/0', '0.0', 'T20'), '0/0 before the first ball is a real score');
  assert.ok(poller.isPlausibleScore('0/1', '0.1', 'T20'), '0/1 in a T20 is a real score');
  assert.ok(poller.isPlausibleScore('1/0', '0.1', 'Test'), '1/0 after a single is fine');
  assert.ok(poller.isPlausibleScore('245/10', '78.3', 'Test'), 'normal Test innings is fine');
  assert.ok(!poller.isPlausibleScore('5/11', '0.2', 'Test'), '11 wickets in one innings is impossible');
  assert.ok(!poller.isPlausibleScore('4000/0', '80.0', 'Test'), '4000 runs in a Test innings is impossible');
});

test('Test inference: URL without "test" keyword but Day/trail status is still Test', () => {
  const parsed = { batRow: { name: 'PAK', runs: '245', wkts: '8', overs: '78.3' }, teamRows: [{ name: 'PAK', runs: '245', wkts: '8', overs: '78.3' }, { name: 'WI', runs: '311', wkts: '10', overs: '95.0' }], status: 'Day 2: Tea - Pakistan trail by 66 runs' };
  const built = poller.buildFromCricbuzz(parsed, 'https://www.cricbuzz.com/live-cricket-scores/12345/pak-vs-wi-1st-match-2026');
  assert.ok(built, 'payload built');
  assert.strictEqual(built.format, 'Test', 'inferred from status, not silently ODI');
  assert.strictEqual(built.crr, undefined, 'no CRR parsed here, fine');
});

test('Test fixture: buildFromCricbuzz emits the full innings history strip', () => {
  const html = fs.readFileSync(path.join(__dirname, '_cb-test-live.html'), 'utf8');
  const parsed = poller.parseCricbuzz(html, 'https://www.cricbuzz.com/live-cricket-scores/152507/wi-vs-pak-2nd-test-west-indies-v-pakistan-2026');
  assert.ok(Array.isArray(parsed.inningsList), 'inningsList parsed');
  assert.strictEqual(parsed.inningsList.length, 2, 'WI + PAK = 2 innings so far');
  const built = poller.buildFromCricbuzz(parsed, 'https://www.cricbuzz.com/live-cricket-scores/152507/wi-vs-pak-2nd-test-west-indies-v-pakistan-2026');
  assert.ok(Array.isArray(built.innings), 'payload carries innings');
  assert.strictEqual(built.innings.length, 2, 'two innings chips');
  assert.strictEqual(built.innings[0].name, 'WI');
  assert.strictEqual(built.innings[0].score, '344/10', 'completed innings scores /10');
  assert.strictEqual(built.innings[1].name, 'PAK');
  assert.strictEqual(built.innings[1].score, '139/2', 'live innings scores X/Y');
  assert.strictEqual(built.innings[1].live, true, 'last innings flagged live');
  assert.strictEqual(built.innings[0].live, false, 'completed innings not live');
});

test('Test: no balls-to-chase target, but T20 chase target carries balls', () => {
  const testParsed = { batRow: { name: 'WI', runs: '120', wkts: '4', overs: '41.0' }, teamRows: [{ name: 'WI', runs: '120', wkts: '4', overs: '41.0' }, { name: 'PAK', runs: '245', wkts: '10', overs: '78.0' }], status: 'West Indies need 126 runs' };
  const testBuilt = poller.buildFromCricbuzz(testParsed, 'https://www.cricbuzz.com/live-cricket-scores/12345/pak-vs-wi-1st-test-2026');
  assert.strictEqual(testBuilt.format, 'Test');
  assert.ok(testBuilt.target, '4th-innings chase target present');
  assert.ok(!('balls' in testBuilt.target), 'Test chase target never carries balls');

  const t20Parsed = { batRow: { name: 'AUS', runs: '150', wkts: '3', overs: '15.0' }, teamRows: [{ name: 'AUS', runs: '150', wkts: '3', overs: '15.0' }, { name: 'IND', runs: '160', wkts: '6', overs: '20.0' }], status: 'Australia need 11 runs in 30 balls' };
  const t20Built = poller.buildFromCricbuzz(t20Parsed, 'https://www.cricbuzz.com/live-cricket-scores/12345/aus-vs-ind-2nd-t20i-2026');
  assert.strictEqual(t20Built.format, 'T20');
  assert.ok(t20Built.target, 'T20 chase target present');
  assert.strictEqual(t20Built.target.balls, '30', 'T20 chase target carries remaining balls');
});

test('REV-B M2: HUN chase remaining balls come from actual balls bowled, not overs', () => {
  const api = {
    team1: 'WEF', team1Full: 'Welsh Fire', team2: 'SB', team2Full: 'Southern Brave',
    score1: '75/0', over1: '0.0', score2: '0/0',
    hballs1: '51b', hballs2: '',
    inning: '1', target: '100', comment1: 'WEF need 25 runs in 49 balls'
  };
  const built = poller.buildFromCrex(api, 'https://crex.com/cricket-live-score/wef-vs-sb-14th-match-the-hundred-2026-men-match-updates-zkx');
  assert.ok(built, 'payload built');
  assert.strictEqual(built.format, 'HUN');
  assert.ok(built.target, 'HUN chase target present');
  assert.strictEqual(built.target.balls, '49', 'remaining = 100 - 51 actual balls, NOT derived from overs');
});

test('REV-A HIGH: buildFromCricbuzz must NOT drop payload when the batting row has no wickets yet', () => {
  const parsed = {
    batRow: { name: 'IND', runs: '86', wkts: null, overs: '12.4' },
    teamRows: [{ name: 'IND', runs: '86', wkts: null, overs: '12.4' }, { name: 'AUS', runs: '160', wkts: '6', overs: '20.0' }],
    crr: '6.77', status: 'IND need 75 runs'
  };
  const built = poller.buildFromCricbuzz(parsed, 'https://www.cricbuzz.com/live-cricket-scores/12345/ind-vs-aus-2nd-t20i-2026');
  assert.ok(built, 'payload must be built when the batting side has no wickets yet');
  assert.strictEqual(built.format, 'T20');
  assert.strictEqual(built.teams[0].score, '86/0', 'no-wickets batting side formats as 86/0');
});

test('REV-B M3: T20/ODI "Innings Break" status must NOT be inferred as Test', () => {
  const parsed = {
    batRow: { name: 'AUS', runs: '150', wkts: '8', overs: '20.0' },
    teamRows: [{ name: 'AUS', runs: '150', wkts: '8', overs: '20.0' }, { name: 'IND', runs: '160', wkts: '6', overs: '20.0' }],
    status: 'Innings Break: India won by 10 runs'
  };
  const built = poller.buildFromCricbuzz(parsed, 'https://www.cricbuzz.com/live-cricket-scores/12345/ind-vs-aus-1st-match-2026');
  assert.ok(built, 'payload built');
  assert.notStrictEqual(built.format, 'Test', 'Innings Break status does not imply Test even with a silent URL');
  assert.ok(!built.innings, 'no Test innings strip for a T20');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
