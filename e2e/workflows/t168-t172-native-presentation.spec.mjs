import {test,expect} from '@playwright/test';

const mountFixture=async(page)=>{
 await page.goto('/shell/history-reveal.js');
 const boardMessage=await page.evaluate(async()=>{
  const {renderBoardMessageSlot}=await import('/shell/board-message-layout.js');
  return renderBoardMessageSlot({id:'shell-board-preview-label'});
 });
 await page.setContent(`
  <link rel="stylesheet" href="/styles.css">
  <link rel="stylesheet" href="/shell/shell.css">
  <link rel="stylesheet" href="/shell/refresh.css">
  <link rel="stylesheet" href="/shell/board-ux.css">
  <link rel="stylesheet" href="/shell/loading.css">
  <main class="shell-main-content">
   <section class="panel" data-shell-panel="board">${boardMessage}<div class="board-wrap"><div class="board"></div></div></section>
   <ol class="history-list">
    <li class="history-item history-item-waiting"><div class="history-move-line">Live · Waiting on you to move</div></li>
    <li class="history-return-live"><button class="secondary">Return to live</button></li>
    <li class="history-turn"><button class="history-turn-hit secondary history-selection-pending" aria-busy="true"></button><div class="history-turn-heading">Turn 4</div><ol class="history-list-nested"><li class="history-item"><div class="history-move-line">Move 4</div></li></ol></li>
   </ol>
   <div style="height:720px"></div><div id="reveal-target" style="height:100px">Selected History preview</div><div style="height:500px"></div>
  </main>`);
 await page.evaluate(async()=>{
  const [{mountLoadingFeedback},{mountLoadingEdges},{updateComputerBoardLoading}]=await Promise.all([import('/shell/loading.js'),import('/shell/loading-edge.js'),import('/shell/board-message-layout.js')]);
  const activity=document.querySelector('.board-message-activity');
  window.__setBoardLoading=({key=null,suppress=true,computer=false}={})=>updateComputerBoardLoading(activity,computer?{id:'g',computer:{paused:false},computerTurn:true,inHistoryMode:false}:{id:'g'},{},{scope:'g',loadingKey:key,suppressLoadingCue:suppress});
  window.__setBoardLoading({key:'history:g:move:m1'});
  window.__disposeLoading=mountLoadingFeedback(document,{onContextsChange:()=>{}});window.__disposeEdges=mountLoadingEdges(document);
 });
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
 await expect(cue.locator('.loading-pieces')).toBeHidden();
 await expect(page.locator('.loading-edge-frame')).toHaveCount(1);
 await page.evaluate(()=>window.__setBoardLoading({key:'history:g:turn:2'}));
 await expect(cue).toHaveAttribute('data-loading-phase','quiet');
 await expect(page.locator('.loading-edge-frame')).toHaveCount(0);
 await expect(cue).toHaveAttribute('data-loading-phase','visible',{timeout:400});
 await expect(page.locator('.loading-edge-frame')).toHaveCount(1);
 await page.locator('[data-shell-panel="board"]').evaluate(panel=>panel.setAttribute('inert',''));
 await expect(page.locator('.loading-edge-frame')).toHaveCount(0);
 await page.locator('[data-shell-panel="board"]').evaluate(panel=>panel.removeAttribute('inert'));
 await expect(page.locator('.loading-edge-frame')).toHaveCount(1);
 await page.evaluate(()=>window.__setBoardLoading());
 await expect(cue).not.toHaveAttribute('data-loading-edge','panel');
 await expect(page.locator('.loading-edge-frame')).toHaveCount(0);
 await page.evaluate(()=>window.__setBoardLoading({computer:true}));
 await expect(cue).toHaveAttribute('data-loading-state','pending');
 await expect(cue).not.toHaveAttribute('data-loading-edge','panel');
 await page.waitForTimeout(250);
 await expect(page.locator('.loading-edge-frame')).toHaveCount(0);
 await page.evaluate(async()=>{
  const {renderBoardMessageSlot}=await import('/shell/board-message-layout.js');
  document.querySelector('[data-shell-panel="board"]').innerHTML=`${renderBoardMessageSlot({loading:true,loadingKey:'game:cold'})}<div class="board-wrap"><div class="board"></div></div>`;
 });
 await expect(page.locator('.board-message-activity')).toHaveAttribute('data-loading-phase','visible',{timeout:400});
 await expect(page.locator('.loading-edge-frame')).toHaveCount(1);
 const heights=await page.locator('.history-item-waiting,.history-return-live').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
 expect(heights[0]).toBeLessThan(48);expect(heights[1]).toBeGreaterThanOrEqual(48);
 expect(await page.locator('.history-turn:has(> .history-selection-pending) .history-turn-heading').evaluate(node=>node.getAnimations().length)).toBeGreaterThan(0);
 expect(await page.locator('.history-turn:has(> .history-selection-pending) > .history-list-nested').evaluate(node=>node.getAnimations().length)).toBeGreaterThan(0);
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
 await expect(page.locator('.loading-edge-frame')).toHaveCount(1,{timeout:400});
 expect(await page.locator('.loading-edge-frame polygon').evaluateAll(nodes=>nodes.flatMap(node=>node.getAnimations()))).toEqual([]);
 const heading=page.locator('.history-turn:has(> .history-selection-pending) .history-turn-heading'),rail=page.locator('.history-turn:has(> .history-selection-pending) > .history-list-nested');
 expect(await heading.evaluate(node=>node.getAnimations().length)).toBe(0);
 expect(await rail.evaluate(node=>node.getAnimations().length)).toBe(0);
 expect(Number(await heading.evaluate(node=>getComputedStyle(node).opacity))).toBeCloseTo(.68,2);
 expect(await rail.evaluate(node=>getComputedStyle(node).borderLeftColor)).not.toBe('rgba(0, 0, 0, 0)');
 const replay=await replayHeightReceipt(page);
 expect(Math.abs(replay.shortSameEpisode-replay.long)).toBeLessThanOrEqual(1);
 expect(replay.changedEpisode).toBeLessThan(replay.long-20);
 expect(replay.animations).toEqual([]);
});

test('production selection owner keeps replaced Move, Turn and Live controls pending through geometry settlement',async({page})=>{
 await page.setViewportSize({width:390,height:500});await mountFixture(page);
 const receipt=await page.evaluate(async()=>{
  const [{createHistorySelectionActions},{createHistorySelectionTransition},{historySelectionLoading},{updateComputerBoardLoading}]=await Promise.all([
   import('/shell/history-selection-actions.js'),import('/shell/history-selection-transition.js'),import('/shell/playback-presentation.js'),import('/shell/board-message-layout.js'),
  ]);
  const panel=document.createElement('section');document.body.append(panel);
  const geometry=document.createElement('section');geometry.style.height='40px';document.body.append(geometry);
  const activity=document.querySelector('.board-message-activity');
  const events=[];
  const transition=createHistorySelectionTransition({duration:40});
  const actions=createHistorySelectionActions({transition,onPendingChange:episode=>{
   const loading=historySelectionLoading({id:'g'},episode);
   updateComputerBoardLoading(activity,{id:'g'},{},{loadingKey:loading.key,suppressLoadingCue:true});
   events.push(episode?'pending':'clear');
   if(!episode)panel.querySelectorAll('[data-history-selection-episode-pending="true"]').forEach(element=>{
    const overlay=element.closest('.history-return-live.is-transition-overlay');element.classList.remove('history-selection-pending');element.removeAttribute('aria-busy');element.removeAttribute('data-history-selection-episode-pending');overlay?.remove();
   });
  }});
  const run=async(scope,replacement)=>{
   panel.innerHTML='<button data-trigger>select</button>';const trigger=panel.querySelector('[data-trigger]');
   const selection=actions.run({scope,trigger,select:()=>{
    const captured=transition.capture(geometry);panel.innerHTML=replacement;geometry.style.height=geometry.style.height==='40px'?'100px':'40px';transition.present(captured,guard=>events.push(guard()?'reveal':'stale-reveal'));return scope;
   }});
   const current=panel.querySelector('[data-history-selection-episode-pending="true"]');
   const whilePending={originalConnected:trigger.isConnected,pulse:current?.classList.contains('history-selection-pending'),busy:current?.getAttribute('aria-busy'),loading:activity.dataset.loadingState,key:activity.dataset.loadingKey,suppressed:activity.dataset.loadingSuppressed};
   await selection;
   return{whilePending,settled:{pulse:current?.classList.contains('history-selection-pending'),busy:current?.hasAttribute('aria-busy'),marker:current?.hasAttribute('data-history-selection-episode-pending'),loading:activity.dataset.loadingState}};
  };
  const move=await run('g:move:m1','<li class="history-item history-selection-pending" aria-busy="true" data-history-selection-episode-pending="true">Move 1</li>');
  const turn=await run('g:turn:2','<li class="history-turn history-selection-pending" aria-busy="true" data-history-selection-episode-pending="true">Turn 2</li>');
  const live=await run('g:live','<li class="history-return-live is-transition-overlay"><button class="history-selection-pending" aria-busy="true" data-history-selection-episode-pending="true" disabled>Return to live view</button></li><li>Live · Waiting on you to move</li>');
  panel.remove();geometry.remove();return{move,turn,live,events};
 });
 for(const [name,result] of Object.entries({move:receipt.move,turn:receipt.turn,live:receipt.live})){
  expect(result.whilePending,`${name} replacement retains pending`).toMatchObject({originalConnected:false,pulse:true,busy:'true',loading:'pending',suppressed:'true'});
  expect(result.settled,`${name} replacement clears only at settlement`).toEqual({pulse:false,busy:false,marker:false,loading:'idle'});
 }
 expect(receipt.move.whilePending.key).toBe('history-selection:1:g:move:m1');
 expect(receipt.turn.whilePending.key).toBe('history-selection:2:g:turn:2');
 expect(receipt.live.whilePending.key).toBe('history-selection:3:g:live');
 expect(receipt.events).toEqual(['pending','reveal','clear','pending','reveal','clear','pending','reveal','clear']);
});

test('native pointer and keyboard History activation keep the transition owner through the gesture-deferred commit',async({page})=>{
 await page.goto('/shell/history-selection-actions.js');
 await page.setContent('<main id="app"><div data-game-shell-root><section class="panel" data-game-panel="history"></section><section class="panel" data-shell-panel="board" style="height:300px"></section></div></main>');
 await page.evaluate(async()=>{
  const [{createRenderGestureGate},{mountRenderGestureOwner},{createHistorySelectionActions},{createHistorySelectionTransition}]=await Promise.all([
   import('/shell/render-gesture.js'),import('/shell/render-gesture-owner.js'),import('/shell/history-selection-actions.js'),import('/shell/history-selection-transition.js'),
  ]);
  const app=document.querySelector('#app'),shell=app.querySelector('[data-game-shell-root]'),history=app.querySelector('[data-game-panel="history"]');
  const heights={'move:1':100,'move:2':180,'turn:3':120,'move:4':200,'turn:5':140,'turn:6':220,live:160};
  let selected='move:1',gate,actions;
  const commits=[];
  const markup=()=>{
   history.style.height=`${heights[selected]}px`;
   history.innerHTML=Object.keys(heights).map(scope=>`<button type="button" data-history-scope="${scope}" aria-current="${scope===selected}">${scope}</button>`).join('');
  };
  const transition=createHistorySelectionTransition();
  const commit=()=>{
   const captured=transition.capture(shell),pending=actions.snapshot()?.scope??null;
   markup();
   const animated=transition.present(captured);
   commits.push({scope:selected,pending,animated});
  };
  const render=()=>{if(gate.defer({includeBoard:true}))return false;commit();return true;};
  gate=createRenderGestureGate({render:commit});
  actions=createHistorySelectionActions({transition,onPresentationReady:async()=>{render();await gate.waitForFlush();}});
  const gestureOwner=mountRenderGestureOwner({appEl:app,window,document,renderGesture:gate});
  app.addEventListener('click',event=>{
   const trigger=event.target.closest('[data-history-scope]');if(!trigger)return;
   const scope=trigger.dataset.historyScope;
   void actions.run({scope,trigger,select:()=>{selected=scope;return scope;},accepted:value=>value===scope}).then(result=>{
    app.dataset.settled=result.accepted?scope:'rejected';
   });
  });
  markup();
  window.__historyGestureReceipt=()=>({selected,commits:[...commits],pending:actions.snapshot(),settled:app.dataset.settled??null});
  window.__disposeHistoryGesture=()=>{gestureOwner.destroy();gate.destroy();transition.cancel();actions.retire();};
 });
 const cases=[['move:2','pointer'],['turn:3','pointer'],['move:4','pointer'],['turn:5','keyboard'],['turn:6','keyboard'],['live','keyboard']];
 for(const [scope,input] of cases){
  const control=page.locator(`[data-history-scope="${scope}"]`);
  if(input==='pointer')await control.click();else{await control.focus();await control.press('Enter');}
  await expect(page.locator('#app')).toHaveAttribute('data-settled',scope);
  const receipt=await page.evaluate(()=>window.__historyGestureReceipt());
  expect(receipt.commits.at(-1)).toEqual({scope,pending:scope,animated:true});
  expect(receipt.pending).toBeNull();
 }
 await page.evaluate(()=>window.__disposeHistoryGesture());
});
