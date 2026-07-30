import { chromium } from 'playwright';

const HTML = 'file:///' + process.cwd().replace(/\\/g, '/') + '/chat-overlay.html';

const ANIM_TESTS = [
  { cls: 'sc-cricket-4',     item: 'sc-anim-4',     label: 'FOUR' },
  { cls: 'sc-cricket-6',     item: 'sc-anim-6',     label: 'SIX!' },
  { cls: 'sc-cricket-bold',  item: 'sc-anim-bold',  label: 'BOWLED!' },
  { cls: 'sc-cricket-caught',item: 'sc-anim-caught', label: 'CAUGHT!' },
  { cls: 'sc-cricket-lbw',   item: 'sc-anim-lbw',   label: 'LBW!' },
  { cls: 'sc-cricket-runout',item: 'sc-anim-runout', label: 'RUN OUT!' },
];

let passed = 0;
let failed = 0;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(HTML, { waitUntil: 'networkidle' });

  // 1. Verify layer exists and hidden
  const layer = page.locator('#sc-anim-layer');
  await layer.waitFor({ state: 'attached' });
  const hidden = await layer.evaluate(el => !el.classList.contains('active'));
  if (!hidden) { console.log('FAIL: anim-layer should be hidden initially'); failed++; }
  else { console.log('PASS: anim-layer hidden initially'); passed++; }

  // 2. Verify scorecard starts hidden
  const scorecard = page.locator('#scorecard');
  await scorecard.waitFor({ state: 'attached' });

  // Show scorecard for testing
  await page.evaluate(() => {
    const sc = document.getElementById('scorecard');
    sc.classList.remove('hidden');
  });
  await page.waitForTimeout(200);

  // 3. Test each animation
  for (const t of ANIM_TESTS) {
    await page.evaluate(({ cls }) => {
      const sc = document.getElementById('scorecard');
      sc.classList.remove(
        'sc-cricket-4', 'sc-cricket-6', 'sc-cricket-bold',
        'sc-cricket-caught', 'sc-cricket-lbw', 'sc-cricket-runout'
      );
      document.getElementById('sc-anim-layer').classList.remove('active');
      void sc.offsetWidth;
      sc.classList.add(cls);
      document.getElementById('sc-anim-layer').classList.add('active');
    }, t);

    await page.waitForTimeout(100);

    const itemVisible = await page.evaluate(({ item }) => {
      const el = document.querySelector('.' + item);
      if (!el) return 'missing';
      const style = getComputedStyle(el);
      return style.display !== 'none' ? 'visible' : 'hidden';
    }, t);

    if (itemVisible === 'visible') {
      console.log(`PASS: ${t.label} (${t.cls}) displays`);
      passed++;
    } else {
      console.log(`FAIL: ${t.label} (${t.cls}) not visible (${itemVisible})`);
      failed++;
    }

    // Check layer is active
    const layerActive = await page.evaluate(() => {
      return document.getElementById('sc-anim-layer').classList.contains('active');
    });
    if (layerActive) {
      console.log(`PASS: ${t.label} layer active`);
      passed++;
    } else {
      console.log(`FAIL: ${t.label} layer not active`);
      failed++;
    }

    await page.waitForTimeout(1600);
  }

  // 4. Test JS wicket type detection
  const detectionTests = [
    { text: 'KL Rahul c Carey b Starc 12',     expect: 'caught' },
    { text: 'Smith b Bumrah 23',               expect: 'bold' },
    { text: 'Head lbw b Jadeja 45',            expect: 'lbw' },
    { text: 'Maxwell run out (Kohli) 12',      expect: 'runout' },
    { text: 'Marsh c Rahul b Shami 34',        expect: 'caught' },
    { text: 'Warner st Smith b Lyon 12',       expect: 'caught' },
    { text: 'Root hit wicket 45',              expect: 'bold' },
    { text: 'Anderson bowled Bumrah 0',        expect: 'bold' },
    { text: 'de Bruyn c Smith b Cummins 22',   expect: 'caught' },
    { text: null, expect: null },
    { text: '', expect: null },
    { text: 'Some random text', expect: null },
  ];

  for (const dt of detectionTests) {
    const result = await page.evaluate((text) => {
      const f = window._detectWicketType;
      if (!f) return 'FN_MISSING';
      return f(text);
    }, dt.text);

    if (result === dt.expect) {
      console.log(`PASS: _detectWicketType("${dt.text}") → ${result}`);
      passed++;
    } else {
      console.log(`FAIL: _detectWicketType("${dt.text}") → ${result} (expected ${dt.expect})`);
      failed++;
    }
  }

  // 5. Test _triggerCricketAnim on scorecard
  await page.evaluate(() => {
    const sc = document.getElementById('scorecard');
    window._triggerCricketAnim(sc, '6');
  });
  await page.waitForTimeout(100);
  const hasSix = await page.evaluate(() => {
    return document.getElementById('scorecard').classList.contains('sc-cricket-6');
  });
  if (hasSix) {
    console.log('PASS: _triggerCricketAnim with "6" adds sc-cricket-6');
    passed++;
  } else {
    console.log('FAIL: _triggerCricketAnim with "6" missing sc-cricket-6');
    failed++;
  }

  await page.waitForTimeout(1600);

  // 6. End-to-end test: send score data via WebSocket and verify animation triggers
  const { WebSocketServer } = await import('ws');
  const WS_PORT = 9876;
  const wss = new WebSocketServer({ port: WS_PORT });
  try {
    await new Promise(resolve => wss.once('listening', resolve));

    const wsPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await wsPage.goto(HTML + '?ws=ws://localhost:' + WS_PORT, { waitUntil: 'networkidle' });
    await wsPage.waitForTimeout(500);

    // Ensure scorecard is shown
    await wsPage.evaluate(() => {
      const sc = document.getElementById('scorecard');
      sc.classList.remove('hidden');
    });
    await wsPage.waitForTimeout(200);

    // Send FOUR via WS (ball 4, extending over)
    wss.clients.forEach(c => c.send(JSON.stringify({
      type: 'score',
      data: {
        teams: [
          { name: 'India', score: '100/2', overs: '12.0' },
          { name: 'Australia', score: '0/0', overs: '0.0' }
        ],
        batsmen: [{ name: 'A', runs: '50', balls: '40', striker: true }, { name: 'B', runs: '30', balls: '35' }],
        bowler: { name: 'Bowler', overs: '4.0', wickets: '1', runs: '20' },
        currentOver: ['·']
      }
    })));
    await wsPage.waitForTimeout(100);

    // Send score with new ball = 4 → should trigger FOUR
    wss.clients.forEach(c => c.send(JSON.stringify({
      type: 'score',
      data: {
        teams: [
          { name: 'India', score: '104/2', overs: '12.1' },
          { name: 'Australia', score: '0/0', overs: '0.0' }
        ],
        batsmen: [{ name: 'A', runs: '54', balls: '41', striker: true }, { name: 'B', runs: '30', balls: '35' }],
        bowler: { name: 'Bowler', overs: '4.1', wickets: '1', runs: '24' },
        currentOver: ['·', '4']
      }
    })));
    await wsPage.waitForTimeout(200);

    const hasFour = await wsPage.evaluate(() => {
      return document.getElementById('scorecard').classList.contains('sc-cricket-4');
    });

    if (hasFour) {
      console.log('PASS: WS score update triggers sc-cricket-4');
      passed++;
    } else {
      console.log('FAIL: WS score update did not trigger sc-cricket-4');
      failed++;
    }

    await wsPage.waitForTimeout(1800);
    await wsPage.close();
  } finally {
    wss.close();
  }

  await browser.close();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
