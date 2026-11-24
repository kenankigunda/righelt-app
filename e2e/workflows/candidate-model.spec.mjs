import {test,expect} from '@playwright/test';
import {ownedContexts} from '../support/owned-contexts.mjs';
import {waitForPlayableBoard} from '../../scripts/validation/browser-navigation.mjs';
import {readFile} from 'node:fs/promises';
import {COMPUTER_MODEL_CHOICES,getComputerModel,CURRENT_COMPUTER_MODEL as incumbent} from '../../packages/shared-types/src/computer-play.ts';
import {STORAGE_GENERATION_HEADER} from '../../packages/shared-types/src/storage-policy.js';
import {waitForLegacyIdentity,submitPlayableAction,switchGamePanel} from '../support/app.mjs';
import {readProjectedGame,waitForComputerDecision,waitForOpponentReady} from '../support/computer-projection.mjs';
const projected=(page,id)=>page.evaluate(readProjectedGame,{id,guest:true});
const post=(page,route,body)=>page.evaluate(async({route,body,header})=>{
  const bootstrap=await fetch('/api/shell/bootstrap');
  const generation=bootstrap.headers.get(header);
  const identityId=localStorage.getItem('righelt.identity.id.v1');
  const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json',...(generation?{[header]:generation}:{})},body:JSON.stringify({...body,identityId,protocolVersion:2})});
  if(!response.ok)throw Error(`Fixture failed: ${response.status}`);
  return response.json();
},{route,body,header:STORAGE_GENERATION_HEADER});

for(const choice of COMPUTER_MODEL_CHOICES.filter(item=>item.id!==incumbent.id)){
const candidate=getComputerModel(choice.id);
test.describe(choice.label,()=>{
for(const profile of ['babs','tau','horus'])test(`${choice.label} ${profile} branches, plays Red, and survives reload`,async({page},info)=>{
  await page.goto('/');await waitForLegacyIdentity(page);
  const catalog=JSON.parse(await readFile(new URL('../../apps/web/scenarios/catalog.json',import.meta.url),'utf8'));
  const scenario=catalog.scenarios.find(item=>item.title==='Capture supply point to win by unsupplying the commander');
  const source=(await post(page,'/api/shell/scenarios/import',{scenario})).game;
  await page.goto(`/#/game/${source.id}`);
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',source.id);
  await switchGamePanel(page,'history');
  const row=page.locator(`[data-testid="history-move-item"][data-move-id="${source.moves.at(-1).moveId}"]`);
  await row.locator(':scope > .history-move-hit').click();
  await row.locator('[data-action="launch-history-branch"]').click();
  const chooser=page.getByRole('dialog',{name:'Create a new game here',exact:true});
  await chooser.getByRole('group',{name:'Opponent',exact:true}).locator(`input[value="${profile}"]`).check();
  await chooser.getByRole('radio',{name:'Blue',exact:true}).check();
  await expect(chooser.getByRole('radio',{name:'Incumbent',exact:true})).toBeChecked();
  await chooser.getByRole('radio',{name:choice.label,exact:true}).check();
  await expect(chooser.getByRole('button',{name:'Start game',exact:true})).toBeEnabled({timeout:45000});
  await expect(chooser.getByRole('radio',{name:choice.label,exact:true})).toBeChecked();
  if(profile==='babs'){
    await chooser.evaluate(dialog=>{dialog.scrollTop=0;});
    await page.screenshot({path:info.outputPath('candidate-branch-desktop.png')});
  }
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/shell/history/branch');
  const popupPromise=page.waitForEvent('popup');
  await chooser.getByRole('button',{name:'Start game',exact:true}).click();
  const popup=await popupPromise;
  try{
    const reply=await response;expect(reply.request().postDataJSON().computerModelId).toBe(candidate.id);
    const game=(await reply.json()).game;expect(game.computer.seats).toEqual({p1:profile,p2:null});
    const played=await waitForComputerDecision(popup,game.id,profile,{guest:true,modelId:candidate.id});
    const decision=played.moves.find(move=>move.computerProof?.modelId===candidate.id);
    expect(decision).toBeTruthy();
    await popup.reload();await expect(popup.getByTestId('game-shell')).toHaveAttribute('data-game-id',game.id);
    const retained=await projected(popup,game.id);expect(retained.computer.modelId).toBe(candidate.id);
    expect(retained.moves.find(move=>move.moveId===decision.moveId)?.computerProof).toEqual(decision.computerProof);
    expect((await projected(page,source.id)).computer).toEqual(source.computer);
    await info.attach('accepted-candidate-decision',{contentType:'application/json',body:JSON.stringify({profile,gameId:game.id,modelId:retained.computer.modelId,decision})});

  }finally{await popup.close();}
});

for(const profile of ['babs','tau','horus'])test.describe(`${choice.label} ${profile} retained story game`,()=>{
  // Two existing 60-second workflow budgets retain one actual browser/game.
  // Failed preparation skips its dependent continuation, without replacement.
  test.describe.configure({mode:'serial'});
  let owned,page,game,played,identity;
  test.beforeAll(async({browser},info)=>{
    owned=ownedContexts(browser);const use=info.project.use;
    const context=await owned.create({...use.contextOptions,baseURL:use.baseURL,
      viewport:{width:390,height:900},deviceScaleFactor:use.deviceScaleFactor,
      isMobile:use.isMobile,hasTouch:use.hasTouch,userAgent:use.userAgent});
    page=await context.newPage();
  });
  test.afterAll(async()=>{await owned?.close();});
  test('selects the candidate and accepts a real Blue decision',async({},info)=>{
    await page.goto('/');await waitForLegacyIdentity(page);
    identity=await page.evaluate(()=>localStorage.getItem('righelt.identity.id.v1'));
    await page.locator(`[data-action="opponent-story"][data-opponent="${profile}"]`).click();
    const story=page.locator('dialog.opponent-story-modal');
    await expect(story.getByRole('radio',{name:'Incumbent',exact:true})).toBeChecked();
    await story.getByRole('radio',{name:choice.label,exact:true}).check();
    await waitForOpponentReady(page);
    await expect(story.getByRole('radio',{name:choice.label,exact:true})).toBeChecked();
    expect(await story.getByRole('radio',{name:choice.label,exact:true}).evaluate(input=>getComputedStyle(input).appearance)).toBe('radio');
    if(profile==='babs')await page.screenshot({path:info.outputPath('candidate-story-mobile.png')});
    const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/shell/games'&&r.request().method()==='POST');
    await story.getByRole('button',{name:`Play ${profile==='babs'?'Babs':profile==='tau'?'Tau':'Horus'}`,exact:true}).click();
    const reply=await response;expect(reply.ok()).toBe(true);
    expect(reply.request().postDataJSON().computerModelId).toBe(candidate.id);
    game=(await reply.json()).game;
    expect(game.computer.modelId).toBe(candidate.id);expect(game.computer.seats).toEqual({p1:null,p2:profile});
    await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',game.id);
    await waitForPlayableBoard(page);
    await submitPlayableAction(page,game.legalActions.find(action=>action.from&&action.to));
    await expect.poll(async()=>(await projected(page,game.id)).moves.length).toBeGreaterThan(0);
    if((await projected(page,game.id)).canEndTurn)await page.locator('[data-board-preview-action="end-turn"]').click();
    played=await waitForComputerDecision(page,game.id,profile,{guest:true,modelId:candidate.id});
    expect(played.moves.some(move=>move.computerProof?.modelId===candidate.id&&move.computerProof.profile===profile)).toBe(true);
    await info.attach('accepted-blue-candidate',{contentType:'application/json',body:JSON.stringify({modelId:candidate.id,modelSha256:candidate.sha256,profile,gameId:game.id,moves:played.moves})});
  });
  test('reloads that exact saved game and continues with the pinned candidate',async({},info)=>{
    expect(game).toBeTruthy();expect(played).toBeTruthy();
    await page.reload();await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',game.id);
    await waitForPlayableBoard(page);
    expect(await page.evaluate(()=>localStorage.getItem('righelt.identity.id.v1'))).toBe(identity);
    const retained=await projected(page,game.id);expect(retained.computer.modelId).toBe(candidate.id);
    expect(retained.computer.seats).toEqual({p1:null,p2:profile});
    const saved=played.moves.find(move=>move.computerProof?.modelId===candidate.id);
    expect(retained.moves.find(move=>move.moveId===saved.moveId)?.computerProof).toEqual(saved.computerProof);
    const previous=new Set(retained.moves.map(move=>move.moveId));
    const fresh=state=>state.moves.find(move=>!previous.has(move.moveId)&&move.computerProof?.modelId===candidate.id&&move.computerProof.profile===profile);
    let continued;
    for(let actionCount=0;actionCount<8;actionCount++){
      const current=await projected(page,game.id);continued=fresh(current);
      if(continued)break;
      expect(current.board.state.outcome.status).toBe('ongoing');
      if(current.board.state.sideToMove==='P1'){
        if(current.canEndTurn)await page.locator('[data-board-preview-action="end-turn"]').click();
        else{
          const action=current.legalActions.find(action=>action.from&&action.to);
          if(action)await submitPlayableAction(page,action);
          else{expect(current.legalActions.some(action=>action.type==='pass')).toBe(true);await page.locator('#shell-board-preview-label :is([data-board-message-action="pass"],[data-board-preview-action="pass"])').click();}
        }
        await expect.poll(async()=>(await projected(page,game.id)).gameplayRevision).toBeGreaterThan(current.gameplayRevision);
      }else{
        // Await one accepted decision or a real handover, never retry the model.
        await expect.poll(async()=>{const next=await projected(page,game.id);return Boolean(fresh(next))||next.board.state.sideToMove==='P1'||next.board.state.outcome.status!=='ongoing';},{timeout:30000}).toBe(true);
      }
    }
    const after=await projected(page,game.id);continued=fresh(after);
    expect(continued,'A new candidate decision must be durably accepted after reload').toBeTruthy();
    expect(after.computer.modelId).toBe(candidate.id);
    await info.attach('continued-candidate-after-reload',{contentType:'application/json',body:JSON.stringify({profile,gameId:game.id,modelId:candidate.id,modelSha256:candidate.sha256,savedDecision:saved,continuedDecision:continued})});
    await page.goto('/');await page.locator(`[data-action="opponent-story"][data-opponent="${profile}"]`).click();
    await expect(page.getByRole('radio',{name:'Incumbent',exact:true})).toBeChecked();
    expect(incumbent.id).toBe('trained-20261029-1086');
  });
});


test(`a finished incumbent game can start an explicitly selected ${choice.label} rematch`,async({page})=>{
  await page.goto('/');await waitForLegacyIdentity(page);
  const catalog=JSON.parse(await readFile(new URL('../../apps/web/scenarios/catalog.json',import.meta.url),'utf8'));
  const scenario=catalog.scenarios.find(item=>item.title==='Capture supply point to win by unsupplying the commander');
  const source=(await post(page,'/api/shell/scenarios/import',{scenario})).game;
  const game=(await post(page,'/api/shell/history/branch',{sourceGameId:source.id,sourceDecisionId:source.moves.at(-1).moveId,creatorSide:'p2',computer:{p1:'babs',p2:null},computerModelId:incumbent.id})).game;
  await page.goto(`/#/game/${game.id}`);
  await waitForComputerDecision(page,game.id,'babs',{guest:true,modelId:incumbent.id});
  await expect.poll(async()=>(await projected(page,game.id)).board.state.outcome.status).toBe('p1_win');
  await page.getByTestId('confirmed-result-notice').getByRole('button',{name:'View result',exact:true}).click();
  await page.getByTestId('game-result').getByRole('button',{name:'Play again',exact:true}).click();
  const rematch=page.getByRole('dialog',{name:'Play again',exact:true});
  await expect(rematch.getByRole('radio',{name:'Incumbent',exact:true})).toBeChecked();
  await rematch.getByRole('radio',{name:choice.label,exact:true}).check();
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/shell/games'&&r.request().method()==='POST');
  await rematch.getByRole('button',{name:'Start game',exact:true}).click();
  const fresh=(await (await response).json()).game;
  expect(fresh.computer.modelId).toBe(candidate.id);expect(fresh.computer.seats).toEqual({p1:null,p2:'babs'});
  expect((await projected(page,game.id)).computer.modelId).toBe(incumbent.id);
});

});
}
