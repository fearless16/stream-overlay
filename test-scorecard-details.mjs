import { chromium } from 'playwright';
import { strict as assert } from 'assert';

// The overlay auto-connects to CONFIG.wsUrl. Point it at a dead port so the
// live stream (ws://localhost:8765) can never push a real score payload into
// a running test and clobber fixture state — the suite must be hermetic.
const HTML_PATH = 'file:///' + process.cwd().replace(/\\/g, '/') + '/chat-overlay.html?ws=' + encodeURIComponent('ws://127.0.0.1:1');
const DATA_URI_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  // The overlay is self-contained; waiting for remote team/avatar assets to
  // become idle makes the local suite slow and flaky when the network is off.
  await page.goto(HTML_PATH, { waitUntil: 'domcontentloaded', timeout: 15000 });

  const results = [];
  function pass(name) { results.push({ name, ok: true }); console.log('PASS:', name); }
  function fail(name, err) { results.push({ name, ok: false, err }); console.log('FAIL:', name, '-', err); }

  await page.evaluate(() => {
    document.getElementById('scorecard').classList.remove('hidden');
  });
  await page.waitForTimeout(200);

  // ====== _flag() FRANCHISE TEAMS ======
  try { const fn = await page.evaluate(() => typeof _flag === 'function');
    assert.ok(fn, '_flag exists');
  } catch (e) { fail('_flag exists', e.message); return; }

  function isCbImg(val) {
    return typeof val === 'string' && val.includes('static.cricbuzz.com') && val.includes('.jpg');
  }
  const flagTests = [
    ['JKS', '🇱🇰'], ['KRL', '🇱🇰'],
    ['CSK', null, true], ['MI', null, true], ['RCB', null, true],
    ['LAHORE Qalandars', '🇵🇰'],
    ['KK', null, true], ['SKN', null, true], ['BR', null, true], ['GAW', null, true],
    ['IND', null, true], ['AUS', null, true],
    ['', '🏳️'], ['unknown_xyz', '🏳️'],
  ];
  for (const [name, expected, isImg] of flagTests) {
    try {
      const result = await page.evaluate(n => _flag(n), name);
      if (isImg) {
        assert.ok(result.startsWith('<img'), `_flag("${name}") should be <img> tag`);
        assert.ok(isCbImg(result), `_flag("${name}") should contain cricbuzz URL`);
        pass(`_flag("${name}") → <img> (Cricbuzz logo)`);
      } else {
        assert.equal(result, expected, `_flag("${name}") → ${expected}`);
        pass(`_flag("${name}") → ${expected}`);
      }
    } catch (e) { fail(`_flag("${name}")`, e.message); }
  }

  // ====== _flag() WITH URL ======
  try {
    const result = await page.evaluate(() => _flag('JKS', 'https://example.com/logo.png'));
    assert.ok(result.includes('<img'), '_flag with URL returns img tag');
    assert.ok(result.includes('example.com/logo.png'), 'img src contains URL');
    pass('_flag("JKS", url) returns img HTML');
  } catch (e) { fail('_flag with URL', e.message); }

  // ====== _inningLabel() ======
  try {
    const fn = await page.evaluate(() => typeof window._inningLabel === 'function');
    assert.ok(fn, '_inningLabel exists');
  } catch (e) { fail('_inningLabel exists', e.message); return; }

  const inningTests = [
    [1, '1st Inn'], [2, '2nd Inn'], [3, '3rd Inn'], [4, '4th Inn'],
    [null, 'Batting'], [undefined, 'Batting'],
  ];
  for (const [inning, expected] of inningTests) {
    try {
      const result = await page.evaluate(inn => window._inningLabel(inn), inning);
      assert.equal(result, expected, `_inningLabel(${inning}) → ${expected}`);
      pass(`_inningLabel(${inning}) → ${expected}`);
    } catch (e) { fail(`_inningLabel(${inning})`, e.message); }
  }

  // ====== HELPERS ======
  async function resetScorecard(graceMs = 150) {
    await page.evaluate((g) => {
      if (window._cricketAnimTimer) { clearTimeout(window._cricketAnimTimer); window._cricketAnimTimer = null; }
      document.getElementById('scorecard').className = '';
      document.getElementById('sc-anim-layer').classList.remove('active');
      currentScore = null;
      if (_pendingWicket) { clearTimeout(_pendingWicket.timer); _pendingWicket = null; }
      WICKET_TYPE_GRACE_MS = g;
      __animFireCount = 0;
      _wicketFire = { team: '', count: -1, at: 0, lw: '', seq: null, source: '' };
      _lastBoundaryAnim = { key: '', type: '', at: 0 };
    }, graceMs);
  }

  async function callUpdate(data) {
    await page.evaluate(d => { if (typeof updateScore === 'function') updateScore(d); }, data);
    await page.waitForTimeout(200);
  }

  // ====== FORMAT BADGE RENDERING ======
  for (const fmt of ['T20', 'ODI', 'Test']) {
    try {
      await resetScorecard();
      await callUpdate({
        format: fmt,
        teams: [
          { name: 'India', score: '150/3 (15.0)', abbr: 'IND' },
          { name: 'Australia', score: '', abbr: 'AUS' }
        ],
        batsmen: [{ name: 'Kohli', runs: '45', balls: '38' }],
        bowler: { name: 'Starc', overs: '3', runs: '28', wickets: '1' }
      });
      const hasBadge = await page.evaluate(f => {
        const el = document.querySelector('.sc-format-badge');
        return el && el.textContent.trim() === f;
      }, fmt);
      assert.ok(hasBadge, `format badge "${fmt}" should render`);
      pass(`format badge "${fmt}" rendered`);
    } catch (e) { fail(`format badge "${fmt}"`, e.message); }
  }

  // ====== FORMAT DISPLAY CONTRACT ======
  // Each supported format has a deliberately different display contract:
  // limited-overs matches show overs + CRR/RRR, The Hundred shows balls +
  // RPB, and Tests show innings/session context without a balls-to-chase UI.
  const formatCases = [
    {
      name: 'T20',
      data: {
        format: 'T20',
        teams: [{ name: 'India', score: '150/3', overs: '15.0' }, { name: 'Australia', score: '160/6', overs: '20.0' }],
        rateMetric: 'crr', crr: '10.00', rrr: '9.50',
        bowler: { name: 'Starc', overs: '3.0', runs: '28', wickets: '1' }
      },
      mustHave: ['CRR10.00', 'RRR9.50', '3.0 ov'],
      mustNotHave: ['RPB', 'balls)']
    },
    {
      name: 'ODI',
      data: {
        format: 'ODI',
        teams: [{ name: 'India', score: '275/6', overs: '47.2' }, { name: 'Australia', score: '274/9', overs: '50.0' }],
        rateMetric: 'crr', crr: '5.80', rrr: '2.10',
        bowler: { name: 'Starc', overs: '8.2', runs: '42', wickets: '2' }
      },
      mustHave: ['CRR5.80', 'RRR2.10', '8.2 ov'],
      mustNotHave: ['RPB', 'balls)']
    },
    {
      name: 'Test',
      data: {
        format: 'Test', inning: 3, day: '3', session: 'Tea',
        teams: [{ name: 'India', score: '245/4', overs: '78.3' }, { name: 'Australia', score: '311/10', overs: '95.0' }],
        crr: '3.12', innings: [
          { name: 'Australia', score: '311/10', overs: '95.0', live: false },
          { name: 'India', score: '245/4', overs: '78.3', live: true }
        ],
        bowler: { name: 'Starc', overs: '12.0', runs: '30', wickets: '2' }
      },
      mustHave: ['Day 3', 'Tea', '3rd Inn', '311/10'],
      mustNotHave: ['from 120 balls', 'balls-to-chase']
    },
    {
      name: '100',
      data: {
        format: 'HUN', rateMetric: 'rpb', rpb: '1.21',
        teams: [{ name: 'Welsh Fire', score: '91/3', balls: 75 }, { name: 'Southern Brave', score: '100/5', balls: 100 }],
        bowler: { name: 'Archer', balls: 10, runs: '12', wickets: '1' }
      },
      mustHave: ['RPB1.21', '10 balls', '75 balls'],
      mustNotHave: ['CRR', ' ov)']
    }
  ];
  for (const testCase of formatCases) {
    try {
      await resetScorecard();
      await callUpdate(testCase.data);
      const rendered = await page.evaluate(() => document.getElementById('sc-content').textContent.replace(/\s+/g, ' ').trim());
      for (const expected of testCase.mustHave) assert.ok(rendered.includes(expected), `${testCase.name} should render ${expected}; got: ${rendered}`);
      for (const unexpected of testCase.mustNotHave) assert.ok(!rendered.includes(unexpected), `${testCase.name} must not render ${unexpected}; got: ${rendered}`);
      pass(`${testCase.name} scorecard display contract`);
    } catch (e) { fail(`${testCase.name} scorecard display contract`, e.message); }
  }

  // ====== CHAT HOVER MUST NOT MOVE MESSAGE HIT AREAS ======
  try {
    await page.evaluate(() => { clearChat(); addMsg({ name: 'A', text: 'first', msgType: 'chat' }, { noAnim: true }); });
    await page.hover('#chat-container .msg');
    const transform = await page.evaluate(() => getComputedStyle(document.querySelector('#chat-container .msg')).transform);
    assert.equal(transform, 'none', 'hovering a chat message must not translate it under the cursor');
    pass('chat hover keeps message hit area stable');
  } catch (e) { fail('chat hover keeps message hit area stable', e.message); }

  // ====== FORMAT BADGE HIDDEN WHEN NO FORMAT ======
  try {
    await resetScorecard();
    await callUpdate({
      teams: [
        { name: 'India', score: '150/3 (15.0)', abbr: 'IND' },
        { name: 'Australia', score: '', abbr: 'AUS' }
      ],
      batsmen: [{ name: 'Kohli', runs: '45', balls: '38' }],
      bowler: { name: 'Starc', overs: '3', runs: '28', wickets: '1' }
    });
    const badgeMissing = await page.evaluate(() => !document.querySelector('.sc-format-badge'));
    assert.ok(badgeMissing, 'format badge should not render when format is missing');
    pass('format badge hidden when no format');
  } catch (e) { fail('format badge hidden', e.message); }

  // ====== INNINGS LABEL ======
  try {
    await resetScorecard();
    await callUpdate({
      format: 'T20', inning: 2,
      teams: [
        { name: 'India', score: '150/3 (15.0)', abbr: 'IND' },
        { name: 'Australia', score: '180/5 (20.0)', abbr: 'AUS' }
      ],
      batsmen: [{ name: 'Kohli', runs: '45', balls: '38' }],
      bowler: { name: 'Starc', overs: '3', runs: '28', wickets: '1' }
    });
    const badge = await page.evaluate(() => {
      const el = document.querySelector('.sc-t:first-child .sc-t-badge');
      return el ? el.textContent.trim() : null;
    });
    assert.ok(badge && badge.includes('2nd'), `batting badge should show "2nd Inn", got "${badge}"`);
    pass('innings label shows correct number for batting team');
  } catch (e) { fail('innings label', e.message); }

  // ====== WAITING BADGE WHEN NO SCORE ======
  try {
    await resetScorecard();
    await callUpdate({
      format: 'T20', inning: 1,
      teams: [
        { name: 'India', score: '150/3 (15.0)', abbr: 'IND' },
        { name: 'Australia', score: '', abbr: 'AUS' }
      ],
      batsmen: [{ name: 'Kohli', runs: '45', balls: '38' }],
      bowler: { name: 'Starc', overs: '3', runs: '28', wickets: '1' }
    });
    const badge = await page.evaluate(() => {
      const el = document.querySelector('.sc-t:last-child .sc-t-badge');
      return el ? el.textContent.trim() : null;
    });
    assert.equal(badge, 'Waiting', 'other team should show Waiting when score blank');
    pass('waiting badge shown for blank score team');
  } catch (e) { fail('waiting badge', e.message); }

  // ====== IMAGE FLAG ======
  try {
    await resetScorecard();
    await callUpdate({
      format: 'T20', inning: 1,
      teams: [
        { name: 'Jaffna Kings', score: '221/6 (20.0)', abbr: 'JKS', flag: DATA_URI_PNG },
        { name: 'Kandy Royals', score: '200 (20.0)', abbr: 'KRL' }
      ],
      batsmen: [{ name: 'Avishka', runs: '45', balls: '38' }],
      bowler: { name: 'Madushanka', overs: '4', runs: '36', wickets: '2' }
    });
    const usesImg = await page.evaluate(() => {
      const flag = document.querySelector('.sc-t:first-child .sc-t-flag');
      return flag && flag.querySelector('img') !== null;
    });
    assert.ok(usesImg, 'team.flag should render as <img>');
    pass('image flag rendered from team.flag URL');
  } catch (e) { fail('image flag', e.message); }

  // ====== FRANCHISE FLAGS RENDER ======
  try {
    await resetScorecard();
    await callUpdate({
      format: 'T20', inning: 2,
      teams: [
        { name: 'Jaffna Kings', score: '221/6 (20.0)', abbr: 'JKS' },
        { name: 'Kandy Royals', score: '200 (20.0)', abbr: 'KRL' }
      ],
      batsmen: [{ name: 'Avishka', runs: '45', balls: '38' }],
      bowler: { name: 'Madushanka', overs: '4', runs: '36', wickets: '2' }
    });
    const flags = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.sc-t-flag')).map(el => el.textContent.trim());
    });
    assert.equal(flags.length, 2, 'should have 2 flag elements');
    assert.equal(flags[0], '🇱🇰', 'JKS flag should be 🇱🇰');
    assert.equal(flags[1], '🇱🇰', 'KRL flag should be 🇱🇰');
    pass('franchise flags render as emoji');
  } catch (e) { fail('franchise flags', e.message); }

  // ====== FULL TEAM NAME MUST BEAT AMBIGUOUS ABBREVIATION ======
  try {
    await resetScorecard();
    await callUpdate({
      format: 'T20',
      teams: [
        { name: 'Dindigul Dragons', abbr: 'DD', score: '2/0', overs: '1.0' },
        { name: 'IDream Tiruppur Tamizhans', abbr: 'ITT', score: '107/10', overs: '15.4' }
      ]
    });
    const srcs = await page.evaluate(() => [...document.querySelectorAll('.sc-t-flag img')].map(img => img.getAttribute('src')));
    assert.ok(srcs[0]?.includes('dindigul-dragons.jpg'), `DD must use Dindigul Dragons logo, got ${srcs[0]}`);
    pass('full team name resolves ambiguous DD logo');
  } catch (e) { fail('full team name resolves ambiguous DD logo', e.message); }

  // ====== CRICKET EVENT: SYNC + SINGLE-FIRE ANIMATIONS ======
  async function evalScore(data, source) {
    await page.evaluate((d, src) => { if (typeof updateScore === 'function') updateScore(d, src); }, data, source);
  }
  function baseline(score, overArr, seq) {
    return {
      source: 'Crex Live',
      teams: [
        { name: 'India', score, overs: '15.2', abbr: 'IND' },
        { name: 'Sri Lanka', score: '', abbr: 'SL' },
      ],
      batsmen: [
        { name: 'Marcus Stoinis', runs: '50', balls: '35', striker: true },
        { name: 'David Miller', runs: '4', balls: '5' },
      ],
      bowler: { name: 'Lockie Ferguson', overs: '2.2', runs: '14', wickets: '0' },
      currentOver: overArr,
      lastBallSeq: seq,
    };
  }

  // ====== WICKET: CHECK THE DISMISSAL TYPE BEFORE FIRING ======
  try {
    await resetScorecard(150);
    await evalScore(baseline('83/4', ['1', 'lb'], 78));
    await evalScore(baseline('83/5', ['1', 'lb', 'W'], 79));
    const early = await page.evaluate(() => ({
      count: __animFireCount,
      hasWicket: document.getElementById('scorecard').classList.contains('sc-cricket-wicket'),
      hasUpdate: document.getElementById('scorecard').classList.contains('sc-update'),
    }));
    assert.strictEqual(early.count, 0, 'no animation fires before the dismissal type is known');
    assert.strictEqual(early.hasWicket, false, 'no neutral burst before the type is known');
    assert.strictEqual(early.hasUpdate, false, 'no sc-update flash while waiting for the type');
    await page.waitForTimeout(400);
    const late = await page.evaluate(() => ({
      count: __animFireCount,
      hasWicket: document.getElementById('scorecard').classList.contains('sc-cricket-wicket'),
    }));
    assert.strictEqual(late.count, 1, 'neutral burst fires exactly once after the grace window');
    assert.ok(late.hasWicket, 'neutral burst present after grace');
    pass('wicket with unknown type defers, then fires neutral once');
  } catch (e) { fail('wicket with unknown type defers, then fires neutral once', e.message); }

  // ====== WICKET: TYPE ARRIVING IN-WINDOW UPGRADES THE BURST ======
  try {
    await resetScorecard(600);
    await evalScore(baseline('83/4', ['1', 'lb'], 78));
    await evalScore(baseline('83/5', ['1', 'lb', 'W'], 79));
    const typed = baseline('83/5', ['1', 'lb', 'W'], 79);
    typed.lastWicket = 'Marcus Stoinis caught 10 (8)';
    await evalScore(typed);
    await page.waitForTimeout(200);
    const state = await page.evaluate(() => ({
      count: __animFireCount,
      caught: document.getElementById('scorecard').classList.contains('sc-cricket-caught'),
      neutral: document.getElementById('scorecard').classList.contains('sc-cricket-wicket'),
    }));
    assert.strictEqual(state.count, 1, 'exactly one animation fires');
    assert.ok(state.caught, 'typed CAUGHT burst fires when the type arrives in-window');
    assert.strictEqual(state.neutral, false, 'neutral burst never fires once the type is known');
    pass('wicket type arriving in-window upgrades to the typed burst');
  } catch (e) { fail('wicket type arriving in-window upgrades to the typed burst', e.message); }

  // ====== WICKET: ECHO POLL NEVER RE-FIRES ======
  try {
    await resetScorecard(150);
    await evalScore(baseline('83/4', ['1', 'lb'], 78));
    await evalScore(baseline('83/5', ['1', 'lb', 'W'], 79));
    await page.waitForTimeout(400);
    await evalScore(baseline('83/5', ['1', 'lb', 'W'], 79));
    await page.waitForTimeout(300);
    const count = await page.evaluate(() => __animFireCount);
    assert.strictEqual(count, 1, 'an echo of the same wicket must not re-fire');
    pass('wicket echo poll does not re-trigger the animation');
  } catch (e) { fail('wicket echo poll does not re-trigger the animation', e.message); }

  // ====== BOUNDARY: DEDUP IGNORES THE SOURCE CHANNEL ======
  try {
    await page.evaluate(() => { _lastBoundaryAnim = { key: '', type: '', at: 0 }; });
    const f1 = await page.evaluate(() => _shouldFireBoundaryAnim('4', ['1', 'lb', 'W', '4'], 80, 'Crex Live'));
    const f2 = await page.evaluate(() => _shouldFireBoundaryAnim('4', ['1', 'lb', 'W', '4'], 80, undefined));
    assert.strictEqual(f1, true, 'first sighting fires');
    assert.strictEqual(f2, false, 'same over+seq+type across channels must be deduped');
    pass('boundary dedup ignores the source channel');
  } catch (e) { fail('boundary dedup ignores the source channel', e.message); }

  // ====== PLAYER STATS: NEVER GLUE STALE BATTERS TO A NEW DELIVERY ======
  try {
    await resetScorecard(150);
    await evalScore(baseline('83/4', ['1', 'lb'], 78));
    const echoMissing = baseline('83/4', ['1', 'lb'], 78);
    delete echoMissing.batsmen; delete echoMissing.bowler;
    await evalScore(echoMissing);
    let bm = await page.evaluate(() => document.querySelectorAll('.sc-bm').length);
    assert.strictEqual(bm, 2, 'same delivery without players reuses the last player set');
    const newDelMissing = baseline('84/4', ['1', 'lb', '1'], 79);
    delete newDelMissing.batsmen; delete newDelMissing.bowler;
    await evalScore(newDelMissing);
    bm = await page.evaluate(() => document.querySelectorAll('.sc-bm').length);
    assert.strictEqual(bm, 0, 'a new delivery without players must NOT glue stale stats');
    pass('player stats never glue stale batters to a new delivery');
  } catch (e) { fail('player stats never glue stale batters to a new delivery', e.message); }

  // ====== SC-UPDATE FLASH SUPPRESSED DURING A RUNNING CRICKET ANIMATION ======
  try {
    await resetScorecard(150);
    await evalScore(baseline('83/4', ['1', 'lb'], 78));
    await evalScore(baseline('83/5', ['1', 'lb', 'W'], 79));
    await page.waitForTimeout(400);
    await evalScore(baseline('84/5', ['1', 'lb', 'W', '1'], 81));
    await page.waitForTimeout(100);
    const hasUpdate = await page.evaluate(() => document.getElementById('scorecard').classList.contains('sc-update'));
    assert.strictEqual(hasUpdate, false, 'sc-update flash must not overlap a running cricket animation');
    pass('sc-update flash suppressed while a cricket animation is running');
  } catch (e) { fail('sc-update flash suppressed while a cricket animation is running', e.message); }

  // ====== WICKET: STALE PREV lastWicket MUST NOT TYPE A FRESH DISMISSAL ======
  try {
    await resetScorecard(800);
    const stalePrev = baseline('83/4', ['1', 'lb'], 78);
    stalePrev.lastWicket = 'Rohit Sharma lbw b Zampa 12 (20)'; // PREVIOUS wicket's text
    await evalScore(stalePrev);
    await evalScore(baseline('83/5', ['1', 'lb', 'W'], 79)); // fresh wicket, how-out text still lagging
    const early = await page.evaluate(() => ({
      count: __animFireCount,
      lbw: document.getElementById('scorecard').classList.contains('sc-cricket-lbw'),
      neutral: document.getElementById('scorecard').classList.contains('sc-cricket-wicket'),
    }));
    assert.strictEqual(early.count, 0, 'must defer, not fire a stale typed burst');
    assert.strictEqual(early.lbw, false, 'the PREVIOUS wicket mode must never type this wicket');
    await page.waitForTimeout(1200);
    const late = await page.evaluate(() => ({ count: __animFireCount, neutral: document.getElementById('scorecard').classList.contains('sc-cricket-wicket') }));
    assert.strictEqual(late.count, 1, 'neutral burst fires once after the grace window');
    assert.ok(late.neutral, 'neutral burst present');
    pass('stale prev lastWicket does not type a fresh wicket');
  } catch (e) { fail('stale prev lastWicket does not type a fresh wicket', e.message); }

  // ====== BACKFILL: FROZEN SEQ + WICKET BUMP MUST NEVER TYPE OLD lastWicket ======
  try {
    await resetScorecard(800);
    const frozenPrev = baseline('83/4', ['1', 'lb'], 78); // Cricbuzz Test: ballNbr can freeze
    frozenPrev.lastWicket = 'Rohit Sharma lbw b Zampa 12 (20)'; // PREVIOUS wicket's text
    await evalScore(frozenPrev);
    await evalScore(baseline('83/5', ['1', 'lb', 'W'], 78)); // fresh wicket, seq frozen-equal
    await evalScore(baseline('83/5', ['1', 'lb', 'W'], 78)); // follow-up poll, text still lagging
    const mid = await page.evaluate(() => ({
      count: __animFireCount,
      lbw: document.getElementById('scorecard').classList.contains('sc-cricket-lbw'),
      neutral: document.getElementById('scorecard').classList.contains('sc-cricket-wicket'),
    }));
    assert.strictEqual(mid.count, 0, 'no burst fired yet');
    assert.strictEqual(mid.lbw, false, 'old lastWicket text must never type a fresh dismissal');
    assert.strictEqual(mid.neutral, false, 'still waiting for the real how-out text');
    await page.waitForTimeout(1200);
    const late = await page.evaluate(() => ({ count: __animFireCount, neutral: document.getElementById('scorecard').classList.contains('sc-cricket-wicket') }));
    assert.strictEqual(late.count, 1, 'neutral burst fires exactly once after grace');
    assert.ok(late.neutral, 'neutral burst present (unknown dismissal type)');
    pass('frozen-seq wicket bump never types stale lastWicket text');
  } catch (e) { fail('frozen-seq wicket bump never types stale lastWicket text', e.message); }

  // ====== WICKET: SAME SEQ + NEW TEXT AFTER COOLDOWN MUST NOT RE-FIRE, NEW SEQ MAY ======
  try {
    await resetScorecard(150);
    await evalScore(baseline('83/4', ['1', 'lb'], 78));
    await evalScore(baseline('83/5', ['1', 'lb', 'W'], 79));
    await page.waitForTimeout(400);
    assert.strictEqual(await page.evaluate(() => __animFireCount), 1, 'first wicket animated');
    await page.evaluate(() => { _wicketFire.at = Date.now() - 25000; }); // age past the 20s cooldown
    const echo = baseline('83/5', ['1', 'lb', 'W'], 79);
    echo.lastWicket = 'Marcus Stoinis caught 10 (8)';
    await evalScore(echo); // same ball, new how-out text, cooldown long gone
    await page.waitForTimeout(100);
    assert.strictEqual(await page.evaluate(() => __animFireCount), 1, 'same-ball late text must not re-fire');
    const next = baseline('83/5', ['1', 'lb', 'W', 'W'], 80);
    next.lastWicket = 'Marcus Stoinis caught 10 (8)';
    await evalScore(next); // genuinely NEW ball, same count, aged cooldown, changed text
    await page.waitForTimeout(100);
    assert.strictEqual(await page.evaluate(() => __animFireCount), 2, 'new ball with changed text re-fires');
    pass('wicket re-fire is gated on the ball seq, not just the cooldown');
  } catch (e) { fail('wicket re-fire is gated on the ball seq, not just the cooldown', e.message); }

  // ====== WICKET: A SECOND WICKET INSIDE THE GRACE WINDOW STILL FIRES ======
  try {
    await resetScorecard(300);
    await evalScore(baseline('83/4', ['1', 'lb'], 78));
    await evalScore(baseline('83/5', ['1', 'lb', 'W'], 79)); // wicket 1: parked, type unknown
    await evalScore(baseline('83/6', ['1', 'lb', 'W', 'W'], 80)); // wicket 2 lands inside the window
    await page.waitForTimeout(700);
    const count = await page.evaluate(() => __animFireCount);
    assert.strictEqual(count, 2, 'both dismissals must animate, never one dropped');
    pass('a second wicket inside the grace window still fires its own animation');
  } catch (e) { fail('a second wicket inside the grace window still fires its own animation', e.message); }

  // ====== WICKET: SEQ-ABSENT SOURCES (CRICBUZZ/CFLL TEST PATH) STILL FIRE ======
  try {
    await resetScorecard(150);
    await evalScore(baseline('83/4', ['1', 'lb'], 78));
    await evalScore(baseline('83/5', ['1', 'lb', 'W'], 79));
    await page.waitForTimeout(400);
    assert.strictEqual(await page.evaluate(() => __animFireCount), 1, 'first wicket animated');
    await page.evaluate(() => { _wicketFire.at = Date.now() - 25000; }); // age past the 20s cooldown
    const staleSeq = baseline('83/5', ['W'], null); // provider dropped the delivery marker
    staleSeq.lastWicket = 'Marcus Stoinis caught 10 (8)';
    await evalScore(staleSeq); // over changed, count same, text changed, seq unknowable
    await page.waitForTimeout(100);
    assert.strictEqual(await page.evaluate(() => __animFireCount), 2, 'a genuine wicket must not be swallowed when seq is unavailable');
    pass('wicket re-fire still works when the delivery seq is unavailable');
  } catch (e) { fail('wicket re-fire still works when the delivery seq is unavailable', e.message); }

  // ====== BACKFILL: MISSING SEQ ON EITHER SIDE PREVENTS GLUE ======
  try {
    await resetScorecard(150);
    await evalScore(baseline('83/4', ['1', 'lb'], 78));
    const noSeq = baseline('84/4', ['1', 'lb', '1'], 79);
    delete noSeq.lastBallSeq; // delivery marker lost (feed hiccup)
    delete noSeq.batsmen; delete noSeq.bowler;
    await evalScore(noSeq);
    const bm = await page.evaluate(() => document.querySelectorAll('.sc-bm').length);
    assert.strictEqual(bm, 0, 'unprovable delivery identity must not glue stale batters');
    pass('missing delivery seq prevents stale player glue');
  } catch (e) { fail('missing delivery seq prevents stale player glue', e.message); }

  // ====== SUMMARY ======
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.log('Failed tests:');
    results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.name}: ${r.err}`));
  }
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error('Test error:', err); process.exit(1); });
