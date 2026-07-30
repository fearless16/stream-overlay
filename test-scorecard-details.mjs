import { chromium } from 'playwright';
import { strict as assert } from 'assert';

const HTML_PATH = 'file:///' + process.cwd().replace(/\\/g, '/') + '/chat-overlay.html';
const DATA_URI_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.goto(HTML_PATH, { waitUntil: 'networkidle', timeout: 15000 });

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
  async function resetScorecard() {
    await page.evaluate(() => {
      if (window._cricketAnimTimer) { clearTimeout(window._cricketAnimTimer); window._cricketAnimTimer = null; }
      document.getElementById('scorecard').className = '';
      document.getElementById('sc-anim-layer').classList.remove('active');
      window.currentScore = null;
    });
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
