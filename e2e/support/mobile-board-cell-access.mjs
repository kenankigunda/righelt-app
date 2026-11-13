import {expect} from '@playwright/test';
import {MOBILE_NAVIGATION} from '../../apps/web/shell/mobile-navigation.js';
import {settleMobileNavigationRow} from '../../browser-integration/support/mobile-navigation-geometry.mjs';

// Native wheel input in the existing narrowed desktop profiles. This does not
// stand in for physical touchscreen swipe or a 44px target for every cell.
export async function assertMobileBoardCellAccess(page,info,{before,readState,assertUnchanged}){
 const reveal=page.locator('[data-mobile-nav-reveal]');
 await page.evaluate(({hideDistance,idleMs})=>{
  const nav=()=>document.querySelector('.shell-mobile-tabbar');
  const ledger={events:[],dropped:0,clickAt:null,origin:null,hideDistance,idleMs};
  const push=event=>{if(ledger.events.length<64)ledger.events.push(event);else ledger.dropped++;};
  const click=event=>{if(event.target.closest('[data-mobile-nav-reveal]')){ledger.clickAt=performance.now();ledger.origin=scrollY;push({kind:'reveal',trusted:event.isTrusted,buttons:event.buttons,visible:nav()?.dataset.visible});}};
  const wheel=event=>push({kind:'wheel',trusted:event.isTrusted,deltaY:event.deltaY,visible:nav()?.dataset.visible});
  const scroll=event=>push({kind:'scroll',trusted:event.isTrusted,elapsed:performance.now()-ledger.clickAt,distance:scrollY-ledger.origin,visible:nav()?.dataset.visible,inert:nav()?.querySelector('[data-mobile-nav-controls]')?.hasAttribute('inert')});
  document.addEventListener('click',click);window.addEventListener('wheel',wheel,{passive:true});window.addEventListener('scroll',scroll,{passive:true});
  window.mobileCellAccess={ledger,dispose(){document.removeEventListener('click',click);window.removeEventListener('wheel',wheel);window.removeEventListener('scroll',scroll);delete window.mobileCellAccess;}};
 },MOBILE_NAVIGATION);
 const sample=()=>page.evaluate(()=>{
  const rect=node=>node?.getBoundingClientRect().toJSON()??null;
  const board=document.querySelector('#shell-board'),nav=document.querySelector('.shell-mobile-tabbar');
  const cells=[...board.children].filter(node=>node.matches('.cell')).map(node=>{const r=node.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return {row:node.dataset.row,col:node.dataset.col,x,y,navCovered:Boolean(hit?.closest('.shell-mobile-tabbar')),owned:hit===node||node.contains(hit),rect:r.toJSON()};});
  const controlsNode=nav.querySelector('[data-mobile-nav-controls]'),rowStyle=getComputedStyle(controlsNode);
  const controlsRow={rect:rect(controlsNode),paddingTop:parseFloat(rowStyle.paddingTop),paddingBottom:parseFloat(rowStyle.paddingBottom),borderTop:parseFloat(rowStyle.borderTopWidth),borderBottom:parseFloat(rowStyle.borderBottomWidth)};
  const controls=[...nav.querySelectorAll('.shell-mobile-tab')].map(node=>{const r=node.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;const owns=(a,b)=>{const hit=document.elementFromPoint(a,b);return hit===node||node.contains(hit);};return {rect:r.toJSON(),css:{width:getComputedStyle(node).width,height:getComputedStyle(node).height},centerOwned:owns(x,y),minimum44Corners:[[-21.5,-21.5],[21.5,-21.5],[-21.5,21.5],[21.5,21.5]].map(([dx,dy])=>owns(x+dx,y+dy))};});
  return {viewport:{width:innerWidth,height:innerHeight},navBottom:parseFloat(getComputedStyle(nav).bottom),controlsRow,controls,scrollX,scrollY,maxScroll:document.documentElement.scrollHeight-innerHeight,board:rect(board),nav:rect(nav),reveal:rect(nav?.querySelector('[data-mobile-nav-reveal]')),visible:nav?.dataset.visible,cells,ledger:window.mobileCellAccess.ledger};
 });
 let primaryError,shown;
 try{
  await reveal.click();
  const releaseReadiness=await reveal.evaluate(async button=>{
   const finite=()=>button.getAnimations({subtree:true}).filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime));
   const sample=()=>{const rect=button.getBoundingClientRect(),style=getComputedStyle(button);return {rect:rect.toJSON(),offsetWidth:button.offsetWidth,offsetHeight:button.offsetHeight,cssWidth:style.width,cssHeight:style.height,transform:style.transform,connected:button.isConnected,active:button.matches(':active'),pressing:button.classList.contains('is-pressing'),finite:finite().map(animation=>({kind:animation.constructor.name,name:animation.animationName??animation.transitionProperty??null,playState:animation.playState,pending:animation.pending,currentTime:animation.currentTime}))};};
   const before=sample(),animations=finite(),outcomes=await Promise.allSettled(animations.map(animation=>animation.finished));
   return {before,waited:animations.length,outcomes:outcomes.map(result=>result.status),after:sample()};
  });
  await info.attach('Native navigation handle release readiness',{body:JSON.stringify(releaseReadiness),contentType:'application/json'});
  expect(releaseReadiness.after).toMatchObject({connected:true,active:false,pressing:false,offsetWidth:44,offsetHeight:44,cssWidth:'44px',cssHeight:'44px'});
  expect(releaseReadiness.after.finite.filter(animation=>animation.pending||animation.playState==='running')).toHaveLength(0);
  await settleMobileNavigationRow(page.locator('.shell-mobile-tabbar'));
  await page.mouse.move(4,300);
  shown=await sample();expect(shown.visible).toBe('true');expect(shown.cells).toHaveLength(100);
  expect(shown.reveal.width).toBeGreaterThanOrEqual(44);expect(shown.reveal.height).toBeGreaterThanOrEqual(44);
  expect(shown.controlsRow).toMatchObject({paddingTop:3,paddingBottom:3,borderTop:1,borderBottom:1});
  expect(shown.controlsRow.rect.height).toBeGreaterThanOrEqual(52);expect(shown.controlsRow.rect.height).toBeGreaterThanOrEqual(Math.max(...shown.controls.map(control=>control.rect.height))+shown.controlsRow.paddingTop+shown.controlsRow.paddingBottom+shown.controlsRow.borderTop+shown.controlsRow.borderBottom);
  expect(shown.controls).toHaveLength(3);for(const control of shown.controls){expect(control.rect.width).toBeGreaterThanOrEqual(44);expect(control.rect.height).toBeGreaterThanOrEqual(44);expect(control.centerOwned).toBe(true);expect(control.minimum44Corners).toEqual([true,true,true,true]);}
  expect(shown.maxScroll-shown.scrollY).toBeGreaterThanOrEqual(MOBILE_NAVIGATION.hideDistance);
  await page.mouse.wheel(0,MOBILE_NAVIGATION.hideDistance+8);
  await expect.poll(async()=>{const s=await sample();return s.ledger.events.some(event=>event.kind==='scroll'&&event.distance>=MOBILE_NAVIGATION.hideDistance&&event.elapsed<MOBILE_NAVIGATION.idleMs&&event.visible==='false'&&event.inert);}).toBe(true);
  await page.locator('.shell-mobile-tabbar').evaluate(async nav=>{await Promise.allSettled(nav.getAnimations({subtree:true}).filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation=>animation.finished));});
  const hidden=await sample();
  await info.attach('Native mobile Board cell access before and after user scroll',{body:JSON.stringify({profile:'narrowed desktop native wheel',shown,hidden}),contentType:'application/json'});
  expect(hidden.ledger.dropped).toBe(0);expect(hidden.ledger.events.some(event=>event.kind==='reveal'&&event.trusted&&event.buttons===0)).toBe(true);expect(hidden.ledger.events.some(event=>event.kind==='wheel'&&event.trusted&&event.visible==='true')).toBe(true);
  expect(hidden.cells.every(cell=>cell.owned)).toBe(true);
  // The hidden bar's source CSS resolves directly to env(safe-area-inset-bottom).
  // This records the actual profile inset, including zero, without emulating iOS.
  expect(hidden.navBottom).toBeGreaterThanOrEqual(0);expect(shown.navBottom).toBe(Math.max(8,hidden.navBottom));
  expect(shown.nav.bottom).toBeLessThanOrEqual(shown.viewport.height-Math.max(8,hidden.navBottom));expect(hidden.reveal.bottom).toBeLessThanOrEqual(hidden.viewport.height-hidden.navBottom);
  expect({width:hidden.board.width,height:hidden.board.height,x:hidden.board.x+hidden.scrollX,y:hidden.board.y+hidden.scrollY}).toEqual({width:shown.board.width,height:shown.board.height,x:shown.board.x+shown.scrollX,y:shown.board.y+shown.scrollY});
  const previouslyCovered=hidden.cells.find(cell=>shown.cells.find(previous=>previous.row===cell.row&&previous.col===cell.col)?.navCovered);
  const target=previouslyCovered??hidden.cells.filter(cell=>cell.owned&&cell.rect.top>=0&&cell.rect.bottom<=hidden.viewport.height).at(-1);
  expect(target,'the hidden navigation state must leave a visible Board cell available for native input').toBeTruthy();
  if(!previouslyCovered)expect(shown.cells.every(cell=>!cell.navCovered),'the shown navigation must either expose every Board cell or provide a covered-cell hit-test target').toBe(true);
  await page.evaluate(()=>{window.mobileCellAccessClick=null;const board=document.querySelector('#shell-board');const listener=event=>{const cell=event.target.closest('.cell');if(cell)window.mobileCellAccessClick={trusted:event.isTrusted,row:cell.dataset.row,col:cell.dataset.col};};board.addEventListener('click',listener,{once:true});window.mobileCellAccess.removeCellListener=()=>board.removeEventListener('click',listener);});
  await page.mouse.click(target.x,target.y);
  expect(await page.evaluate(()=>window.mobileCellAccessClick)).toEqual({trusted:true,row:target.row,col:target.col});
  assertUnchanged(before,await readState());
  await reveal.click();await expect(page.locator('.shell-mobile-tabbar')).toHaveAttribute('data-visible','true');
  expect(await page.locator('[data-mobile-nav-controls]').evaluate(node=>node.hasAttribute('inert'))).toBe(false);
  await page.mouse.move(4,300);await page.mouse.wheel(0,-hidden.scrollY);
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(0);
 }catch(error){primaryError=error;throw error;}
 finally{
  let diagnosticError;
  try{await info.attach('Native mobile cell access final ledger',{body:JSON.stringify({shown,final:await sample()}),contentType:'application/json'});}catch(error){diagnosticError=error;}
  try{await page.evaluate(()=>{window.mobileCellAccess?.removeCellListener?.();window.mobileCellAccess?.dispose();delete window.mobileCellAccessClick;});}catch(error){diagnosticError??=error;}
  if(!primaryError&&diagnosticError)throw diagnosticError;
 }
}
