import {test,expect} from '@playwright/test';
test.use({viewport:{width:390,height:740},hasTouch:true});
const geometry=page=>page.locator('#board').evaluate(el=>{const rect=el.getBoundingClientRect();return{x:rect.x,y:rect.y,width:rect.width,height:rect.height};});

test('replay message steps preserve action nodes and keyboard focus',async({page})=>{
 await page.goto('/browser-integration/support/board-message.html');await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(async()=>{
  await window.boardFixture.setup('pass',false);
  window.replayMessage={text:'Replay · 1 of 3',actions:[{id:'replay-next',label:'Next'},{id:'replay-stop',label:'Stop replay'}]};
  window.boardFixture.message(window.replayMessage);
 });
 const stop=page.getByRole('button',{name:'Stop replay',exact:true});await stop.focus();
 await page.evaluate(()=>{window.savedReplayStop=document.activeElement;window.savedReplayNext=document.querySelector('[data-board-message-action="replay-next"]');});
 const before=await geometry(page);
 for(const step of [2,3]){
  await page.evaluate(step=>window.boardFixture.message({...window.replayMessage,text:`Replay · ${step} of 3`}),step);
  await expect(page.locator('#preview')).toContainText(`Replay · ${step} of 3`);
  expect(await page.evaluate(()=>({stop:window.savedReplayStop===document.querySelector('[data-board-message-action="replay-stop"]'),next:window.savedReplayNext===document.querySelector('[data-board-message-action="replay-next"]'),focus:document.activeElement===window.savedReplayStop}))).toEqual({stop:true,next:true,focus:true});
  expect(await geometry(page)).toEqual(before);
 }
 await stop.press('Enter');expect(await page.evaluate(()=>window.boardFixture.messageActions())).toEqual(['replay-stop']);
 expect(await page.evaluate(()=>window.boardFixture.applied())).toEqual([]);
 await page.evaluate(()=>window.boardFixture.message({text:'Finished <safely>',action:{id:'replay-computer',label:'Show me again'}}));
 await expect(stop).toHaveCount(0);await expect(page.getByRole('button',{name:'Show me again',exact:true})).toBeVisible();
 await expect(page.locator('#preview')).toContainText('Finished <safely>');expect(await page.locator('#preview safely').count()).toBe(0);
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
  const measure=()=>page.locator('main').evaluate(main=>{
    const rect=selector=>{const value=main.querySelector(selector).getBoundingClientRect();return{x:value.x,y:value.y,width:value.width,height:value.height};};
    return{cardHeight:main.getBoundingClientRect().height,board:rect('#board'),slot:rect('.board-message-slot')};
  });
  const initial=await measure();
  expect(initial.slot.height).toBeGreaterThanOrEqual(44);
  if(scale==='100%')expect(initial.slot.height).toBeCloseTo(49.6,0);
  await expect(page.getByRole('button',{name:'Pass',exact:true})).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Show me again',exact:true})).toHaveCount(0);
  for(const phase of ['thinking','completed','completed-pass','selection','loading','human']){
    await page.evaluate(async phase=>{
      const {computerBoardMessage}=await import('/apps/web/shell/computer-narration.js');
      const {opponentBoardMessage}=await import('/apps/web/shell/opponent-narration.js');
      const {renderBoardMessageSlot}=await import('/apps/web/shell/board-message-layout.js');
      const game={computer:{seats:{p1:null,p2:'horus'}},board:{state:{turnIndex:1}},turns:[{index:0,status:'complete'}],moves:[{turnIndex:0,computerProof:{profile:'horus'},action:{type:'retreat',from:{row:9,col:9},to:{row:0,col:0}}}]};
      if(phase==='thinking')game.computerTurn='horus';
      window.updateComputerBoardLoading(document.querySelector('.board-message-activity'),game,{phase:'looking-ahead'});
      const preview=document.querySelector('#preview');
      if(phase==='loading'){preview.closest('.board-message-slot').outerHTML=renderBoardMessageSlot({id:'preview',loading:true});return;}
      if(phase==='selection'){preview.textContent='Piece at (9, 9) – Select a move';return;}
      if(phase==='human'){preview.innerHTML='Select a piece <button type="button" class="board-preview-inline-button" data-board-preview-action="pass">Pass</button>';return;}
      if(phase==='thinking')game.computerTurn='horus';
      const message=phase==='completed-pass'?opponentBoardMessage({...game,myRoles:['Player 2'],legalActions:[{type:'pass'}],computer:null,turns:[{index:0,status:'complete',playerSeat:'Player 1'}],moves:[{turnIndex:0,actorSide:'P1',action:{type:'retreat',from:{row:9,col:9},to:{row:0,col:0}}}]},{},{},{canInteract:true}):computerBoardMessage(game,{});
      preview.textContent=typeof message==='string'?message:message.text;
      for(const action of message.actions??(message.action?[message.action]:[])){const button=document.createElement('button');button.type='button';button.className='board-preview-inline-button';button.dataset.boardMessageAction=action.id;button.textContent=action.label;preview.append(' ',button);}
    },phase);
    expect(await measure(),`${phase} must preserve board and card geometry`).toEqual(initial);
    if(phase==='completed'||phase==='completed-pass'){
      await expect(page.getByRole('button',{name:'Show me again',exact:true})).toHaveCount(1);
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
