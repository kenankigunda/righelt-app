import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {createGameFromHome,makeAnyLegalMove,switchGamePanel} from '../support/app.mjs';

function installGeometryProbe() {
 const rectangle=element=>{const r=element.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};};
 window.desktopGeometry=()=>{
  const panel=document.querySelector('[data-shell-panel="board"]'),board=panel?.querySelector('.board');if(!panel||!board||board.children.length!==100)return null;
  const style=getComputedStyle(panel),grid=getComputedStyle(board),first=getComputedStyle(board.firstElementChild);
  const slot=selector=>{const element=panel.querySelector(selector);return element?rectangle(element):null;};
  return {startup:{fonts:document.fonts.status,header:rectangle(document.querySelector('.shell-header')),children:[...document.querySelector('.shell-header').children].map(element=>({class:element.className,height:element.getBoundingClientRect().height,margin:getComputedStyle(element).margin})),pending:Boolean(document.querySelector('.shell-header > .loading-region'))},kind:board.id==='shell-board'?'live':'loading',panel:rectangle(panel),board:rectangle(board),heading:slot('.board-heading-slot'),message:slot('.board-message-slot'),legend:slot('.overlay-key'),shape:{panelPadding:style.padding,panelRadius:style.borderRadius,panelBorder:style.borderWidth,stoneOutline:getComputedStyle(panel,'::before').clipPath,boardRadius:grid.borderRadius,boardBorder:grid.borderWidth,gap:grid.gap,cellRadius:first.borderRadius,cellPadding:first.padding,cellBorder:first.borderWidth},cells:[...board.children].map(rectangle),documentHeight:document.documentElement.scrollHeight,scrollY};
 };
 window.desktopFrames=[];window.recordDesktopFrames=true;
 const sample=()=>{if(!window.recordDesktopFrames)return;const geometry=window.desktopGeometry();if(geometry&&window.desktopFrames.length<200)window.desktopFrames.push(geometry);requestAnimationFrame(sample);};requestAnimationFrame(sample);
}
const read=page=>page.evaluate(()=>window.desktopGeometry());
const compareRect=(a,b,label)=>{for(const key of ['x','y','width','height'])expect(Math.abs(a[key]-b[key]),`${label} ${key}`).toBeLessThanOrEqual(1);};
const compareGeometry=(a,b)=>{
 for(const key of ['panel','board','heading','message','legend'])compareRect(a[key],b[key],key);
 expect(a.shape).toEqual(b.shape);expect(a.cells).toHaveLength(100);expect(b.cells).toHaveLength(100);
 for(let i=0;i<100;i++)compareRect(a.cells[i],b.cells[i],`cell${i}`);
};

test('desktop board fits primary viewport, remains stable through scroll/header controls and keeps a floor in short windows',async({page},info)=>{
 await page.addInitScript(installGeometryProbe);await page.setViewportSize({width:1440,height:800});await createGameFromHome(page);
 await expect.poll(async()=>{const g=await read(page);return Math.abs(g.board.width-g.board.height);}).toBeLessThanOrEqual(1);
 const primary=await read(page);expect(primary.panel.y+primary.panel.height).toBeLessThanOrEqual(800);expect(primary.cells[0].width).toBeGreaterThanOrEqual(35.9);
 await page.screenshot({path:info.outputPath('desktop-fit-1440x800.png')});
 // Longer history or scrolling must not feed viewport-relative sticky positions back into sizing.
 await page.evaluate(()=>{const history=document.querySelector('[data-game-panel="history"]');const extra=document.createElement('div');extra.style.height='1600px';extra.dataset.fixtureHistory='';history.append(extra);window.scrollTo(0,550);});
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(0);
 const scrolled=await read(page);expect(scrolled.board.width).toBe(primary.board.width);expect(scrolled.board.height).toBe(primary.board.height);expect(scrolled.panel.height).toBe(primary.panel.height);
 await page.evaluate(()=>window.scrollTo(0,0));
 await page.locator('[data-action="toggle-sound"]').click();compareGeometry(await read(page),primary);
 await page.locator('[data-action="toggle-sound"]').click();
 for(const [width,height]of[[1366,768],[1440,600],[944,800]]){
  await page.setViewportSize({width,height});await expect(page.locator('#app')).toHaveAttribute('data-shell-layout-mode','wide');
  await expect.poll(async()=>{const g=await read(page);return Math.abs(g.board.width-g.board.height);}).toBeLessThanOrEqual(1);
  const g=await read(page);expect(g.board.width).toBeLessThanOrEqual(g.panel.width);expect(g.cells[0].width).toBeGreaterThan(28);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  if(width===1440&&height===600){expect(g.cells[0].width).toBeGreaterThanOrEqual(35.9);expect(g.panel.y+g.panel.height).toBeGreaterThan(height);}
 }
 await page.setViewportSize({width:1440,height:800});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
 await expect.poll(async()=>Math.round((await read(page)).board.width)).toBe(396);expect((await read(page)).panel.y+(await read(page)).panel.height).toBeGreaterThan(800);
 await page.screenshot({path:info.outputPath('desktop-fit-1440x800-200.png')});
 await page.evaluate(()=>document.documentElement.style.fontSize='100%');await page.setViewportSize({width:390,height:740});
 await expect(page.locator('#app')).toHaveAttribute('data-shell-layout-mode','narrow');expect(await page.locator('[data-testid="game-board-wrap"]').evaluate(el=>el.style.getPropertyValue('--desktop-board-side'))).toBe('');
 await switchGamePanel(page,'board');await makeAnyLegalMove(page);await switchGamePanel(page,'history');
 const move=page.getByTestId('history-move-item').first();await move.click();
 for(const viewport of [{width:390,height:740},{width:1440,height:800}]){
  await page.setViewportSize(viewport);const history=page.locator('[data-game-panel="history"]');
  await expect(history.getByTestId('history-return-live')).toHaveCount(1);
  for(const action of ['revert-to-move','launch-history-branch']){
   const buttons=history.locator(`[data-action="${action}"]`);await expect(buttons).toHaveCount(1);
   expect(await buttons.evaluate(element=>Boolean(element.closest('[data-testid="history-move-item"]')))).toBe(true);
  }
  await expect(history.locator('[data-action="undo-last-move"]')).toHaveCount(0);
 }

});

for(const [width,height,text]of[[1440,800,100],[390,740,100],[1440,800,200]])test(`cold loading populates the same card shape and100-cell grid at ${width}x${height} and${text}% text`,async({page,context},info)=>{
 await page.setViewportSize({width,height});const {gameId}=await createGameFromHome(page);await page.addInitScript(installGeometryProbe);
 await page.addInitScript(text=>document.addEventListener('DOMContentLoaded',()=>{document.documentElement.style.fontSize=`${text}%`;},{once:true}),text);
 let release;const held=new Promise(resolve=>{release=resolve;});let closing=false;
 let releaseFont,fontSeen=false;const fontHeld=new Promise(resolve=>{releaseFont=resolve;});
 // A reload may reuse WebKit's decoded font cache without another request. Both
 // real font references use one fresh URL; the server still serves its actual bytes.
 const coldKey=Date.now();
 const fontUrl=`/assets/fonts/Manrope-variable.ttf?desktop-cold=${coldKey}`;
 await context.route(url=>url.pathname==='/'||url.pathname==='/shell/refresh.css',async route=>{
  const response=await route.fetch();
  const body=(await response.text())
   .replaceAll(/(?:\.\/|\.\.\/)assets\/fonts\/Manrope-variable\.ttf/g,fontUrl)
   .replaceAll('./shell/refresh.css',`./shell/refresh.css?desktop-cold=${coldKey}`);
  await route.fulfill({response,body});
 });
 await context.route(url=>url.pathname==='/assets/fonts/Manrope-variable.ttf'&&url.searchParams.has('desktop-cold'),async route=>{fontSeen=true;await fontHeld;await route.continue();});
 await context.route(new RegExp(`/api/shell/games/${gameId}(?:\\?|$|/reconcile(?:\\?|$))`),async route=>{if(route.request().method()==='GET'||new URL(route.request().url()).pathname.endsWith('/reconcile'))await held;await route.continue();});
 await page.routeWebSocket(new RegExp(`/api/shell/games/${gameId}/ws`),socket=>{const server=socket.connectToServer();server.onMessage(async message=>{await held;if(!closing)socket.send(message);});});
 try{
  await page.reload({waitUntil:'domcontentloaded'});await expect(page.getByTestId('game-loading-shell')).toBeVisible();await expect.poll(()=>fontSeen).toBe(true);
  const beforeFont=await read(page);expect(beforeFont.startup.fonts).toBe('loading');releaseFont();await page.evaluate(()=>document.fonts.ready);
  const loading=await read(page);expect(loading.kind).toBe('loading');
  await writeFile(info.outputPath('held-geometry.json'),JSON.stringify({beforeFont,loading},null,2));
  compareGeometry(beforeFont,loading);
  await expect.poll(()=>page.evaluate(()=>{
   const panel=document.querySelector('[data-shell-panel="board"]').getBoundingClientRect();
   return [...document.querySelectorAll('.loading-edge-frame')].some(frame=>{
    const rect=frame.getBoundingClientRect();
    return Math.abs(rect.left-(panel.left-2))<1&&Math.abs(rect.top-(panel.top-2))<1&&Math.abs(rect.width-(panel.width+4))<1;
   });
  })).toBe(true);
  compareGeometry(await read(page),loading);
  await page.screenshot({path:info.outputPath('held-loading.png')});
  release();await expect(page.getByTestId('game-board').locator('.cell')).toHaveCount(100);await expect(page.getByTestId('game-shell')).toBeVisible();
  await expect(page.getByTestId('game-board-wrap')).toHaveAttribute('data-loading-state','idle');
  await expect(page.locator('.loading-edge-frame')).toHaveCount(0);
  await writeFile(info.outputPath('cold-geometry-before-assertions.json'),JSON.stringify({beforeFont,loading,firstLoaded:await read(page),frames:await page.evaluate(()=>window.desktopFrames)},null,2));
  await expect.poll(async()=>Math.abs((await read(page)).panel.height-loading.panel.height)).toBeLessThanOrEqual(1);
  const loaded=await read(page);compareGeometry(loading,loaded);
  const frames=await page.evaluate(()=>{window.recordDesktopFrames=false;return window.desktopFrames;});expect(frames.length).toBeGreaterThan(1);
  for(const frame of frames)compareGeometry(frame,loaded);
  if(width===1440&&text===100)expect(loaded.panel.y+loaded.panel.height).toBeLessThanOrEqual(height);
  const path=info.outputPath('cold-geometry.json');await writeFile(path,JSON.stringify({beforeFont,loading,loaded,frames},null,2));await info.attach('cold geometry',{path,contentType:'application/json'});
  await page.screenshot({path:info.outputPath('hydrated.png')});
 }finally{closing=true;release();releaseFont();await context.unrouteAll({behavior:'wait'});}
});
