import {expect} from '@playwright/test';

// Observe the actual layout owners without cancelling or seeking their motion.
export async function settledBoardMessageCamera(page, action, info) {
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect.poll(()=>page.evaluate(()=>{
  const track=document.querySelector('.game-shell-track');
  const slots=[...document.querySelectorAll('.board-message-slot')];
  return {missing:!track||!slots.length,moving:[track,...slots].some(node=>node?.getAnimations().some(animation=>animation.pending||animation.playState==='running'))};
 })).toEqual({missing:false,moving:false});
 const control=page.locator(`[data-board-message-action="${action}"]`);
 await expect(control).toBeVisible();
 const geometry=await control.evaluate(node=>{
  const slot=node.closest('.board-message-slot'),board=document.querySelector('#shell-board'),panel=node.closest('.panel');
  if(!slot||!board||!panel)throw Error('Message slot and live board are required');
  const rect=element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
  const control=rect(node),slotRect=rect(slot);
  const slotStyle=getComputedStyle(slot);
  const ring=parseFloat(slotStyle.getPropertyValue('--board-message-focus-width'))+parseFloat(slotStyle.getPropertyValue('--board-message-focus-offset'));
  if(!Number.isFinite(ring))throw Error('Shared message focus-ring metrics are required');
  // The existing native hit target is at least44px, even for compact prose buttons.
  const xGuard=Math.max(0,(44-control.width)/2,ring),yGuard=Math.max(0,(44-control.height)/2,ring);
  return {control,slot:slotRect,panel:rect(panel),viewportWidth:innerWidth,board:rect(board),ring,footprint:{left:control.left-xGuard,right:control.right+xGuard,top:control.top-yGuard,bottom:control.bottom+yGuard}};
 });
 try{await info.attach('settled-follow-camera',{body:JSON.stringify(geometry),contentType:'application/json'});}catch(error){console.warn('[follow-camera] Evidence incomplete:',error.name);}
 expect(geometry.footprint.left).toBeGreaterThanOrEqual(Math.max(0,geometry.panel.left));
 expect(geometry.footprint.right).toBeLessThanOrEqual(Math.min(geometry.viewportWidth,geometry.panel.right));
 expect(geometry.footprint.top).toBeGreaterThanOrEqual(geometry.slot.top);
 expect(geometry.footprint.bottom).toBeLessThanOrEqual(geometry.slot.bottom);
 expect(geometry.footprint.bottom).toBeLessThanOrEqual(geometry.board.top);
 return geometry;
}
