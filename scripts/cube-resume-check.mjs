import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Quaternion, Vector3 } from 'three';
import { freshProgress, saveSlot, THEMES, currentFace, currentTheme } from '../src/progress.js';
import { homeQuaternion, faceQuaternion } from '../src/cube-scene.js';

const browser=await chromium.launch({executablePath:process.env.PUZZLE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const base=process.env.PUZZLE_TEST_URL||'http://127.0.0.1:5173';
const idle=p=>p.waitForFunction(()=>window.__game?.idle());
const state=p=>p.evaluate(()=>window.__game.state());
const makeProgress=(desserts,animals=0)=>{
  const p=freshProgress();p.completed[0].fill(true,0,desserts);p.completed[1].fill(true,0,animals);return p;
};
async function checkRotatedEntry(page, completed) {
  const before=await state(page);
  await page.mouse.move(180,410);await page.mouse.down();await page.mouse.move(325,410,{steps:12});await page.mouse.up();
  const {quaternion}=await page.evaluate(()=>window.__game.cubePose());
  const pose=new Quaternion().fromArray(quaternion);
  const [front,side]=Array.from({length:6},(_,face)=>({
    face,depth:new Vector3(0,0,1).applyQuaternion(faceQuaternion(face).invert()).applyQuaternion(pose).z,
  })).sort((left,right)=>right.depth-left.depth);
  assert.notEqual(front.face,before.face,'drag puts a different face in front');
  assert.ok(side.depth>.2,'a side face is still visible');
  const spot=await page.evaluate(face=>window.__game.tileCenter(0,face),completed?side.face:front.face);
  await page.touchscreen.tap(spot.x,spot.y);await idle(page);
  const after=await state(page),expected=completed?front.face:before.face;
  assert.equal(after.mode,'chapters');
  assert.equal(after.face,expected,completed?'completed cubes enter the face toward the viewer, not the tapped side':'unfinished cubes still enter the progress face');
  const entered=await page.evaluate(()=>window.__game.cubePose());
  assert.ok(new Quaternion().fromArray(entered.quaternion).angleTo(faceQuaternion(expected))<1e-6);
  await page.tap('#back');await idle(page);
}
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
    const adjacent=[c.theme-1,c.theme+1].map(index=>(index+THEMES.length)%THEMES.length);
    const neighborFronts=adjacent.filter(index=>!THEMES[index].comingSoon).flatMap(index=>{
      const pose=homeQuaternion(currentFace(c.progress,index));
      return THEMES[index].faceArt.filter((_,face)=>new Vector3(0,0,1).applyQuaternion(faceQuaternion(face).invert()).applyQuaternion(pose).z>.04);
    });
    const allowed=new Set([...THEMES[c.theme].faceArt,...neighborFronts]);
    assert.ok(images.every(value=>{
      const url=new URL(value);
      return url.pathname==='/src/cube-previews.webp'||url.pathname.includes('/ui/guide-hand.webp')||allowed.has(url.pathname+url.search);
    }),`${c.name}: full covers are limited to the current cube and neighboring fronts`);
    await p.screenshot({path:`test-results/cube-resume-${c.name}.png`});
    await p.tap('#enter');await idle(p);
    s=await state(p);assert.equal(s.theme,c.theme);assert.equal(s.face,c.face);assert.equal(s.mode,'chapters');
    const entered=await p.evaluate(()=>window.__game.cubePose());
    assert.ok(entered.quaternion.every((v,i)=>Math.abs(v-faceQuaternion(c.face).toArray()[i])<1e-9));
    await p.tap('#back');await idle(p);
    if(c.name==='dessert')await checkRotatedEntry(p,false);
    if(c.name==='continent-unlocked'){
      await p.tap('[data-theme="1"]');await idle(p);
      await checkRotatedEntry(p,true);
    }
    if(c.theme===1){await p.tap('[data-theme="0"]');await idle(p);}
    await p.reload();await idle(p);
    s=await state(p);assert.equal(s.theme,c.theme,'browsing an earlier cube does not replace actual progress on reload');assert.equal(s.face,c.face);
    for(const [key,value] of Object.entries(entries))if(key!==saveSlot(c.search))assert.equal(await p.evaluate(key=>localStorage.getItem(key),key),value,'other save slots remain intact');
    assert.equal(currentTheme(s.progress),c.theme);assert.equal(currentFace(s.progress,c.theme),c.face);
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log('PASS: progress-face entry for unfinished cubes, front-face entry for completed cubes, bounded face preloads, reload and independent trial slots.');
} finally {await browser.close();}
