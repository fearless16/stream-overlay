/* Geometry/motion assertions plus a multi-beat visual review sheet. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');
const virtualClock = require('./helpers/animation-clock.cjs');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(process.env.LOCALAPPDATA || ROOT, 'Temp/opencode/money-fx-review-v5');
(async () => {
  fs.mkdirSync(OUT, { recursive:true });
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.launch({headless:true,args:['--no-sandbox']});
  const errors=[];
  try {
    // Capture the actual existing alert visual language, not an invented mock.
    const reference=await browser.newPage(); await reference.setViewport({width:1920,height:1080});
    await reference.setRequestInterception(true);
    reference.on('request',r=>r.url().startsWith('https:')?r.abort():r.continue());
    await reference.evaluateOnNewDocument(()=>{ window.WebSocket=class { close(){} }; });
    await reference.goto(pathToFileURL(path.join(ROOT,'chat-overlay.html')).href);
    await reference.evaluate(()=>triggerLikeAnimation('Rahul Sharma', 500)); await delay(1250);
    await reference.screenshot({path:path.join(OUT,'reference-like.png')});
    await reference.evaluate(()=>{AnimationStage.cancelAll();showNewUserAlert('Rahul Sharma');}); await delay(900);
    await reference.screenshot({path:path.join(OUT,'reference-viewer.png')});
    await reference.evaluate(()=>{AnimationStage.cancelAll();triggerMemberJoin('Rahul Sharma');}); await delay(1800);
    await reference.screenshot({path:path.join(OUT,'reference-member.png')});
    await reference.close();

    const page=await browser.newPage(); await page.setViewport({width:1920,height:1080});
    page.on('pageerror',e=>errors.push(e.message));
    await page.evaluateOnNewDocument(virtualClock);
    await page.goto(pathToFileURL(path.join(ROOT,'money-fx/preview.html')).href);
    await page.addStyleTag({content:'.controls,details,.camera span{display:none!important}'});
    await page.evaluate(()=>MoneyFX.play({name:'Rahul Sharma',amount:'₹500'}));
    const samples=[0,.35,.75,1.25,1.72,2.18,2.22,2.34,2.38,3.35,4.5,6.4,9.95,11.2,12.6,13.2,14.2,15.1];
    const shots=[]; let now=0;
    for(const t of samples){
      await page.evaluate(ms=>__advance(ms),(t-now)*1000); now=t;
      if(t===2.22 || t===2.34 || t===2.38) {
        const hand=await page.evaluate(()=>{
          const actor=document.querySelector('.mfx-actor'), wrist=actor.querySelector('.mfx-wrist');
          const p=actor.querySelector('svg').createSVGPoint(); p.x=27;p.y=-16;
          const q=p.matrixTransform(wrist.getScreenCTM());
          const local=q.matrixTransform(actor.querySelector('.mfx-gaddi').getScreenCTM().inverse());
          return {x:q.x,y:q.y,u:local.x,v:local.y,detachedNotes:actor.querySelectorAll('.mfx-right-flick image').length,status:MoneyFX.status()};
        });
        assert.equal(hand.detachedNotes,0,'The right hand never holds a lifted note');
        assert.ok(Math.abs(hand.v-10)<.01,'Fingers drag on the top-sheet plane, not upward');
        if(t===2.22) { assert.ok(hand.u<20); assert.equal(hand.status.releaseCount,0); }
        if(t===2.34) assert.ok(hand.u>30&&hand.u<73,'Right fingers slide across bundle before release');
        if(t===2.38) {
          assert.equal(hand.status.releaseCount,2);
          const origins=await page.evaluate(()=>[...document.querySelectorAll('.mfx-actor')].map((actor,i)=>{
            const p=actor.querySelector('svg').createSVGPoint();p.x=76;p.y=10;
            const q=p.matrixTransform(actor.querySelector('.mfx-gaddi').getScreenCTM());
            const r=MoneyFX.status().releases[i];return Math.hypot(q.x-r.x,q.y-r.y);
          }));
          assert.ok(origins.every(error=>error<1),'Launch originates at the actual bundle edge, not the raised hand');
        }
      }
      if(t===3.35){
        const geometry=await page.evaluate(()=>{
          const r=document.querySelector('.mfx-name').getBoundingClientRect();
          const a=document.querySelector('.mfx-actor').getBoundingClientRect();
          const foot=document.querySelector('.mfx-leg-a path:nth-child(4)');
          const p=foot.ownerSVGElement.createSVGPoint();p.x=113;p.y=497;
          const f=p.matrixTransform(foot.getScreenCTM());
          return {name:{cx:r.x+r.width/2,cy:r.y+r.height/2,width:r.width},actor:{height:a.height,width:a.width,footY:f.y},status:MoneyFX.status()};
        });
        assert.ok(Math.abs(geometry.name.cx-960)<4,'Donor must be centred on the full stream');
        assert.ok(Math.abs(geometry.name.cy-529)<100,'Donor name is near screen centre, not a footer');
        assert.ok(geometry.actor.height>=410&&geometry.actor.height<=425,'Characters are 20% larger');
        assert.ok(geometry.actor.footY>1040&&geometry.actor.footY<1075,'Feet stay near canvas bottom without clipping');
        assert.equal(geometry.status.duration,15000);
        assert.equal(geometry.status.directionErrors,0);
      }
      if(t===4.5){
        const noteProof=await page.evaluate(()=>{
          const c=document.querySelector('#money-fx canvas'), p=c.getContext('2d');
          const glow=p.getImageData(300,880,1,1).data;
          return {topAlpha:p.getImageData(960,20,1,1).data[3],cornerAlpha:p.getImageData(5,5,1,1).data[3],glow:[...glow]};
        });
        assert.equal(noteProof.topAlpha,0);assert.equal(noteProof.cornerAlpha,0);
        assert.ok(noteProof.glow[3]>0&&noteProof.glow[3]<80,'Backdrop is visible but translucent');
        assert.ok(noteProof.glow[1]>noteProof.glow[0],'Backdrop is emerald');
      }
      const file=path.join(OUT,`scene-${String(Math.round(t*1000)).padStart(5,'0')}.png`);
      await page.screenshot({path:file}); shots.push({t,file,url:pathToFileURL(file).href});
    }
    const status=await page.evaluate(()=>MoneyFX.status());
    assert.ok(status.releaseCount>=64); assert.equal(status.directionErrors,0);
    const cleared=await page.evaluate(()=>[...document.querySelector('#money-fx canvas').getContext('2d').getImageData(300,880,1,1).data]);
    assert.equal(cleared[3],0,'Lighting clears after completion');
    assert.ok(status.releases.every(r=>r.hand==='right'&&r.count===1&&r.source==='bundle-edge'),'One note flicked directly from each bundle');
    assert.deepEqual(status.rigs.map(r=>[r.gripHand,r.flickHand,r.shoulderX]),[['left','right',116],['left','right',116]]);
    const left=status.releases.filter(r=>r.side==='left'),right=status.releases.filter(r=>r.side==='right');
    assert.deepEqual(left.map(r=>r.at),right.map(r=>r.at),'Both men release simultaneously');
    assert.ok(left.slice(1).every((r,i)=>r.at-left[i].at<.37),'Continuous rapid shower');
    assert.equal(status.playing,false); assert.equal(status.raf,false); assert.equal(status.activeNotes,0);
    assert.ok(status.releases.every(r=>r.side==='left'?r.x<r.targetX:r.x>r.targetX));
    // Every release is inward/upward from the aimed bundle, not a thrown lifted note.
    assert.ok(status.releases.every(r=>r.y>r.targetY+30));
    assert.ok(new Set(status.releases.map(r=>r.targetY)).size===5,'Face, cheeks and shoulder lanes');
    const leftTimes=status.releases.filter(r=>r.side==='left').map(r=>r.at);
    const gaps=leftTimes.slice(1).map((t,i)=>({at:t,gap:t-leftTimes[i]}));
    assert.ok(gaps.some(g=>g.at>10.8&&g.gap<.27),'Finale changes pace');
    await page.evaluate(()=>MoneyFX.play({name:'बहुत लम्बा नाम '.repeat(10),amount:'US$1,000.00'}));
    await page.evaluate(()=>__advance(3500));
    const longName=await page.evaluate(()=>{
      const r=document.querySelector('.mfx-name').getBoundingClientRect();
      return {left:r.left,right:r.right,bottom:r.bottom};
    });
    assert.ok(longName.left>=0&&longName.right<=1920&&longName.bottom<950,'Long names stay visible');
    await page.evaluate(()=>AnimationStage.cancelAll());
    const strokeProof=await page.evaluate(()=>{
      MoneyFX.play({name:'Full stroke geometry',amount:'₹500'});__advance(2150);
      let maxPlaneError=0,minU=Infinity,maxU=-Infinity,matchingArms=true;
      for(let i=0;i<60;i++){
        __advance(1000/60);
        for(const a of document.querySelectorAll('.mfx-actor')){
          const p=a.querySelector('svg').createSVGPoint();p.x=27;p.y=-16;
          const q=p.matrixTransform(a.querySelector('.mfx-wrist').getScreenCTM()).matrixTransform(a.querySelector('.mfx-gaddi').getScreenCTM().inverse());
          maxPlaneError=Math.max(maxPlaneError,Math.abs(q.y-10));minU=Math.min(minU,q.x);maxU=Math.max(maxU,q.x);
        }
        const poses=[...document.querySelectorAll('.mfx-actor')].map(a=>({
          grip:[...a.querySelectorAll('.mfx-left-grip path')].map(p=>p.getAttribute('d')),
          arm:a.querySelector('.mfx-arm-outline').getAttribute('d'),
          sleeve:a.querySelector('.mfx-sleeve-outline').getAttribute('d'),
          wrist:a.querySelector('.mfx-wrist').getAttribute('transform'),
          fingers:a.querySelector('.mfx-hand').getAttribute('d'),
        }));
        matchingArms=matchingArms&&JSON.stringify(poses[0])===JSON.stringify(poses[1]);
      }
      AnimationStage.cancelAll();return {maxPlaneError,minU,maxU,matchingArms};
    });
    assert.ok(strokeProof.maxPlaneError<.01,'All stroke/return phases stay on the bundle surface');
    assert.ok(strokeProof.minU<16&&strokeProof.maxU>85,'Full drag and short follow-through, not a static tapping hand');
    assert.equal(strokeProof.matchingArms,true,'Right grip, elbow, wrist and fingers exactly match approved left geometry throughout flick cycles');
    const approved=await page.evaluate(()=>({grip:document.querySelector('.mfx-left-grip path').getAttribute('d'),hand:document.querySelector('.mfx-hand').getAttribute('d')}));
    assert.equal(approved.grip,'M182 220Q203 224 208 250L243 249');
    assert.equal(approved.hand,'M-11 0Q-6-10 3-8L12-9 25-18Q30-20 29-15L17-5 28-12Q33-12 30-7L17 4 21 5Q24 9 17 12L4 14Q-8 12-11 0Z');
    await page.setViewport({width:1280,height:720});
    await page.evaluate(()=>MoneyFX.play({name:'Scaled scene',amount:'€20'}));
    await page.evaluate(()=>__advance(3500));
    const cx=await page.evaluate(()=>{const r=document.querySelector('.mfx-name').getBoundingClientRect();return r.x+r.width/2;});
    assert.ok(Math.abs(cx-640)<4);
    await page.evaluate(()=>AnimationStage.cancelAll());
    const layoutFree=await page.evaluate(()=>{
      const box=Element.prototype.getBoundingClientRect,ctm=SVGGraphicsElement.prototype.getScreenCTM;
      Element.prototype.getBoundingClientRect=SVGGraphicsElement.prototype.getScreenCTM=()=>{throw Error('Layout read in hot loop');};
      try { MoneyFX.play({name:'No layout stalls',amount:'₹500'}); __advance(15100); return MoneyFX.status(); }
      finally {Element.prototype.getBoundingClientRect=box;SVGGraphicsElement.prototype.getScreenCTM=ctm;}
    });
    assert.equal(layoutFree.reason,'complete'); assert.ok(layoutFree.releaseCount>=64);
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(OUT,'scene-results.json'),JSON.stringify({status,longName,scaledCentre:cx},null,2));
    // Contact sheet renders the exact captured pixels, not a re-created scene.
    const sheet=await browser.newPage();await sheet.setViewport({width:1920,height:Math.ceil(shots.length/3)*385});
    await sheet.goto(pathToFileURL(path.join(ROOT,'money-fx/preview.html')).href);
    await sheet.setContent(`<body style="margin:0;background:#101820;color:#ffdf9b;font:18px Arial;display:grid;grid-template-columns:repeat(3,1fr)">${shots.map(s=>`<div style="padding:4px"><div>${s.t.toFixed(2)}s</div><img style="width:100%" src="${s.url}"></div>`).join('')}</body>`);
    await sheet.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
    await sheet.screenshot({path:path.join(OUT,'contact-sheet.png'),fullPage:true});
    console.log('PASS scene V5: bottom anchoring, larger matched rigs, approved hands, bundle-edge origin, 15s cinematic shower, translucent emerald lighting, centre/scaling, cleanup.');
    console.log('Review:',OUT);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
