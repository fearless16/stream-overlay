// Real-time 60Hz-target report. No fake clock, screenshots or recording during
// measurement. Host scheduling/compositor/OBS drops are separate from JS cost.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {setTimeout:delay} = require('node:timers/promises');
const OUT=path.join(process.env.LOCALAPPDATA,'Temp/opencode/money-fx-review-v5');
(async()=>{
  const {launch}=await import('puppeteer');
  const browser=await launch({headless:true,args:['--no-sandbox']});
  const reports=[];
  try {
    const page=await browser.newPage(); const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.setViewport({width:1920,height:1080});
    await page.goto(pathToFileURL(path.resolve('money-fx/preview.html')).href);
    await page.addStyleTag({content:'.controls,details,.camera span{display:none!important}'});
    await page.evaluate(()=>{
      window.__gaps=[];window.__slow=[];window.__origin=0;window.__running=false;
      let last;
      function sample(now){if(__running&&last!==undefined){__gaps.push(now-last);if(now-last>20)__slow.push({atSeconds:(now-__origin)/1000,gapMs:now-last});}last=now;requestAnimationFrame(sample);}
      requestAnimationFrame(sample);
    });
    await delay(1000);
    for(let run=0;run<2;run++){
      const before=await page.metrics();
      await page.evaluate(()=>{__gaps=[];__slow=[];__origin=performance.now();__running=true;MoneyFX.play({name:'Rahul Sharma',amount:'₹500'});});
      await delay(15200);
      const result=await page.evaluate(()=>{__running=false;const gaps=__gaps.slice().sort((a,b)=>a-b);return {scene:MoneyFX.status(),samples:gaps.length,p95Gap:gaps[Math.floor(gaps.length*.95)],maxGap:Math.max(...gaps),gapsOver20ms:gaps.filter(n=>n>20).length,slowFrames:__slow,domNodes:document.querySelectorAll('*').length};});
      const after=await page.metrics();
      result.cpuTaskSeconds=after.TaskDuration-before.TaskDuration;
      result.layoutCount=after.LayoutCount-before.LayoutCount;
      result.heapDelta=after.JSHeapUsedSize-before.JSHeapUsedSize;
      assert.equal(result.scene.reason,'complete');assert.equal(result.scene.activeNotes,0);assert.equal(result.scene.raf,false);
      assert.ok(result.scene.releaseCount>=64);assert.ok(result.scene.p95RenderMs<8,'JS rendering p95 must stay below half a 60Hz frame');
      assert.ok(result.scene.peakNotes<=34,'Particle load stays bounded');
      reports.push(result);
    }
    assert.equal(reports[0].domNodes,reports[1].domNodes,'No scene DOM growth');assert.deepEqual(errors,[]);
    fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'performance-results.json'),JSON.stringify(reports,null,2));
    console.log(JSON.stringify(reports.map(({scene,...r})=>({...r,p95RenderMs:scene.p95RenderMs,maxRenderMs:scene.maxRenderMs,peakNotes:scene.peakNotes})),null,2));
    if(reports.some(r=>r.gapsOver20ms)) console.warn('WARNING: browser scheduling gaps exceeded 20ms; do not interpret the JS-budget pass as zero dropped frames. See performance-results.json.');
    console.log('PASS bounded workload, JS frame budget, cleanup and stable DOM. Frame-gap report is browser-only, not OBS verification.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
