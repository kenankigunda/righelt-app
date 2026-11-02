import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {admittedHeight,budgetPixelPrecision} from './support/message-reservation-policy.mjs';
test.use({viewport:{width:390,height:740},hasTouch:true});
const geometry=page=>page.locator('#board').evaluate(el=>{const rect=el.getBoundingClientRect();return{x:rect.x,y:rect.y,width:rect.width,height:rect.height};});
const settledMessage=async page=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForFunction(()=>![...document.querySelectorAll('.board-message-slot')].some(slot=>slot.getAnimations().some(animation=>animation.pending||animation.playState==='running')));};

// All vertical arithmetic uses atomic viewport edges. Firefox can expose
// float32 edges; allow only the sum of their half-ULP representation bounds.
// Non-float32 inputs retain exact arithmetic, not an assumed pixel epsilon.
const edgeDelta=(next,previous,slotNext,slotPrevious,label)=>{
 const inputs=[next,previous,slotNext,slotPrevious];
 const bound=inputs.reduce((sum,value)=>sum+(value!==0&&Math.fround(value)===value?2**(Math.floor(Math.log2(Math.abs(value)))-24):0),0);
 expect(Math.abs((next-previous)-(slotNext-slotPrevious)),label).toBeLessThanOrEqual(bound);
 return{inputs,bound};
};
const measureSemanticGeometry=page=>page.locator('main').evaluate(main=>{
 const rect=node=>{const value=node.getBoundingClientRect();return{x:value.x,y:value.y,bottom:value.bottom,width:value.width,height:value.height};};
 return{card:rect(main),board:rect(main.querySelector('#board')),boardLayoutHeight:getComputedStyle(main.querySelector('#board')).height,slot:rect(main.querySelector('.board-message-slot'))};
});
const assertSemanticGeometry=(initial,current)=>{
 expect({x:current.board.x,width:current.board.width,layoutHeight:current.boardLayoutHeight}).toEqual({x:initial.board.x,width:initial.board.width,layoutHeight:initial.boardLayoutHeight});
 expect({x:current.slot.x,y:current.slot.y,width:current.slot.width,cardTop:current.card.y}).toEqual({x:initial.slot.x,y:initial.slot.y,width:initial.slot.width,cardTop:initial.card.y});
 const board=edgeDelta(current.board.y,initial.board.y,current.slot.bottom,initial.slot.bottom,'board movement must come only from semantic slot growth');
 const card=edgeDelta(current.card.bottom,initial.card.bottom,current.slot.bottom,initial.slot.bottom,'card movement must come only from semantic slot growth');
 expect(current.board.y).toBeGreaterThanOrEqual(current.slot.bottom);
 return{board,card};
};

test('replay message steps preserve action nodes and keyboard focus',async({page})=>{
 await page.goto('/browser-integration/support/board-message.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(async()=>{
  await window.boardFixture.setup('pass',false);
  window.replayMessage={text:'Replay · 1 of 3',actions:[{id:'replay-next',label:'Next'},{id:'replay-stop',label:'Stop replay'}]};
  window.boardFixture.message(window.replayMessage);
 });
 const stop=page.getByRole('button',{name:'Stop replay',exact:true});await stop.focus();
 await page.evaluate(()=>{window.savedReplayStop=document.activeElement;window.savedReplayNext=document.querySelector('[data-board-message-action="replay-next"]');window.savedReplayIcon=window.savedReplayStop.querySelector("svg");window.savedReplayLabel=window.savedReplayStop.querySelector(".board-inline-action-label");});
 await settledMessage(page);const before=await geometry(page);
 for(const step of [2,3]){
  await page.evaluate(step=>window.boardFixture.message({...window.replayMessage,text:`Replay · ${step} of 3`}),step);
  await expect(page.locator('#preview')).toContainText(`Replay · ${step} of 3`);
  expect(await page.evaluate(()=>({stop:window.savedReplayStop===document.querySelector('[data-board-message-action="replay-stop"]'),next:window.savedReplayNext===document.querySelector('[data-board-message-action="replay-next"]'),focus:document.activeElement===window.savedReplayStop}))).toEqual({stop:true,next:true,focus:true});
  await settledMessage(page);expect(await geometry(page)).toEqual(before);
  expect(await stop.evaluate(button=>button.querySelector('svg')===window.savedReplayIcon&&button.querySelector('.board-inline-action-label')===window.savedReplayLabel)).toBe(true);
 }
 await stop.press('Enter');expect(await page.evaluate(()=>window.boardFixture.messageActions())).toEqual(['replay-stop']);
 expect(await page.evaluate(()=>window.boardFixture.applied())).toEqual([]);
 await page.evaluate(()=>window.boardFixture.message({text:'Finished <safely>',action:{id:'replay-computer',label:'Show me again'}}));
 await expect(stop).toHaveCount(0);await expect(page.getByRole('button',{name:'Show me again',exact:true})).toBeVisible();
 await expect(page.locator('#preview')).toContainText('Finished <safely>');expect(await page.locator('#preview safely').count()).toBe(0);
});

test('vertical translation preserves exact board layout sizing',async({page},info)=>{
 await page.goto('/browser-integration/support/board-message.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(()=>window.boardFixture.setup('pass',false));await settledMessage(page);
 const before=await measureSemanticGeometry(page);
 await page.evaluate(()=>window.boardFixture.message({text:'An acknowledged move has a longer explanation with several coordinate descriptions. A second complete sentence needs additional natural space.',action:{id:'replay-next',label:'Next'}}));
 await settledMessage(page);const changed=await measureSemanticGeometry(page);
 expect(changed.board.y).not.toBe(before.board.y);
 const positive=assertSemanticGeometry(before,changed);
 let displacement=1/64;
 await page.locator('#board').evaluate((board,amount)=>{board.style.transform=`translateY(${amount}px)`;},displacement);
 let negative=await measureSemanticGeometry(page);
 if(negative.board.y===changed.board.y){displacement=1;await page.locator('#board').evaluate(board=>{board.style.transform='translateY(1px)';});negative=await measureSemanticGeometry(page);}
 expect(negative.board.y).not.toBe(changed.board.y);
 expect(()=>assertSemanticGeometry(before,negative),'the same helper must reject independent real board movement').toThrow();
 await page.locator('#board').evaluate(board=>board.style.removeProperty('transform'));
 expect(await measureSemanticGeometry(page)).toEqual(changed);
 await writeFile(info.outputPath('semantic-edge-precision.json'),JSON.stringify({before,changed,positive,negative,displacement},null,2));
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
  // The frozen-sequence explanation is three wrapped lines at320px. Measure
  // the real finite replicas at intrinsic height, rather than the old two-line
  // minimum that predates mandatory reconnect/retreat/follow explanations.
  const reservation=await page.locator('.board-message-slot').evaluate(slot=>{
    const width=slot.getBoundingClientRect().width;
    const heights=[...slot.querySelectorAll('.board-message-sizing')].map(node=>{
      const copy=node.cloneNode(true);copy.style.cssText=`position:absolute;inline-size:${width}px;height:auto;align-self:start;margin:0`;
      slot.append(copy);const height=copy.getBoundingClientRect().height;copy.remove();return height;
    });
    const intrinsicFallback=[...slot.querySelectorAll('.board-message-fallback-sizing')].map(node=>{
      const copy=node.cloneNode(true);copy.style.cssText=`position:absolute;inline-size:${width}px;height:auto;min-height:0;align-self:start;margin:0`;
      slot.append(copy);const height=copy.getBoundingClientRect().height;copy.remove();return height;
    });
    return {required:Math.max(...heights),intrinsicFallback:Math.max(...intrinsicFallback),lineHeight:parseFloat(getComputedStyle(slot.querySelector('.board-preview-label')).lineHeight)};
  });
  expect(initial.slot.height).toBeCloseTo(reservation.required,5);
  expect(budgetPixelPrecision(initial.slot.height)).toBeLessThanOrEqual(budgetPixelPrecision(admittedHeight(initial.slot.width,reservation.lineHeight/1.5,reservation.intrinsicFallback)));
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
        window.boardFixture.message({rows:[{text:describeTurn(moves,'Your opponent'),coordinates:moveCoordinates(moves),action:{id:'replay-computer',label:'Show me again'}},{text:'Select a piece or',action:{id:'pass',label:'Pass'}}]});return;
      }
      if(phase==='thinking')game.computerTurn='horus';
      window.updateComputerBoardLoading(document.querySelector('.board-message-activity'),game,{phase:'looking-ahead'});
      const preview=document.querySelector('#preview');
      if(phase==='loading'){preview.closest('.board-message-slot').outerHTML=renderBoardMessageSlot({id:'preview',loading:true});return;}
      if(phase==='selection'){preview.textContent='Piece at (9, 9) – Select a move';return;}
      if(phase.startsWith('frozen-')){
        const {getSelectedPieceExplanation,SELECTED_CONTINUATION_LABELS}=await import('/apps/web/board/piece-explanations.js');
        const {renderCoordinateChip}=await import('/apps/web/board/coordinate-chip.js');
        const type=phase==='frozen-reconnect'?'rush':'push',piece={id:'selected',supplied:true,commanded:true};
        const explanation=getSelectedPieceExplanation(piece,{continuation:{type,frozenPieceStatesById:{selected:{supplied:false,commanded:false}}}});
        if(typeof explanation!=='string'||!explanation.trim())throw Error('Frozen continuation must produce a real piece explanation');
        const coordinate=renderCoordinateChip({row:9,col:9}),continuation=phase==='frozen-reconnect'?`${SELECTED_CONTINUATION_LABELS.rushBlocker} ${coordinate}`:phase==='frozen-retreat'?SELECTED_CONTINUATION_LABELS.retreat:SELECTED_CONTINUATION_LABELS.follow;
        preview.innerHTML=`Piece at ${coordinate} – ${explanation} · ${continuation}`;return;
      }

      if(phase==='human'){const {renderBoardInlineAction}=await import('/apps/web/board/message-presentation.js');preview.innerHTML=`Select a piece ${renderBoardInlineAction({id:'pass',label:'Pass'},{preview:true})}`;return;}
      if(phase==='thinking')game.computerTurn='horus';
      const longName='界'.repeat(16)+'W'.repeat(16);
      const message=phase==='spectator-long-name'?opponentBoardMessage({id:'named-viewer',myRole:'Viewer',myRoles:['Viewer'],player1:{identityId:'p1',profile:{displayName:longName}},player2:{identityId:'p2'},controlSeat:'Player 2',board:{state:{turnIndex:1,sideToMove:'P2'}},turns:[{index:0,status:'complete',playerSeat:'Player 1'}],moves:[{turnIndex:0,actorSide:'P1',action:{type:'retreat',from:{row:9,col:9},to:{row:0,col:0}}}]},{},{},{canInteract:false,identityId:'viewer'}):phase==='completed-pass'?opponentBoardMessage({...game,myRoles:['Player 2'],legalActions:[{type:'pass'}],computer:null,turns:[{index:0,status:'complete',playerSeat:'Player 1'}],moves:[{turnIndex:0,actorSide:'P1',action:{type:'retreat',from:{row:9,col:9},to:{row:0,col:0}}}]},{},{},{canInteract:true}):computerBoardMessage(game,{});
      if(phase==='spectator-long-name'&&(!message?.text?.startsWith(`${longName} `)||message.action?.label!=='Show me again'))throw Error('Spectator narration must retain the actual full name and replay action');
      if(phase==='spectator-long-name')window.namedSpectatorMessage=message;
      window.boardFixture.message(message);
    },phase);
    await settledMessage(page);const current=await measure();
    // Different semantic messages may use their own intrinsic height. Keep the
    // board size and horizontal placement exact, and account for all vertical
    // movement solely through the settled message slot.
    assertSemanticGeometry(initial,current);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(phase==='frozen-reconnect'&&width===320)await page.screenshot({path:info.outputPath(`stable-frozen-reconnect-${width}-${scale}.png`)});
    if(phase==='completed'||phase==='completed-pass'||phase==='spectator-long-name'){
      await expect(page.getByRole('button',{name:'Show me again',exact:true})).toHaveCount(1);
      if(phase==='spectator-long-name'){
        const name=page.locator('#preview .board-message-name'),replay=page.getByRole('button',{name:'Show me again',exact:true});
        await expect(name).toHaveAttribute('dir','auto');await expect(name).toHaveAttribute('title','界'.repeat(16)+'W'.repeat(16));await expect(name).toHaveText('界'.repeat(16)+'W'.repeat(16));
        expect(await name.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
        await replay.focus();await replay.evaluate(button=>{window.namedReplayButton=button;window.namedActorNode=button.parentElement.querySelector('.board-message-name');});
        await page.evaluate(()=>window.boardFixture.message({...window.namedSpectatorMessage,text:window.namedSpectatorMessage.text.replace('retreated','followed')}));
        await expect(replay).toBeFocused();expect(await replay.evaluate(button=>button===window.namedReplayButton&&button.parentElement.querySelector('.board-message-name')===window.namedActorNode)).toBe(true);
        await expect(page.locator('#preview')).toContainText('followed a piece from 9, 9 to 0, 0');
        await settledMessage(page);expect(await measure(),'Same-layout named narration refresh preserves settled geometry and action focus').toEqual(current);
      }
      if(phase==='completed-pass')await expect(page.getByRole('button',{name:'Pass',exact:true})).toHaveCount(1);
      const typography=await page.evaluate(()=>{const properties=['fontFamily','fontSize','fontWeight','lineHeight','height','padding','borderWidth'];const style=selector=>{const computed=getComputedStyle(document.querySelector(selector));return Object.fromEntries(properties.map(key=>[key,computed[key]]));};return{live:style('#preview button'),replica:style('.board-message-sizing button')};});
      expect(typography.live).toEqual(typography.replica);
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

test('admission changes preserve selection, sentence rows, baseline-aligned chips and disabled controls',async({page})=>{
 await page.goto('/browser-integration/support/board-message.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(async()=>{
  await window.boardFixture.setup('pass',false);
  const {opponentBoardMessage}=await import('/apps/web/shell/opponent-narration.js');
  const game={myRoles:['Player 2'],controlSeat:'Player 2',legalActions:[{type:'pass'}],board:{state:{turnIndex:1,sideToMove:'P2'}},turns:[{index:0,playerSeat:'Player 1',status:'complete'}],moves:[{turnIndex:0,actorSide:'P1',action:{type:'move',from:{row:1,col:2},to:{row:2,col:2}}}]};
  window.stableMessageGame=game;window.opponentMessage=opponentBoardMessage;
  window.boardFixture.message(opponentBoardMessage(game,{}, {},{canInteract:true}));
 });
 const prompt=page.locator('#preview'),pass=page.getByRole('button',{name:'Pass',exact:true});
 await expect(prompt.locator('.board-message-row')).toHaveCount(2);
 await expect(prompt.locator('.board-preview-coordinate-chip')).toHaveCount(2);
 await expect(prompt.locator('.board-message-row').nth(0)).toContainText('Show me again');
 await expect(prompt.locator('.board-message-row').nth(1)).toHaveText('Select a piece or Pass');
 const copy=await prompt.textContent(),before=await geometry(page);
 for(const blocked of [true,false,true,false]){
  await page.evaluate(blocked=>{
   window.boardFixture.message(window.opponentMessage({...window.stableMessageGame,sharedMutationsBlocked:blocked,recovering:blocked},{}, {},{canInteract:!blocked}));
   window.boardFixture.gateInteraction(blocked);
  },blocked);
  if(blocked)await expect(pass).toBeDisabled();else await expect(pass).toBeEnabled();
  expect(await prompt.textContent()).toBe(copy);expect(await geometry(page)).toEqual(before);
  if(blocked)await pass.evaluate(button=>button.click());
 }
 expect(await page.evaluate(()=>window.boardFixture.applied())).toEqual([]);
 expect(await prompt.locator('.board-preview-coordinate-chip').first().evaluate(el=>getComputedStyle(el).verticalAlign)).toBe('baseline');
 expect(await pass.evaluate(el=>getComputedStyle(el).verticalAlign)).toBe('baseline');
 // A prepared move remains a move preview while submission admission changes.
 await page.evaluate(async()=>{await window.boardFixture.setup('rush',false);});
 await page.locator('[data-row="4"][data-col="2"]').click();
 const selectedCopy=await prompt.textContent(),selection=await page.evaluate(()=>window.boardFixture.selection());
 expect(selectedCopy).toContain('Select a move for piece at');
 for(const blocked of [true,false,true,false]){
  await page.evaluate(blocked=>window.boardFixture.gateInteraction(blocked),blocked);
  expect(await prompt.textContent()).toBe(selectedCopy);
  expect(await page.evaluate(()=>window.boardFixture.selection())).toEqual(selection);
  await expect(page.locator('.move-ghost').first()).toBeVisible();
 }
});
