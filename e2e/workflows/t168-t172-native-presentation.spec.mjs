import {test,expect} from '@playwright/test';

const mountFixture=async(page)=>{
 await page.goto('/shell/history-reveal.js');
 await page.setContent(`
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/shell/shell.css">
  <link rel="stylesheet" href="/shell/board-ux.css">
  <link rel="stylesheet" href="/shell/loading.css">
  <main>
   <div class="board-message-slot"><div class="board-message-live"><p class="board-preview-label">Recorded move</p><span class="board-message-activity" data-loading-state="pending" data-loading-key="history:g:move:m1" data-loading-context="external"></span></div></div>
   <ol class="history-list">
    <li class="history-item history-item-waiting"><div class="history-move-line">Live · Waiting on you to move</div></li>
    <li class="history-return-live"><button class="secondary">Return to live</button></li>
    <li class="history-turn history-selection-pending" aria-busy="true"><div class="history-turn-heading">Turn 4</div><ol class="history-list-nested"><li class="history-item"><div class="history-move-line">Move 4</div></li></ol></li>
   </ol>
   <div style="height:720px"></div><div id="reveal-target" style="height:100px">Selected History preview</div><div style="height:500px"></div>
  </main>`);
 await page.evaluate(async()=>{const {mountLoadingFeedback}=await import('/shell/loading.js');window.__disposeLoading=mountLoadingFeedback(document);});
};

const replayHeightReceipt=page=>page.evaluate(async()=>{
 const {createMessageHeightController}=await import('/board/message-height.js');
 const host=document.createElement('section');host.style.width='280px';host.innerHTML='<div class="board-message-slot"><div class="board-message-live"><p class="board-preview-label" id="native-replay-message"></p></div></div>';document.body.prepend(host);
 await document.fonts.ready;
 const label=host.querySelector('#native-replay-message'),slot=host.querySelector('.board-message-slot'),controller=createMessageHeightController(label);
 controller.setContentHeightOwner('replay:first');
 label.textContent='You rushed from (8, 3) to (7, 4), displaced two pieces, restored one supply line, and cut off both opposing units from their commander.';
 controller.captureContentHeight();const long=slot.getBoundingClientRect().height;
 label.textContent='You passed.';controller.captureContentHeight();const shortSameEpisode=slot.getBoundingClientRect().height;
 controller.setContentHeightOwner('replay:second');controller.captureContentHeight();const changedEpisode=slot.getBoundingClientRect().height;
 controller.setContentHeightOwner(null);controller.captureContentHeight();const ended=slot.getBoundingClientRect().height;
 const animations=slot.getAnimations({subtree:true}).map(animation=>animation.playState);
 controller.destroy();host.remove();return{long,shortSameEpisode,changedEpisode,ended,animations};
});

test('native History geometry, quiet loading cue, pending pulse, and minimum reveal delta share the production contracts',async({page})=>{
 await page.setViewportSize({width:390,height:500});await mountFixture(page);
 const cue=page.locator('.board-message-activity');
 await expect(cue).toHaveAttribute('data-loading-phase','quiet');
 await page.waitForTimeout(120);await expect(cue).toHaveAttribute('data-loading-phase','quiet');
 await expect(cue).toHaveAttribute('data-loading-phase','visible',{timeout:400});
 await expect(cue.locator('.loading-pieces')).toBeVisible();
 const heights=await page.locator('.history-item-waiting,.history-return-live').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
 expect(heights[0]).toBeGreaterThanOrEqual(48);expect(Math.abs(heights[0]-heights[1])).toBeLessThanOrEqual(1);
 expect(await page.locator('.history-selection-pending .history-turn-heading').evaluate(node=>node.getAnimations().length)).toBeGreaterThan(0);
 expect(await page.locator('.history-turn.history-selection-pending > .history-list-nested').evaluate(node=>node.getAnimations().length)).toBeGreaterThan(0);
 const receipt=await page.evaluate(async()=>{
  const {historyRevealScrollDelta}=await import('/shell/history-reveal.js');
  const target=document.querySelector('#reveal-target'),before=target.getBoundingClientRect(),visibleBottom=innerHeight-20;
  const delta=historyRevealScrollDelta({top:before.top,bottom:before.bottom,visibleBottom});window.scrollBy(0,delta);
  const after=target.getBoundingClientRect();return{delta,before:before.toJSON(),after:after.toJSON(),visibleBottom};
 });
 expect(receipt.delta).toBeGreaterThan(0);expect(Math.abs(receipt.after.bottom-receipt.visibleBottom)).toBeLessThanOrEqual(1);
 expect(receipt.after.top,'minimum-delta reveal must not pin an already-below selection to the top').toBeGreaterThan(12);
 const replay=await replayHeightReceipt(page);
 expect(replay.long).toBeGreaterThan(replay.changedEpisode+20);
 expect(Math.abs(replay.shortSameEpisode-replay.long)).toBeLessThanOrEqual(1);
 expect(Math.abs(replay.changedEpisode-replay.ended)).toBeLessThanOrEqual(1);
});

test('reduced motion keeps the pending target and rail static',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:500});await mountFixture(page);
 const heading=page.locator('.history-selection-pending .history-turn-heading'),rail=page.locator('.history-turn.history-selection-pending > .history-list-nested');
 expect(await heading.evaluate(node=>node.getAnimations().length)).toBe(0);
 expect(await rail.evaluate(node=>node.getAnimations().length)).toBe(0);
 expect(Number(await heading.evaluate(node=>getComputedStyle(node).opacity))).toBeCloseTo(.68,2);
 expect(await rail.evaluate(node=>getComputedStyle(node).borderLeftColor)).not.toBe('rgba(0, 0, 0, 0)');
 const replay=await replayHeightReceipt(page);
 expect(Math.abs(replay.shortSameEpisode-replay.long)).toBeLessThanOrEqual(1);
 expect(replay.changedEpisode).toBeLessThan(replay.long-20);
 expect(replay.animations).toEqual([]);
});
