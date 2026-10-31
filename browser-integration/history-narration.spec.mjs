import {test,expect} from '@playwright/test';

for(const layout of ['separate','inline'])test(`recorded narration preserves focused ${layout} controls when coordinates change`,async({page})=>{
 await page.goto('/browser-integration/support/board-message.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(async layout=>{
  const {renderBoardMessageHtml,patchBoardMessage}=await import('/apps/web/board/message-presentation.js');
  const root=document.createElement('p');root.id='narration-control-proof';document.body.appendChild(root);
  const actions=[{id:'replay-next',label:'Next'},{id:'replay-stop',label:'Stop replay'}];
  const message=(text,coordinates)=>layout==='inline'?{text,actorName:'Maya',coordinates,actions}:{rows:[{text,actorName:'Maya',coordinates},{text:'Replay · 1 of 3',actions}]};
  root.innerHTML=renderBoardMessageHtml(message('Maya pushed onto (4, 4)',[{row:4,col:4}]));
  const stop=root.querySelector('[data-board-message-action="replay-stop"]');window.originalReplayStop=stop;window.replayStopActivations=0;stop.addEventListener('click',()=>window.replayStopActivations++);
  window.changeRecordedNarration=()=>patchBoardMessage(root,renderBoardMessageHtml(message('Maya retreated from (4, 4) to (3, 4) and lost piece at (5, 3)',[{row:4,col:4},{row:3,col:4},{row:5,col:3}])));
 },layout);
 const stop=page.locator('#narration-control-proof [data-board-message-action="replay-stop"]');await stop.focus();
 expect(await page.evaluate(()=>window.changeRecordedNarration())).toBe(true);
 await expect(stop).toBeFocused();expect(await stop.evaluate(button=>button===window.originalReplayStop)).toBe(true);
 await expect(page.locator('#narration-control-proof .board-preview-coordinate-chip')).toHaveCount(3);
 await stop.click();expect(await page.evaluate(()=>window.replayStopActivations)).toBe(1);
});
