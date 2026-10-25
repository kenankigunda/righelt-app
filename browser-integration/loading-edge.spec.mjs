import {test,expect} from '@playwright/test';
const ready=async page=>{await page.goto('/browser-integration/support/loading-edge.html');await page.waitForFunction(()=>window.edgeReady);await expect(page.locator('.loading-edge-frame')).toHaveCount(1);};
test('edge cut protects real labels, axes, controls and grid at every board format',async({page},info)=>{
 for(const [width,scale] of [[320,100],[390,200],[768,100],[944,200],[1440,100]]){
  await page.setViewportSize({width,height:800});await ready(page);
  const rect=()=>page.locator('[data-shell-panel="board"]').evaluate(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
  await page.evaluate(scale=>document.documentElement.style.fontSize=`${scale}%`,scale);await page.evaluate(()=>{document.fonts.dispatchEvent(new Event('loadingdone'));return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const before=await rect();await expect(page.locator('.axis-label')).not.toHaveCount(0);
  expect(await page.locator('.axis-label').evaluateAll(nodes=>nodes.every(node=>{const b=node.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth;}))).toBe(true);
  const geometry=await page.locator('.loading-edge-frame').evaluate(svg=>{
   const s=svg.getBoundingClientRect(),cuts=[...svg.querySelectorAll('mask rect')].slice(1).map(node=>Object.fromEntries(['x','y','width','height'].map(key=>[key,Number(node.getAttribute(key))])));
   return {width:document.documentElement.scrollWidth,pointer:getComputedStyle(svg.parentElement).pointerEvents,inert:svg.parentElement.inert,
    protected:[...document.querySelectorAll('h2,p,button,.board,.axis-label,.overlay-key')].filter(node=>node.getClientRects().length&&!node.closest('[inert]')).map(node=>{const b=node.getBoundingClientRect();return cuts.some(c=>c.x<=b.left-s.left-1.9&&c.y<=b.top-s.top-1.9&&c.x+c.width>=b.right-s.left+1.9&&c.y+c.height>=b.bottom-s.top+1.9);}),
    colors:[...svg.querySelectorAll('g polygon')].map(node=>getComputedStyle(node).stroke),opacity:[...svg.querySelectorAll('g polygon')].map(node=>getComputedStyle(node).opacity)};
  });
  expect(geometry.width).toBeLessThanOrEqual(width);expect(geometry.protected.every(Boolean)).toBe(true);expect(geometry.pointer).toBe('none');expect(geometry.inert).toBe(true);expect(new Set(geometry.colors).size).toBe(2);expect(geometry.opacity).toEqual(['1','1']);
  await page.evaluate(()=>{window.edgePath=document.querySelector('.loading-edge-p1');window.edgeClock=window.edgePath.getAnimations()[0];window.dispatchEvent(new Event('resize'));});
  await expect.poll(()=>page.evaluate(()=>window.edgePath===document.querySelector('.loading-edge-p1')&&window.edgeClock===window.edgePath.getAnimations()[0])).toBe(true);
  const clock=await page.evaluate(()=>window.edgeClock.currentTime);await expect.poll(()=>page.evaluate(()=>window.edgeClock.currentTime)).toBeGreaterThan(clock);
  await page.getByRole('button',{name:'Commander',exact:true}).evaluate(node=>node.focus({preventScroll:true}));await expect(page.getByRole('button',{name:'Commander',exact:true})).toBeFocused();
  expect(await rect()).toEqual(before);
  if((width===390&&info.project.name==='webkit')||(width===1440&&info.project.name==='chromium'))await page.screenshot({path:info.outputPath(`edge-${width}-${scale}.png`),fullPage:true});
  await page.evaluate(()=>document.querySelector('.board-wrap').dataset.loadingState='idle');await expect(page.locator('.loading-edge-frame')).toHaveCount(0);expect(await rect()).toEqual(before);
 }
});
test('edge lifecycle removes stale geometry and preserves static reduced-motion feedback',async({page})=>{
 await ready(page);
 await page.evaluate(()=>{const label=document.querySelector('#fixture-text');label.className='axis-label';label.style.cssText='position:absolute;left:50px;top:5px;white-space:nowrap';label.textContent='A';});
 await expect.poll(()=>page.locator('.loading-edge-frame mask rect').count()).toBeGreaterThan(1);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const cutWidth=()=>page.locator('.loading-edge-frame').evaluate(svg=>{const s=svg.getBoundingClientRect(),label=document.querySelector('#fixture-text').getBoundingClientRect();return [...svg.querySelectorAll('mask rect')].slice(1).filter(c=>Math.abs(Number(c.getAttribute('x'))-(label.left-s.left-2))<.1&&Math.abs(Number(c.getAttribute('y'))-(label.top-s.top-2))<.1).map(c=>Number(c.getAttribute('width'))).sort((a,b)=>b-a)[0]??0;});
 const small=await cutWidth();
 await page.evaluate(()=>{window.edgePath=document.querySelector('.loading-edge-p1');window.edgeClock=window.edgePath.getAnimations()[0];document.querySelector('#fixture-text').firstChild.nodeValue='A deliberately longer label';});
 await expect.poll(cutWidth).toBeGreaterThan(small+50);
 expect(await page.evaluate(()=>window.edgePath===document.querySelector('.loading-edge-p1')&&window.edgeClock===window.edgePath.getAnimations()[0])).toBe(true);
 await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('.loading-edge-p1')).toHaveCSS('animation-name','none');
 await page.evaluate(()=>{document.querySelector('[data-shell-panel="board"]').style.setProperty('--stone-outline','none');window.dispatchEvent(new Event('resize'));});await expect(page.locator('.loading-edge-frame')).toHaveCount(0);
 await page.evaluate(()=>{document.querySelector('[data-shell-panel="board"]').style.removeProperty('--stone-outline');window.dispatchEvent(new Event('resize'));});await expect(page.locator('.loading-edge-frame')).toHaveCount(1);
 await page.evaluate(()=>window.edgeDispose());await expect(page.locator('.loading-edge-layer')).toHaveCount(0);
});
