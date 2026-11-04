import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {settledMessage,measureSemanticGeometry,assertSemanticGeometry} from './support/message-semantic-geometry.mjs';
test.use({viewport:{width:390,height:740},hasTouch:true});
const geometry=page=>page.locator('#board').evaluate(el=>{const rect=el.getBoundingClientRect();return{x:rect.x,y:rect.y,width:rect.width,height:rect.height};});
test('replay message steps preserve action nodes and keyboard focus',async({page})=>{
 await page.goto('/browser-integration/support/board-message.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(async()=>{
  await window.boardFixture.setup('pass',false);
  window.replayMessage={text:'Next',context:{kind:'replay-progress',message:{text:'Replay · 1 of 3'}},actions:[{id:'replay-next',label:'Next'},{id:'replay-stop',label:'Stop replay'}]};
  window.boardFixture.message(window.replayMessage);
 });
 const stop=page.getByRole('button',{name:'Stop replay',exact:true});await stop.focus();
 await page.evaluate(()=>{window.savedReplayStop=document.activeElement;window.savedReplayNext=document.querySelector('[data-board-message-action="replay-next"]');window.savedReplayIcon=window.savedReplayStop.querySelector("svg");window.savedReplayLabel=window.savedReplayStop.querySelector(".board-inline-action-label");});
 await settledMessage(page);const before=await geometry(page);
 for(const step of [2,3]){
  await page.evaluate(step=>window.boardFixture.message({...window.replayMessage,context:{kind:'replay-progress',message:{text:`Replay · ${step} of 3`}}}),step);
  await expect(page.locator('#fixture-context')).toContainText(`Replay · ${step} of 3`);await expect(page.locator('#preview')).not.toContainText('Replay ·');
  expect(await page.evaluate(()=>({stop:window.savedReplayStop===document.querySelector('[data-board-message-action="replay-stop"]'),next:window.savedReplayNext===document.querySelector('[data-board-message-action="replay-next"]'),focus:document.activeElement===window.savedReplayStop}))).toEqual({stop:true,next:true,focus:true});
  await settledMessage(page);expect(await geometry(page)).toEqual(before);
  expect(await stop.evaluate(button=>button.querySelector('svg')===window.savedReplayIcon&&button.querySelector('.board-inline-action-label')===window.savedReplayLabel)).toBe(true);
 }
 await stop.press('Enter');expect(await page.evaluate(()=>window.boardFixture.messageActions())).toEqual(['replay-stop']);
 expect(await page.evaluate(()=>window.boardFixture.applied())).toEqual([]);
 await page.evaluate(()=>window.boardFixture.message({text:'Review the game in History',context:{text:'Finished <safely>',action:{id:'replay-computer',label:'Show me again'}}}));
 await expect(stop).toHaveCount(0);await expect(page.getByRole('button',{name:'Show me again',exact:true})).toBeVisible();
 await expect(page.locator('#fixture-context')).toContainText('Finished <safely>');expect(await page.locator('#fixture-context safely').count()).toBe(0);await expect(page.locator('#preview')).toHaveText('Review the game in History');
});

test('vertical translation preserves exact board layout sizing',async({page},info)=>{
 const evidence={};
 const persist=async()=>{try{await writeFile(info.outputPath('semantic-edge-precision.json'),JSON.stringify(evidence,null,2));}catch(error){console.error(JSON.stringify({kind:'precision-evidence-incomplete',name:error?.name??'Error'}));}};
 try{
 await page.goto('/browser-integration/support/board-message.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(()=>window.boardFixture.setup('pass',false));await settledMessage(page);
 const before=await measureSemanticGeometry(page);
 await page.evaluate(()=>window.boardFixture.message({text:'An acknowledged move has a longer explanation with several coordinate descriptions. A second complete sentence needs additional natural space.',action:{id:'replay-next',label:'Next'}}));
 await settledMessage(page);const changed=await measureSemanticGeometry(page);
 // Persist the raw measured operands before the first precision assertion.
 // A failed hypothesis must retain its evidence, not only the screenshot.
 Object.assign(evidence,{before,changed,status:'positive-assertion-pending'});
 await persist();
 expect(changed.board.y).not.toBe(before.board.y);
 const positive=assertSemanticGeometry(before,changed);evidence.positive=positive;
 let displacement=1/64;
 await page.locator('#board').evaluate((board,amount)=>{board.style.transform=`translateY(${amount}px)`;},displacement);
 let negative=await measureSemanticGeometry(page);
 if(negative.board.y===changed.board.y){displacement=1;await page.locator('#board').evaluate(board=>{board.style.transform='translateY(1px)';});negative=await measureSemanticGeometry(page);}
 expect(negative.board.y).not.toBe(changed.board.y);
 expect(()=>assertSemanticGeometry(before,negative),'the same helper must reject independent real board movement').toThrow();
 await page.locator('#board').evaluate(board=>board.style.removeProperty('transform'));
 expect(await measureSemanticGeometry(page)).toEqual(changed);
 Object.assign(evidence,{positive,negative,displacement,status:'complete'});
 }catch(error){evidence.failure=String(error);throw error;}
 finally{await persist();}
});

test('compact Pass accepts actual touches at both ends of its 44px hit area without moving the board',async({page},info)=>{
  await page.goto('/browser-integration/support/board-message.html');
  await page.waitForFunction(()=>window.fixtureReady);
  await page.evaluate(()=>window.boardFixture.setup('pass',false));
  const pass=page.getByRole('button',{name:'Pass',exact:true});
  await expect(pass).toBeVisible();
  const visual=await pass.boundingBox(),before=await geometry(page);
  expect(visual.width).toBeGreaterThanOrEqual(44);
  expect(visual.height).toBeLessThan(40);
  for(const [index,offset]of[-20,20].entries()){
    const current=await pass.boundingBox(),x=current.x+current.width/2,y=current.y+current.height/2+offset;
    expect(y<current.y||y>current.y+current.height,'The touch must be outside the compact visible button').toBe(true);
    expect(await pass.evaluate((button,{x,y})=>document.elementFromPoint(x,y)?.closest('button')===button,{x,y})).toBe(true);
    await page.touchscreen.tap(x,y);
    await expect.poll(()=>page.evaluate(()=>window.boardFixture.applied())).toEqual(Array.from({length:index+1},()=>({type:'pass'})));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    expect(await geometry(page)).toEqual(before);
    expect(await pass.boundingBox()).toEqual(visual);
  }
  await page.screenshot({path:info.outputPath('compact-pass-expanded-touch.png')});
});

for(const width of [320,390])for(const scale of ['100%','200%'])test(`board messages keep their geometry at ${width}px and ${scale} text`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});
  await page.goto('/browser-integration/support/board-message.html');
  await page.waitForFunction(()=>window.fixtureReady);
  await page.evaluate(async scale=>{
    document.documentElement.style.fontSize=scale;
    await window.boardFixture.setup('pass',false);
    await document.fonts.ready;
  },scale);
  const measure=()=>measureSemanticGeometry(page);
  await settledMessage(page);const initial=await measure();
  expect(initial.slot.height).toBeGreaterThanOrEqual(44);
  // The actual finite primary/fallback replicas reserve the short grammar.
  // Extended narration and obligations have a separate controlled context host.
  const reservation=await page.locator('.board-message-slot').evaluate(slot=>({
    required:Math.max(...[...slot.querySelectorAll('.board-message-sizing')].map(node=>node.getBoundingClientRect().height)),
    padding:parseFloat(getComputedStyle(slot).paddingTop)+parseFloat(getComputedStyle(slot).paddingBottom),
  }));
  expect(initial.slot.height).toBeCloseTo(reservation.required+reservation.padding,5);
  await expect(page.getByRole('button',{name:'Pass',exact:true})).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Show me again',exact:true})).toHaveCount(0);
  for(const phase of ['thinking','completed','completed-pass','multi-push','multi-rush','spectator-long-name','selection','frozen-reconnect','frozen-retreat','frozen-follow','loading','human']){
    await page.evaluate(async phase=>{
      const {computerBoardMessage}=await import('/apps/web/shell/computer-narration.js');
      const {opponentBoardMessage}=await import('/apps/web/shell/opponent-narration.js');
      const {renderBoardMessageSlot}=await import('/apps/web/shell/board-message-layout.js');
      const game={computer:{seats:{p1:null,p2:'horus'}},board:{state:{turnIndex:1}},turns:[{index:0,status:'complete'}],moves:[{turnIndex:0,computerProof:{profile:'horus'},action:{type:'retreat',from:{row:9,col:9},to:{row:0,col:0}}}]};
      if(phase==='multi-push'||phase==='multi-rush'){
        const {describeTurn,moveCoordinates}=await import('/apps/web/shell/computer-narration.js');
        const point=(row,col)=>({row,col}),move=(type,actorId,from,to)=>({action:{type,actorId,from,to}});
        const moves=phase==='multi-push'?[move('push','a',point(9,9),point(0,0)),move('follow','a',point(0,0),point(1,0)),move('follow','b',point(1,1),point(0,1))]:[move('rush','a',point(9,9),point(0,0)),move('rush','b',point(9,8),point(0,1))];
        window.boardFixture.message({text:'Select a piece or',action:{id:'pass',label:'Pass'},context:{text:describeTurn(moves,'Your opponent'),coordinates:moveCoordinates(moves),action:{id:'replay-computer',label:'Show me again'}}});return;
      }
      if(phase==='thinking')game.computerTurn='horus';
      window.updateComputerBoardLoading(document.querySelector('.board-message-activity'),game,{phase:'looking-ahead'});
      const preview=document.querySelector('#preview');
      if(phase==='loading'){window.boardFixture.message({text:'Loading play'});return;}
      if(phase==='selection'){window.boardFixture.message({text:'Select a move for piece at (9, 9)',coordinates:[{row:9,col:9}]});return;}
      if(phase.startsWith('frozen-')){
        const {getSelectedPieceExplanation,SELECTED_CONTINUATION_LABELS}=await import('/apps/web/board/piece-explanations.js');
        const {renderCoordinateChip}=await import('/apps/web/board/coordinate-chip.js');
        const type=phase==='frozen-reconnect'?'rush':'push',piece={id:'selected',supplied:true,commanded:true};
        const explanation=getSelectedPieceExplanation(piece,{continuation:{type,frozenPieceStatesById:{selected:{supplied:false,commanded:false}}}});
        if(typeof explanation!=='string'||!explanation.trim())throw Error('Frozen continuation must produce a real piece explanation');
        const coordinate=renderCoordinateChip({row:9,col:9}),continuation=phase==='frozen-reconnect'?`${SELECTED_CONTINUATION_LABELS.rushBlocker} ${coordinate}`:phase==='frozen-retreat'?SELECTED_CONTINUATION_LABELS.retreat:SELECTED_CONTINUATION_LABELS.follow;
        window.boardFixture.message({text:phase==='frozen-reconnect'?'Select a rush to restore supply':phase==='frozen-retreat'?'Select a retreat for piece at (9, 9)':'Select a follow',coordinates:phase==='frozen-retreat'?[{row:9,col:9}]:[],context:{text:`${explanation} for piece at (9, 9) · ${continuation.replace(/<[^>]+>/g,'')}`,coordinates:[{row:9,col:9}],mandatory:phase==='frozen-reconnect'}});return;
      }

      if(phase==='human'){window.boardFixture.message({text:'Select a piece or',action:{id:'pass',label:'Pass'}});return;}
      if(phase==='thinking')game.computerTurn='horus';
      const longName='界'.repeat(16)+'W'.repeat(16);
      const rawMessage=phase==='spectator-long-name'?opponentBoardMessage({id:'named-viewer',myRole:'Viewer',myRoles:['Viewer'],player1:{identityId:'p1',profile:{displayName:longName}},player2:{identityId:'p2'},controlSeat:'Player 2',board:{state:{turnIndex:1,sideToMove:'P2'}},turns:[{index:0,status:'complete',playerSeat:'Player 1'}],moves:[{turnIndex:0,actorSide:'P1',action:{type:'retreat',from:{row:9,col:9},to:{row:0,col:0}}}]},{},{},{canInteract:false,identityId:'viewer'}):phase==='completed-pass'?opponentBoardMessage({...game,myRoles:['Player 2'],legalActions:[{type:'pass'}],computer:null,turns:[{index:0,status:'complete',playerSeat:'Player 1'}],moves:[{turnIndex:0,actorSide:'P1',action:{type:'retreat',from:{row:9,col:9},to:{row:0,col:0}}}]},{},{},{canInteract:true}):computerBoardMessage(game,{});
      const message=rawMessage&&typeof rawMessage==='object'&&rawMessage.action?.id==='replay-computer'?{text:'Select a piece',context:rawMessage}:rawMessage;
      if(phase==='spectator-long-name'&&(!message?.context?.text?.startsWith(`${longName} `)||message.context.action?.label!=='Show me again'))throw Error('Spectator narration must retain the actual full name and replay action');
      if(phase==='spectator-long-name')window.namedSpectatorMessage=message;
      window.boardFixture.message(message);
    },phase);
    await settledMessage(page);const current=await measure();
    assertSemanticGeometry(initial,current);expect(current.board).toEqual(initial.board);
    expect(await page.locator('[data-prompt-overflow="true"],[data-prompt-unmapped="true"]').count()).toBe(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(phase==='frozen-reconnect'&&width===320)await page.screenshot({path:info.outputPath(`stable-frozen-reconnect-${width}-${scale}.png`)});
    if(phase==='completed'||phase==='completed-pass'||phase==='spectator-long-name'){
      await expect(page.getByRole('button',{name:'Show me again',exact:true})).toHaveCount(1);
      if(phase==='spectator-long-name'){
        const name=page.locator('#fixture-context .board-message-name'),replay=page.getByRole('button',{name:'Show me again',exact:true});
        await expect(name).toHaveAttribute('dir','auto');await expect(name).toHaveAttribute('title','界'.repeat(16)+'W'.repeat(16));await expect(name).toHaveText('界'.repeat(16)+'W'.repeat(16));
        expect(await name.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
        await replay.focus();await replay.evaluate(button=>{window.namedReplayButton=button;window.namedActorNode=button.closest('[data-board-context]').querySelector('.board-message-name');});
        await page.evaluate(()=>window.boardFixture.message({...window.namedSpectatorMessage,context:{...window.namedSpectatorMessage.context,text:window.namedSpectatorMessage.context.text.replace('retreated','followed')}}));
        await expect(replay).toBeFocused();expect(await replay.evaluate(button=>button===window.namedReplayButton&&button.closest('[data-board-context]').querySelector('.board-message-name')===window.namedActorNode)).toBe(true);
        await expect(page.locator('#fixture-context')).toContainText('followed a piece from 9, 9 to 0, 0');
        await settledMessage(page);expect(await measure(),'Same-layout named narration refresh preserves settled geometry and action focus').toEqual(current);
      }
      if(phase==='completed-pass')await expect(page.getByRole('button',{name:'Pass',exact:true})).toHaveCount(1);
      const replay=page.getByRole('button',{name:'Show me again',exact:true});
      const replayBox=await replay.boundingBox();expect(replayBox.width).toBeGreaterThanOrEqual(44);expect(replayBox.height).toBeGreaterThanOrEqual(44);
      expect(await replay.evaluate(button=>button.closest('#preview')===null)).toBe(true);
      if(phase==='completed-pass'){
       const typography=await page.evaluate(()=>{const properties=['fontFamily','fontSize','fontWeight','lineHeight','height','padding','borderWidth'];const style=selector=>{const computed=getComputedStyle(document.querySelector(selector));return Object.fromEntries(properties.map(key=>[key,computed[key]]));};return{live:style('#preview button'),replica:style('.board-message-sizing button')};});
       expect(typography.live).toEqual(typography.replica);
      }
      await page.screenshot({path:info.outputPath(`stable-${phase}-${width}-${scale}.png`)});
    }
  }
  const replicas=page.locator('.board-message-sizing');
  expect(await replicas.evaluateAll(nodes=>nodes.every(node=>node.inert&&node.getAttribute('aria-hidden')==='true'&&getComputedStyle(node).visibility==='hidden'&&!node.querySelector('[data-action],[data-board-preview-action],[data-board-message-action],[id]')))).toBe(true);
});

test('computer loading pieces remain continuous, plain and motion-aware beside the prompt',async({page},info)=>{
 await page.setViewportSize({width:320,height:1000});
 await page.goto('/browser-integration/support/board-message.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(async()=>{document.documentElement.style.fontSize='200%';await window.boardFixture.setup('pass',false);});
 const initial=await geometry(page),host=page.locator('.board-message-activity');
 const profiles=await page.evaluate(async()=>Object.keys((await import('/apps/web/generated/packages/shared-types/src/computer-play.js')).COMPUTER_PROFILES));
 for(const profile of profiles){
  await page.evaluate(async profile=>{
   const {computerBoardMessage}=await import('/apps/web/shell/computer-narration.js');
      const {opponentBoardMessage}=await import('/apps/web/shell/opponent-narration.js');
   window.cueGame={id:`cue-${profile}`,computer:{paused:false},computerTurn:profile};
   window.cueProfile=profile;
   document.querySelector('#preview').textContent=computerBoardMessage(window.cueGame,{profile,phase:'preparing'});
   window.updateComputerBoardLoading(document.querySelector('.board-message-activity'),window.cueGame,{profile,phase:'preparing'},{scope:'owner'});
  },profile);
  await expect(host).toHaveAttribute('data-loading-phase','visible');
  await expect(host.locator('.loading-pieces i')).toHaveCount(3);
  const key=await host.getAttribute('data-loading-key');
  await page.evaluate(()=>{window.pieces=document.querySelector('.board-message-activity .loading-pieces');window.pulse=window.pieces.querySelector('i').getAnimations()[0];window.pulse.pause();window.pulse.currentTime=700;});
  for(const phase of ['checking','looking-ahead','saving']){
   await page.evaluate(async phase=>{
    const {computerBoardMessage}=await import('/apps/web/shell/computer-narration.js');
      const {opponentBoardMessage}=await import('/apps/web/shell/opponent-narration.js');
    if(phase==='saving'){window.cueGame.pendingComputerSaveStartedAt=0;window.cueGame.computerTurn=null;}
    // Match runtime prompt writes: the sibling animation host remains untouched.
    document.querySelector('#preview').innerHTML=computerBoardMessage(window.cueGame,{profile:window.cueProfile,phase});
    window.updateComputerBoardLoading(document.querySelector('.board-message-activity'),window.cueGame,{phase},{scope:'owner'});
   },phase);
   await expect(host).toHaveAttribute('data-loading-key',key);
   expect(await page.evaluate(()=>({same:window.pieces===document.querySelector('.board-message-activity .loading-pieces'),time:window.pulse.currentTime,text:document.querySelector('.board-message-activity').textContent}))).toEqual({same:true,time:700,text:''});
   await expect(page.locator('#preview')).not.toContainText(/…|\.\.\./);
   expect(await geometry(page)).toEqual(initial);
  }
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 expect(await host.locator('i').first().evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
 await page.screenshot({path:info.outputPath('computer-pieces-reduced-motion.png')});
 for(const stop of ['completed','paused','recovery','history','replay']){
  await page.evaluate(stop=>{
   const game={id:'cue-stop',computer:{paused:false},computerTurn:'tau'};
   window.updateComputerBoardLoading(document.querySelector('.board-message-activity'),game,{phase:'looking-ahead'},{scope:'owner'});
   if(stop==='completed')game.computerTurn=null;if(stop==='paused')game.computer.paused=true;if(stop==='history')game.inHistoryMode=true;
   window.updateComputerBoardLoading(document.querySelector('.board-message-activity'),game,{phase:stop==='recovery'?'recovery':'looking-ahead'},{scope:'owner',replaying:stop==='replay'});
  },stop);
  await expect(host).toHaveAttribute('data-loading-state','idle');await expect(host.locator('.loading-pieces')).toHaveCount(0);
  expect(await geometry(page)).toEqual(initial);
 }
 expect(await page.locator('.board-message-sizing [data-loading-state],.board-message-sizing .loading-pieces').count()).toBe(0);
});

test('admission changes preserve independent context, selection, baseline-aligned chips and disabled controls',async({page})=>{
 await page.goto('/browser-integration/support/board-message.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(async()=>{
  await window.boardFixture.setup('pass',false);
  const {opponentBoardMessage}=await import('/apps/web/shell/opponent-narration.js');
  const game={myRoles:['Player 2'],controlSeat:'Player 2',legalActions:[{type:'pass'}],board:{state:{turnIndex:1,sideToMove:'P2'}},turns:[{index:0,playerSeat:'Player 1',status:'complete'}],moves:[{turnIndex:0,actorSide:'P1',action:{type:'move',from:{row:1,col:2},to:{row:2,col:2}}}]};
  window.stableMessageGame=game;window.opponentMessage=opponentBoardMessage;
  window.boardFixture.message(opponentBoardMessage(game,{}, {},{canInteract:true}));
 });
 const prompt=page.locator('#preview'),pass=page.getByRole('button',{name:'Pass',exact:true});
 await expect(prompt.locator('.board-message-row')).toHaveCount(0);
 await expect(page.locator('#fixture-context .board-preview-coordinate-chip')).toHaveCount(2);
 await expect(page.locator('#fixture-context')).toContainText('Show me again');
 await expect(prompt).toHaveText('Select a piece or Pass');
 await settledMessage(page);const copy=await prompt.textContent(),before=await geometry(page);
 for(const blocked of [true,false,true,false]){
  await page.evaluate(blocked=>{
   window.boardFixture.message(window.opponentMessage({...window.stableMessageGame,sharedMutationsBlocked:blocked,recovering:blocked},{}, {},{canInteract:!blocked}));
   window.boardFixture.gateInteraction(blocked);
  },blocked);
  if(blocked)await expect(pass).toBeDisabled();else await expect(pass).toBeEnabled();
  await settledMessage(page);expect(await prompt.textContent()).toBe(copy);expect(await geometry(page)).toEqual(before);
  if(blocked)await pass.evaluate(button=>button.click());
 }
 expect(await page.evaluate(()=>window.boardFixture.applied())).toEqual([]);
 expect(await pass.evaluate(el=>getComputedStyle(el).verticalAlign)).toBe('baseline');
 // A prepared move remains a move preview while submission admission changes.
 await page.evaluate(async()=>{await window.boardFixture.setup('rush',false);});
 await page.locator('[data-row="4"][data-col="2"]').click();
 const selectedCopy=await prompt.textContent(),selection=await page.evaluate(()=>window.boardFixture.selection());
 expect(selectedCopy).toContain('Select a move for piece at');
 expect(await prompt.locator('.board-preview-coordinate-chip').first().evaluate(el=>getComputedStyle(el).verticalAlign)).toBe('baseline');
 for(const blocked of [true,false,true,false]){
  await page.evaluate(blocked=>window.boardFixture.gateInteraction(blocked),blocked);
  expect(await prompt.textContent()).toBe(selectedCopy);
  expect(await page.evaluate(()=>window.boardFixture.selection())).toEqual(selection);
  await expect(page.locator('.move-ghost').first()).toBeVisible();
 }
});
