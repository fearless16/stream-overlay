const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');
const { WebSocketServer } = require('ws');
const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS = path.join(process.env.LOCALAPPDATA || ROOT, 'Temp', 'opencode', 'money-fx-review');

const virtualClock = require('./helpers/animation-clock.cjs');

(async () => {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const httpServer = http.createServer((req, res) => {
    const file = path.join(ROOT, new URL(req.url, 'http://localhost').pathname);
    const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png' };
    try { res.setHeader('Content-Type', types[path.extname(file)] || 'text/plain'); res.end(fs.readFileSync(file)); }
    catch (_) { res.writeHead(404); res.end(); }
  });
  await new Promise(r => httpServer.listen(0, '127.0.0.1', r));
  const wsServer = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise(r => wsServer.on('listening', r));
  wsServer.on('connection', socket => socket.send(JSON.stringify({ type:'connected' })));
  const wsUrl = `ws://127.0.0.1:${wsServer.address().port}`;
  const base = `http://127.0.0.1:${httpServer.address().port}`;
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.launch({ headless:true, args:['--no-sandbox'] });
  const errors = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width:1920, height:1080 });
    page.on('pageerror', err => errors.push(err.message));
    await page.setRequestInterception(true);
    page.on('request', req => /^https:/.test(req.url()) ? req.abort() : req.continue());
    await page.evaluateOnNewDocument(virtualClock);
    await page.goto(`${base}/chat-overlay.html?ws=${encodeURIComponent(wsUrl)}`, { waitUntil:'load' });
    await delay(100);
    const send = async data => {
      for (const socket of wsServer.clients) socket.send(JSON.stringify(data));
      await delay(60);
    };
    const tick = ms => page.evaluate(ms => window.__advance(ms), ms);
    await tick(4500); // finish original sticker's warm-up before assertions
    await page.evaluate(() => {
      window.__events = [];
      document.addEventListener('animation-stage', e => __events.push({ ...e.detail, at:performance.now() }));
    });
    await send({ type:'youtube-chat', msgType:'superchat', id:'paid-a', name:'Rahul शर्मा', amount:'₹500', text:':disgusting:' });
    assert.equal(await page.evaluate(() => AnimationStage.status().active), 'superchat-money');
    assert.equal(await page.evaluate(() => StickerFX.isBusy()), false);
    await tick(3300);
    assert.equal(await page.evaluate(() => document.querySelector('.mfx-name').textContent), 'Rahul शर्मा');
    assert.equal(await page.evaluate(() => document.querySelector('.mfx-amount').textContent), '₹500');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#money-fx')).backgroundColor), 'rgba(0, 0, 0, 0)');
    assert.ok(await page.evaluate(() => MoneyFX.status().activeNotes > 0));
    assert.equal(await page.evaluate(() => {
      const c=document.querySelector('#money-fx canvas');
      return c.getContext('2d').getImageData(700,100,1,1).data[3];
    }), 0);
    await page.screenshot({ path:path.join(ARTIFACTS, 'integrated-money.png'), omitBackground:true });
    await send({ type:'youtube-chat', msgType:'superchat', id:'paid-a', name:'Duplicate', amount:'₹500' });
    await send({ type:'youtube-chat', msgType:'superchat', id:'old', isHistory:true, name:'History', amount:'₹1000' });
    assert.equal(await page.evaluate(() => AnimationStage.status().queued), 0);
    await page.evaluate(() => {
      triggerLikeAnimation('Like viewer', 22);
      triggerMemberJoin('Member viewer');
      showNewUserAlert('New viewer');
      _triggerCricketAnim(document.getElementById('scorecard'), '6');
      _triggerMilestoneAnim(document.getElementById('scorecard'), '50', 'Batter');
      StickerFX.play({name:'Emoji viewer'});
      MoneyFX.play({name:'International donor',amount:'US$10.00'});
    });
    assert.equal(await page.evaluate(() => AnimationStage.status().queued), 7);
    await tick(11680);
    assert.equal(await page.evaluate(() => MoneyFX.status().playing), true);
    await tick(101);
    assert.equal(await page.evaluate(() => AnimationStage.status().active), 'like');
    for (let i=0;i<70;i++) {
      await tick(1000);
      const activeCount = await page.evaluate(() => [
        MoneyFX.status().playing, StickerFX.isBusy(),
        document.getElementById('like-overlay').classList.contains('active'),
        document.getElementById('member-join-overlay').classList.contains('active'),
        document.getElementById('user-alert-overlay').classList.contains('active'),
        document.getElementById('sc-anim-layer').classList.contains('active'),
        document.getElementById('sc-ms-layer').classList.contains('active'),
      ].filter(Boolean).length);
      assert.ok(activeCount <= 1, 'No celebration layers overlap');
    }
    const events = await page.evaluate(() => __events.filter(e => e.type==='start').map(e=>e.kind));
    assert.deepEqual(events, ['superchat-money','like','membership','new-viewer','cricket-6','milestone-50','sticker','superchat-money']);
    assert.equal(await page.evaluate(() => AnimationStage.status().active), null);
    assert.equal(await page.evaluate(() => MoneyFX.status().raf), false);
    assert.equal(await page.evaluate(() => MoneyFX.status().activeNotes), 0);
    console.log('PASS live WS dispatch, donor/currency, transparency, exact 15s lifetime, mixed FIFO, no overlap, cleanup');

    await page.evaluate(() => {
      MoneyFX.play({name:'First'}); MoneyFX.play({name:'Second'});
      document.getElementById('brb-overlay').classList.add('active');
    });
    await delay(10);
    assert.equal(await page.evaluate(() => MoneyFX.status().playing), false);
    assert.equal(await page.evaluate(() => AnimationStage.status().queued), 1);
    await tick(30000);
    assert.equal(await page.evaluate(() => AnimationStage.status().active), null);
    await page.evaluate(() => document.getElementById('brb-overlay').classList.remove('active'));
    await delay(10);
    assert.equal(await page.evaluate(() => AnimationStage.status().active), 'superchat-money');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => AnimationStage.status().queued), 0);
    assert.equal(await page.evaluate(() => MoneyFX.status().raf), false);
    await page.evaluate(() => { MoneyFX.play({name:'Reset'}); resetAll(); });
    assert.equal(await page.evaluate(() => AnimationStage.status().active), null);
    await page.evaluate(() => {
      _triggerCricketAnim(document.getElementById('scorecard'), '6');
      AnimationStage.cancelAll();
      _triggerMilestoneAnim(document.getElementById('scorecard'), '50', 'Batter');
      AnimationStage.cancelAll();
      triggerLikeAnimation('Cancel during fade');
      __advance(6600);
      AnimationStage.cancelAll();
      triggerLikeAnimation('Next like');
      __advance(700);
    });
    assert.equal(await page.evaluate(() => document.getElementById('like-overlay').classList.contains('active')), true);
    await page.evaluate(() => AnimationStage.cancelAll());
    await tick(3000);
    assert.equal(await page.evaluate(() => _scBurstTimers.size + _msBurstTimers.size), 0);
    console.log('PASS BRB pause/resume, Escape, Reset cleanup');

    await page.evaluate(() => {
      AnimationStage.enqueue('failure-test', () => { throw Error('Expected test failure'); }, 10);
      MoneyFX.play({name:'<img src=x onerror=alert(1)>',amount:'€20.00'});
    });
    assert.equal(await page.evaluate(() => AnimationStage.status().active), 'superchat-money');
    assert.equal(await page.evaluate(() => document.querySelector('.mfx-name img')), null);
    await tick(15100);
    assert.equal(await page.evaluate(() => document.querySelectorAll('#money-fx').length), 1);
    assert.equal(await page.evaluate(() => AnimationStage.status().stats.failed), 1);

    // Same-tab refresh and a restarted WS connection must not replay the ID.
    await page.reload({ waitUntil:'load' }); await delay(100); await tick(4500);
    await send({ type:'youtube-chat', msgType:'superchat', id:'paid-a', name:'Duplicate after refresh', amount:'₹500' });
    assert.equal(await page.evaluate(() => AnimationStage.status().active), null);
    for (const client of wsServer.clients) client.close();
    await delay(60); await tick(2200); await delay(100);
    await send({ type:'youtube-chat', msgType:'superchat', id:'paid-reconnected', name:'Reconnected', amount:'₹200' });
    assert.equal(await page.evaluate(() => AnimationStage.status().active), 'superchat-money');
    await page.evaluate(() => AnimationStage.cancelAll());
    console.log('PASS exception recovery, XSS-safe text, same-tab refresh dedupe, WS disconnect/reconnect');

    const stress = await page.evaluate(() => {
      for (let i=0;i<50000;i++) MoneyFX.handleChat({id:'chat-'+i,msgType:'chat',name:'Normal chat'});
      for (let i=0;i<2100;i++) {
        MoneyFX.handleChat({id:'stress-'+i,msgType:'superchat',name:'Paid'});
        AnimationStage.cancelAll();
      }
      // Six hours simulated: serial jobs must not leave timer/DOM growth.
      for (let i=0;i<2160;i++) {
        AnimationStage.enqueue('uptime', () => {}, 10000);
        __advance(10000);
      }
      MoneyFX.play({name:'Capacity active'});
      for (let i=0;i<1025;i++) AnimationStage.enqueue('capacity',()=>{},10);
      const full=AnimationStage.status(); AnimationStage.cancelAll(); __advance(1000);
      return {full, money:MoneyFX.status(),roots:document.querySelectorAll('#money-fx').length, jobs:__clockJobs()};
    });
    assert.equal(stress.full.queued, 1024); assert.equal(stress.full.stats.rejected, 1);
    assert.equal(stress.money.seen, 2000); assert.equal(stress.money.raf, false); assert.equal(stress.roots, 1);
    assert.equal(stress.jobs, 0);
    assert.deepEqual(errors, []);
    console.log('PASS 50,000 non-trigger messages, 2,100 donation cleanup cycles, 6h simulated queue uptime, bounded queue/dedupe/timers');

    // Real-time performance and file:// asset-loading smoke test, no fake clock.
    const real = await browser.newPage();
    await real.setViewport({width:1920,height:1080});
    real.on('pageerror',err=>errors.push(err.message));
    await real.goto(pathToFileURL(path.join(ROOT,'money-fx/preview.html')).href);
    const before=await real.metrics();
    await real.evaluate(()=>MoneyFX.play({name:'Rahul शर्मा',amount:'₹500'}));
    await delay(3600);
    await real.screenshot({path:path.join(ARTIFACTS,'money-shower.png')});
    await delay(11600);
    const actual=await real.evaluate(()=>({money:MoneyFX.status(),stage:AnimationStage.status()}));
    const after=await real.metrics();
    assert.equal(actual.money.playing,false); assert.equal(actual.stage.active,null);
    assert.ok(actual.money.frames > 100);
    assert.deepEqual(errors,[]);
    const report={actual,cpuTaskSeconds:after.TaskDuration-before.TaskDuration,heapDelta:after.JSHeapUsedSize-before.JSHeapUsedSize};
    fs.writeFileSync(path.join(ARTIFACTS,'browser-results.json'),JSON.stringify(report,null,2));
    console.log('PASS real-time 15-second file:// playback:',JSON.stringify(report));
    console.log('Review artifacts:',ARTIFACTS);
  } finally {
    await browser.close();
    for (const s of wsServer.clients) s.terminate();
    await new Promise(r=>wsServer.close(r)); await new Promise(r=>httpServer.close(r));
  }
})().catch(err=>{ console.error(err); process.exitCode=1; });
