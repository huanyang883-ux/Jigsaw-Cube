import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { freshProgress, saveSlot, THEMES, currentFace, currentTheme } from '../src/progress.js';
import { homeQuaternion, faceQuaternion } from '../src/cube-scene.js';

const browser=await chromium.launch({executablePath:process.env.PUZZLE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const base=process.env.PUZZLE_TEST_URL||'http://127.0.0.1:5173';
const idle=p=>p.waitForFunction(()=>window.__game?.idle());
const state=p=>p.evaluate(()=>window.__game.state());
const makeProgress=(desserts,animals=0)=>{
  const p=freshProgress();p.completed[0].fill(true,0,desserts);p.completed[1].fill(true,0,animals);return p;
};
await fs.mkdir('test-results',{recursive:true});
try {
  const cases=[
    {name:'fresh',search:'',progress:makeProgress(0),theme:0,face:0},
    {name:'dessert',search:'',progress:makeProgress(14),theme:0,face:3},
    {name:'animal',search:'',progress:makeProgress(24,20),theme:1,face:2},
    {name:'continent-unlocked',search:'',progress:makeProgress(24,54),theme:2,face:0},
    {name:'trial-first12',search:'?trial=first12',progress:makeProgress(24,1),theme:1,face:0},
    {name:'trial-all78',search:'?trial=all78',progress:makeProgress(24,29),theme:1,face:3},
  ];
  for(const c of cases) {
    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,reducedMotion:'reduce'});
    const entries=Object.fromEntries(['','?trial=first12','?trial=all78'].map(search=>[saveSlot(search),JSON.stringify(makeProgress(4))]));
    entries[saveSlot(c.search)]=JSON.stringify(c.progress);
    await context.addInitScript(entries=>{
      for(const [key,value] of Object.entries(entries))if(!localStorage.getItem(key))localStorage.setItem(key,value);
    },entries);
    const p=await context.newPage(),errors=[],images=[];
    p.on('pageerror',e=>errors.push(e.message));
    p.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Context Lost'))errors.push(m.text());});
    p.on('request',r=>{if(r.url().includes('.webp'))images.push(r.url());});
    await p.goto(`${base}/${c.search}`);await idle(p);
    let s=await state(p);
    assert.equal(s.mode,'home');assert.equal(s.theme,c.theme);assert.equal(s.face,c.face);
    assert.equal(await p.locator('.viewport').getAttribute('data-theme'),String(c.theme));
    assert.equal(await p.locator(`[data-theme="${c.theme}"].theme-page`).getAttribute('aria-pressed'),'true');
    const pose=await p.evaluate(()=>window.__game.cubePose());
    assert.ok(pose.quaternion.every((v,i)=>Math.abs(v-homeQuaternion(c.face).toArray()[i])<1e-9),`${c.name}: current chapter faces the viewer on the first home frame`);
    const revealed=await p.evaluate(()=>window.__game.revealed());
    assert.equal(revealed.length,c.progress.completed[c.theme].filter(Boolean).length);
    const chapterNames=THEMES[c.theme].chapters.map(ch=>ch.id);
    assert.ok(images.every(url=>url.includes('/ui/guide-hand.webp')||chapterNames.some(id=>url.includes(`/assets/${id}-`))),`${c.name}: only current theme images load at startup`);
    await p.screenshot({path:`test-results/cube-resume-${c.name}.png`});
    await p.tap('#enter');await idle(p);
    s=await state(p);assert.equal(s.theme,c.theme);assert.equal(s.face,c.face);assert.equal(s.mode,'chapters');
    const entered=await p.evaluate(()=>window.__game.cubePose());
    assert.ok(entered.quaternion.every((v,i)=>Math.abs(v-faceQuaternion(c.face).toArray()[i])<1e-9));
    await p.tap('#back');await idle(p);
    if(c.theme===1){await p.tap('[data-theme="0"]');await idle(p);}
    await p.reload();await idle(p);
    s=await state(p);assert.equal(s.theme,c.theme,'browsing an earlier cube does not replace actual progress on reload');assert.equal(s.face,c.face);
    for(const [key,value] of Object.entries(entries))if(key!==saveSlot(c.search))assert.equal(await p.evaluate(key=>localStorage.getItem(key),key),value,'other save slots remain intact');
    assert.equal(currentTheme(s.progress),c.theme);assert.equal(currentFace(s.progress,c.theme),c.face);
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log('PASS: current cube/chapter on first home frame, matching background and reveals, current-theme preloads, chapter entry, reload, complete saves and independent trial slots.');
} finally {await browser.close();}
