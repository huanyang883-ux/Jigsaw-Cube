import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sharp from 'sharp';

const browser = await chromium.launch({ executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const base = process.env.PUZZLE_TEST_URL || 'http://127.0.0.1:5173';
await fs.mkdir('test-results', {recursive:true});
try {
  const page = await browser.newPage({ viewport:{width:430,height:932}, deviceScaleFactor:2, reducedMotion:'reduce' });
  const errors=[];
  page.on('pageerror', e=>errors.push(e.message));
  page.on('console', m=>{if(m.type()==='error'&&!m.text().includes('Context Lost'))errors.push(m.text());});
  await page.goto(base); await page.waitForFunction(()=>window.__game?.idle());
  // A solid image makes any unwanted internal rim, clipped corner or shadow
  // visible as a pixel difference, independently of the puzzle artwork.
  await page.evaluate(async()=>{
    document.querySelector('#app').hidden=true;
    const {PuzzleRenderer}=await import('/src/renderer.js'); window.EdgeRenderer=PuzzleRenderer;
    const host=document.createElement('div'); host.id='edge-fixture';
    Object.assign(host.style,{position:'absolute',left:'15px',top:'15px',width:'400px',height:'400px',background:'#fffaf0'});
    const style=document.createElement('style'); style.textContent='#edge-fixture canvas{position:absolute;inset:0;width:100%;height:100%}'; document.head.append(style);
    document.body.append(host);
    window.makeEdgeFixture=async(n,aspect,positions)=>{
      window.edgeRenderer?.destroy(); host.replaceChildren(); host.style.height=`${400/aspect}px`;
      const canvas=document.createElement('canvas'); canvas.width=300; canvas.height=Math.round(300/aspect);
      const c=canvas.getContext('2d'); c.fillStyle='#346da3'; c.fillRect(0,0,canvas.width,canvas.height);
      const r=window.edgeRenderer=new PuzzleRenderer(host,positions??Array.from({length:n*n},(_,i)=>i),{onDrop(){},onReady(){}});
      await r.init(canvas.toDataURL());
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    };
  });
  const report=[];
  for(const n of [3,4,9]) for(const aspect of [1,.75]) {
    await page.evaluate(({n,aspect})=>window.makeEdgeFixture(n,aspect),{n,aspect});
    const png=await page.locator('#edge-fixture').screenshot({path:`test-results/card-edges-solved-${n}-${aspect}.png`});
    const {data,info}=await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const pixel=(x,y)=>Array.from(data.subarray((y*info.width+x)*3,(y*info.width+x)*3+3));
    const center=pixel(Math.floor(info.width/2),Math.floor(info.height/2));
    for(let y=Math.ceil(info.height*.12);y<info.height*.88;y+=2) for(let x=Math.ceil(info.width*.12);x<info.width*.88;x+=2) {
      assert.ok(pixel(x,y).every((value,c)=>Math.abs(value-center[c])<=1),`${n}x${n} image has no internal borders, shadows or corner pinholes`);
    }
    const metrics=await page.evaluate(()=>{
      const r=window.edgeRenderer, rect=r.host.getBoundingClientRect(), offset=.5-(r.size-1)/2;
      const screen=r.screen({x:offset,y:0}), event={clientX:rect.left+screen.x,clientY:rect.top+screen.y};
      const picked=r.hit(event);
      return {picked,draws:r.three.info.render.calls,triangles:r.three.info.render.triangles};
    });
    assert.notEqual(metrics.picked,undefined,'an invisible join is still draggable');
    assert.ok(metrics.draws<=n*n*5,'rounded rims and soft shadows require no extra mesh passes');
    report.push({n,aspect,...metrics});
  }
  // Adjacent but incorrect tiles must keep their own rounded border.
  await page.evaluate(()=>window.makeEdgeFixture(3,1,[8,7,6,5,4,3,2,1,0]));
  const single=await page.locator('#edge-fixture').screenshot({path:'test-results/card-edges-unjoined.png'});
  const {data,info}=await sharp(single).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const pixel=(x,y)=>Array.from(data.subarray((y*info.width+x)*3,(y*info.width+x)*3+3));
  const unit=info.width/3.18, left=info.width/2-1.489*unit, top=info.height/2-1.489*unit;
  const middle=pixel(Math.round(left+unit*.4),Math.round(top+unit*.4));
  const corner=pixel(Math.ceil(left+unit*.005),Math.ceil(top+unit*.005));
  const rim=pixel(Math.round(left+unit*.008),Math.round(top+unit*.4));
  assert.ok(corner.reduce((a,b)=>a+b)>middle.reduce((a,b)=>a+b)+100,'corner cuts back to the pale board instead of a square photo');
  assert.ok(rim.reduce((a,b)=>a+b)>middle.reduce((a,b)=>a+b)+80,'a thin light rim separates loose cards');

  // Exercise the actual rasterized contour across all three meshes at an
  // inside corner. Rectangular solved groups cannot reveal this regression.
  const cornerFixtures = [
    ...[0,1,3,4].map(missing=>({name:`L-${missing}`,n:3,ids:[0,1,3,4].filter(id=>id!==missing)})),
    {name:'T',n:4,ids:[1,4,5,6]},
    {name:'stairs',n:4,ids:[0,1,5,6,10,11]},
    {name:'hole',n:4,ids:[0,1,2,4,6,8,9,10]},
  ];
  for (const fixture of cornerFixtures) for (const aspect of [1,.75,1.5]) {
    const {n,ids,name}=fixture, positions=Array.from({length:n*n},(_,id)=>id);
    const rest=positions.filter(id=>!ids.includes(id));
    rest.forEach((id,i)=>{positions[id]=rest[(i+1)%rest.length];});
    await page.evaluate(({n,aspect,positions,ids})=>window.makeEdgeFixture(n,aspect,positions).then(()=>{
      const r=window.edgeRenderer;
      r.cards.forEach((card,id)=>{card.mesh.visible=card.shadow.visible=ids.includes(id);});
    }),{n,aspect,positions,ids});
    let tested=0;
    for(let row=1;row<n;row++) for(let col=1;col<n;col++) {
      const quadrants=[(row-1)*n+col-1,(row-1)*n+col,row*n+col-1,row*n+col];
      const missing=quadrants.filter(id=>!ids.includes(id));
      if(missing.length!==1)continue;
      const mx=missing[0]%n===col?1:-1, my=Math.floor(missing[0]/n)===row?-1:1;
      const result=await page.evaluate(({col,row,mx,my,ids})=>{
        const r=window.edgeRenderer, h=r.cellHeight;
        const vx=col-r.size/2, vy=(r.size/2-row)*h;
        r.camera.position.x=vx; r.camera.position.y=vy;
        r.camera.zoom=r.worldSize; r.camera.updateProjectionMatrix();
        const gl=r.three.getContext(), w=gl.drawingBufferWidth, height=gl.drawingBufferHeight;
        const read=()=>{
          r.three.render(r.scene,r.camera);
          const pixels=new Uint8Array(w*height*4);
          gl.readPixels(0,0,w,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          return pixels;
        };
        const visible=ids.map(id=>r.cards[id]);
        const body=visible[0].mesh.material;
        body.visible=false; visible.forEach(card=>{card.shadow.visible=false;});
        const photo=read();
        visible.forEach(card=>{
          card.picture.material.visible=false; card.flash.visible=true;
          card.flash.material.uniforms.uStrength.value=1;
          card.flash.material.uniforms.uSweep.value=0;
        });
        const flash=read();
        visible.forEach(card=>{card.flash.visible=false; card.shadow.visible=true;});
        const shadow=read();
        const radius=.028*Math.min(1,h), cx=mx*(radius-.011), cy=my*(radius-.011*h);
        let silhouetteErrors=0, flashErrors=0, checked=0, maxShadow=0;
        const examples=[];
        for(let y=0;y<height;y++) for(let x=0;x<w;x++) {
          const px=(x+.5)/w-.5, py=((y+.5)/height-.5)*h;
          if(Math.abs(px)>.14||Math.abs(py)>.14)continue;
          const qx=(px-cx)*mx, qy=(py-cy)*my;
          // Geometric reference: a circular arc tangent to two straight
          // edges, not three separate rectangular masks with corner caps.
          let distance;
          if(qx<0&&qy<0)distance=Math.hypot(qx,qy)-radius;
          else if(qx>=0&&qy>=0)distance=-Math.min(qx,qy)-radius;
          else distance=-(qx<0?qx:qy)-radius;
          const alpha=photo[(y*w+x)*4+3];
          if(Math.abs(distance)>2/w) {
            checked++;
            if(distance>0?alpha<250:alpha>5) {
              silhouetteErrors++; if(examples.length<3)examples.push({px,py,distance,alpha});
            }
          }
          if(Math.abs(alpha-flash[(y*w+x)*4+3])>1)flashErrors++;
          maxShadow=Math.max(maxShadow,shadow[(y*w+x)*4+3]);
        }
        body.visible=true;
        visible.forEach(card=>{card.picture.material.visible=true;});
        read();
        return {silhouetteErrors,flashErrors,checked,maxShadow,examples};
      },{col,row,mx,my,ids});
      const label=`${name}, aspect ${aspect}, corner ${col}/${row}`;
      assert.ok(result.checked>100,`${label}: sufficient contour samples`);
      assert.equal(result.silhouetteErrors,0,`${label}: continuous concave arc, no protrusions or cut-off rims: ${JSON.stringify(result.examples)}`);
      assert.equal(result.flashErrors,0,`${label}: the merge sheen follows exactly the photo silhouette`);
      assert.ok(result.maxShadow<=32,`${label}: adjacent arms share one shadow, alpha=${result.maxShadow}`);
      if(aspect===1&&tested===0)await page.locator('#edge-fixture').screenshot({path:`test-results/card-inner-corner-${name}.png`});
      tested++;
    }
    assert.ok(tested>0,`${name} fixture includes a concave corner`);
    report.push({fixture:name,aspect,corners:tested});
  }
  assert.deepEqual(errors,[]);
  await fs.writeFile('test-results/card-edge-rendering.json',JSON.stringify(report,null,2));
  console.log('PASS: continuous concave rims and shared shadows in all L orientations, T/stair/hole groups for square/portrait/landscape cards; matching merge sheen; seam-free 3x3/4x4/9x9 groups, draggable joins, bounded render passes and no shader errors.');
} finally {await browser.close();}
