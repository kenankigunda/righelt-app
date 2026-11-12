import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';

const source=await readFile(new URL('../../apps/web/shell/app.js',import.meta.url),'utf8');
const literal=name=>{
 const matches=[...source.matchAll(new RegExp(`const ${name} = (\\d+);`,'g'))];
 if(matches.length!==1)throw Error('SETUPFAIL: transition timing source changed');
 return Number(matches[0][1]);
};
const coverMs=literal('GAME_ENTRY_ROUTE_TRANSITION_COVER_MS');
const revealMs=literal('GAME_ENTRY_ROUTE_TRANSITION_REVEAL_MS');
const viewer=page=>page.locator('[data-game-panel="join"] [data-invite-role="viewer"]');
const inspect=page=>page.evaluate(()=>{
 const refs=window.__invitationTransitionRefs;
 const join=document.querySelector('[data-game-panel="join"]');
 const current=join?.querySelector('[data-invite-role="viewer"]');
 return {phase:document.querySelector('#app')?.getAttribute('data-shell-transition-phase'),
  hasFocus:document.hasFocus(),visibility:document.visibilityState,
  playersSelected:document.querySelector('#app')?.getAttribute('data-shell-game-panel')==='players',
  sameGame:document.querySelector('[data-testid="game-shell"]')?.getAttribute('data-game-id')===refs?.gameId,
  joinConnected:Boolean(join?.isConnected),oldJoinConnected:Boolean(refs?.join?.isConnected),sameJoin:join===refs?.join,
  viewerConnected:Boolean(current?.isConnected),viewerDisabled:current?.disabled??null,busy:current?.getAttribute('aria-busy'),
  activeViewer:document.activeElement===current,activeOriginal:document.activeElement===refs?.viewer,
  movedTargetConnected:Boolean(refs?.moved?.isConnected),activeMoved:document.activeElement===refs?.moved};
});

for(const mode of ['replacement','no-transition','user-moved-focus']){
 test(`pending viewer copy ${mode} uses the real game-entry transition`,async({page},info)=>{
  const evidence={mode,coverMs,revealMs,setupPassed:[],samples:[],gameplayWrites:0,created:0,complete:false};
  const persist=async()=>{try{await writeFile(info.outputPath('invitation-transition-proof.json'),JSON.stringify(evidence,null,2));}catch{console.warn('[invitation-transition-proof] evidence-incomplete');}};
  const setup=async(label,operation)=>{
   try{await operation();evidence.setupPassed.push(label);}
   catch(error){evidence.setupFailure=label;await persist();throw new Error(`SETUPFAIL: ${label}`,{cause:error});}
  };
  const sample=async label=>{const row={label,...await inspect(page)};evidence.samples.push(row);await persist();return row;};
  page.on('request',request=>{
   if(request.method()!=='POST')return;
   const path=new URL(request.url()).pathname;
   if(path==='/api/shell/games')evidence.created++;
   if(/\/api\/shell\/games\/[^/]+\/(?:apply|shared|play-as-both)$/.test(path))evidence.gameplayWrites++;
  });
  try{
   await page.setViewportSize({width:390,height:844});
   await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});
   await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>new Promise(resolve=>{window.releaseTransitionClipboard=resolve;})}}));
   await setup('fresh Home body completion before clock pause',async()=>{
    const reads=['my','other'].map(section=>page.waitForResponse(response=>{
     const url=new URL(response.url());return response.request().method()==='GET'&&url.pathname==='/api/shell/games'&&url.searchParams.get('section')===section&&response.status()===200;
    }));
    await page.goto('/');
    for(const response of await Promise.all(reads))expect(await response.finished()).toBeNull();
    await expect(page.getByTestId('home-section-skeleton')).toHaveCount(0);
    await expect(page.getByTestId('home-create-game')).toBeEnabled();
    await page.clock.pauseAt(new Date('2026-01-01T00:00:10Z'));
   });
   await setup('one native accepted Friend game',async()=>{
    const accepted=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/shell/games');
    await page.getByTestId('home-create-game').click();await page.clock.runFor(0);
    await page.getByRole('dialog',{name:'Friend',exact:true}).getByRole('button',{name:'Start a friend game',exact:true}).click();
    const response=await accepted;expect(response.status()).toBe(200);expect(await response.finished()).toBeNull();
    await page.clock.runFor(0);
    const body=await response.json();expect(typeof body.game?.id).toBe('string');
    await expect.poll(()=>new URL(page.url()).hash.split('?')[0]).toBe(`#/game/${body.game.id}`);
    await expect(page.getByRole('dialog',{name:'Invite a friend',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Close invite',exact:true}).click();await page.clock.runFor(0);
    await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',body.game.id);
    await expect(page.getByTestId('game-role')).toContainText('Guest');
    // Use the real navigation controls while the existing display clock is held.
    // Each activation releases only its already-scheduled zero-delay gesture task.
    await expect(page.locator('#app')).toHaveAttribute('data-shell-layout-mode','narrow');
    const players=page.locator('[data-action="switch-game-panel"][data-panel="players"]');
    if(await players.getAttribute('aria-pressed')!=='true'){
     const reveal=page.getByRole('button',{name:'Show game navigation',exact:true});
     if(await reveal.count()){await reveal.click();await page.clock.runFor(0);}
     await players.click();await page.clock.runFor(0);
    }
    await expect(players).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('#app')).toHaveAttribute('data-shell-game-panel','players');
    await expect(viewer(page)).toBeVisible();
    await page.evaluate(gameId=>{const join=document.querySelector('[data-game-panel="join"]');window.__invitationTransitionRefs={gameId,join,viewer:join.querySelector('[data-invite-role="viewer"]')};},body.game.id);
    expect(evidence.created).toBe(1);expect(evidence.gameplayWrites).toBe(0);
   });
   await setup('covering phase and real pending disabled invitation',async()=>{
    expect((await sample('before-copy')).phase).toBe('covering');
    await viewer(page).focus();await page.keyboard.press('Enter');
    await expect.poll(()=>page.evaluate(()=>typeof window.releaseTransitionClipboard)).toBe('function');
    await page.clock.runFor(0);
    await expect(viewer(page)).toHaveAttribute('aria-busy','true');await expect(viewer(page)).toBeDisabled();
    const row=await sample('pending-after-existing-zero-timer');
    expect(row.sameGame&&row.playersSelected&&row.sameJoin&&row.oldJoinConnected&&row.hasFocus&&row.visibility==='visible').toBe(true);
   });
   if(mode==='user-moved-focus')await setup('intentional native focus move',async()=>{
    // The native header survives replaceMainPreservingHeader; Players controls do not.
    const stableHeader=page.locator('.shell-header [data-action="toggle-sound"]');
    await expect(stableHeader).toHaveCount(1);await expect(stableHeader).toBeVisible();await expect(stableHeader).toBeEnabled();
    await page.evaluate(()=>{window.__invitationTransitionRefs.moved=document.querySelector('.shell-header [data-action="toggle-sound"]');});
    let reached=false;
    for(let step=1;step<=8;step++){
     await page.keyboard.press('Shift+Tab');
     reached=await page.evaluate(()=>{const target=window.__invitationTransitionRefs.moved;return Boolean(target?.isConnected&&target===document.querySelector('.shell-header [data-action="toggle-sound"]')&&document.activeElement===target);});
     if(reached){evidence.nativeShiftTabSteps=step;break;}
    }
    expect(reached).toBe(true);
    evidence.movedTarget={container:'shell-header',action:'toggle-sound',exactRetainedReference:true};
    await sample('intentional-stable-header-focus');
   });
   if(mode!=='no-transition')await setup('real transition replaces join without changing view intent',async()=>{
    await page.clock.runFor(coverMs);
    const row=await sample('after-existing-cover-timer');
    expect(row.phase).toBe('revealing');
    expect(row.sameGame&&row.playersSelected&&row.joinConnected&&row.viewerConnected&&!row.oldJoinConnected&&!row.sameJoin&&row.hasFocus&&row.visibility==='visible').toBe(true);
    if(mode==='user-moved-focus')expect(row.movedTargetConnected&&row.activeMoved).toBe(true);
   });
   await setup('clipboard completion and enabled current invitation',async()=>{
    await page.evaluate(()=>window.releaseTransitionClipboard());
    await page.clock.runFor(0);
    await expect(viewer(page)).not.toHaveAttribute('aria-busy','true');await expect(viewer(page)).toBeEnabled();
    await expect(page.locator('[data-game-panel="join"]').getByRole('status')).toHaveText('Link copied! Ready to share.');
    const row=await sample('before-focus-oracle');expect(row.sameGame&&row.playersSelected&&row.hasFocus&&row.visibility==='visible').toBe(true);
    expect(evidence.created).toBe(1);expect(evidence.gameplayWrites).toBe(0);
   });
   evidence.oracleReached=true;await persist();
   if(mode==='user-moved-focus'){
    const row=await inspect(page);expect(row.movedTargetConnected&&row.activeMoved).toBe(true);
    expect(await page.evaluate(()=>window.__invitationTransitionRefs.moved===document.querySelector('.shell-header [data-action="toggle-sound"]'))).toBe(true);
    await expect(viewer(page)).not.toBeFocused();
   }
   else await expect(viewer(page)).toBeFocused();
   evidence.complete=true;
  }catch(error){evidence.primaryFailed=true;throw error;}
  finally{await persist();}
 });
}
