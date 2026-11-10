import {test,expect} from '@playwright/test';

for(const layout of ['separate','context'])test(`recorded narration preserves focused ${layout} controls when coordinates change`,async({page})=>{
 await page.goto('/browser-integration/support/board-message.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(async layout=>{
  const {renderBoardMessageHtml,patchBoardMessage}=await import('/apps/web/board/message-presentation.js');
  const {renderBoardContext}=await import('/apps/web/shell/board-context.js');
  const {BOARD_PROMPT}=await import('/apps/web/board/prompt-models.js');
  const root=document.createElement('p');root.id='narration-control-proof';document.body.appendChild(root);
  const contextRoot=document.createElement('div');contextRoot.id='narration-context-proof';document.body.appendChild(contextRoot);
  const actions=[{id:'replay-next',label:'Next'},{id:'replay-stop',label:'Stop replay'}];
  const message=(text,coordinates)=>({rows:[{text,actorName:'Maya',coordinates},{text:'Replay · 1 of 3',actions}]});
  const prompt={text:BOARD_PROMPT.manualReplay,actions};
  const context=(text,coordinates)=>renderBoardContext({key:'replay-progress',gameId:'fixture',transient:true,message:{rows:[{text,actorName:'Maya',coordinates},{text:'Replay · 1 of 3'}]}});
  root.innerHTML=renderBoardMessageHtml(layout==='context'?prompt:message('Maya pushed onto (4, 4)',[{row:4,col:4}]));
  if(layout==='context')contextRoot.innerHTML=context('Maya pushed onto (4, 4)',[{row:4,col:4}]);
  window.originalReplayPrompt=root.innerHTML;
  const stop=root.querySelector('[data-board-message-action="replay-stop"]');window.originalReplayStop=stop;window.replayStopActivations=0;stop.addEventListener('click',()=>window.replayStopActivations++);
  window.changeRecordedNarration=()=>{
   const text='Maya retreated from (4, 4) to (3, 4) and lost piece at (5, 3)',coordinates=[{row:4,col:4},{row:3,col:4},{row:5,col:3}];
   if(layout==='context'){contextRoot.innerHTML=context(text,coordinates);return patchBoardMessage(root,renderBoardMessageHtml(prompt));}
   return patchBoardMessage(root,renderBoardMessageHtml(message(text,coordinates)));
  };
 },layout);
 const stop=page.locator('#narration-control-proof [data-board-message-action="replay-stop"]');await stop.focus();
 expect(await page.evaluate(()=>window.changeRecordedNarration())).toBe(true);
 await expect(stop).toBeFocused();expect(await stop.evaluate(button=>button===window.originalReplayStop&&button.isConnected)).toBe(true);
 const detail=page.locator(layout==='context'?'#narration-context-proof':'#narration-control-proof');
 await expect(detail.locator('.board-preview-coordinate-chip')).toHaveCount(3);
 await expect(detail).toContainText('retreated from');await expect(detail).toContainText('lost piece at');
 if(layout==='context'){
  expect(await page.locator('#narration-control-proof').evaluate(root=>root.innerHTML===window.originalReplayPrompt)).toBe(true);
  await expect(page.locator('#narration-control-proof .board-preview-coordinate-chip')).toHaveCount(0);
  await expect(detail).toContainText('Replay · 1 of 3');
 }
 await stop.click();expect(await page.evaluate(()=>window.replayStopActivations)).toBe(1);
});
