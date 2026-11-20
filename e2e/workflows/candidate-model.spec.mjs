import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {CANDIDATE_A_COMPUTER_MODEL as candidate,CURRENT_COMPUTER_MODEL as incumbent} from '../../packages/shared-types/src/computer-play.ts';
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

for(const profile of ['babs','tau','horus'])test(`Candidate A ${profile} branches, plays Red, and survives reload`,async({page},info)=>{
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
  await chooser.getByRole('radio',{name:'Candidate A',exact:true}).check();
  await expect(chooser.getByRole('button',{name:'Start game',exact:true})).toBeEnabled({timeout:45000});
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

test('Candidate A story entry plays Blue while fresh entry keeps the incumbent default',async({page},info)=>{
  await page.setViewportSize({width:390,height:900});
  await page.goto('/');await waitForLegacyIdentity(page);
  await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();
  const story=page.locator('dialog.opponent-story-modal');
  await expect(story.getByRole('radio',{name:'Incumbent',exact:true})).toBeChecked();
  await story.getByRole('radio',{name:'Candidate A',exact:true}).check();
  await waitForOpponentReady(page);
  expect(await story.getByRole('radio',{name:'Candidate A',exact:true}).evaluate(input=>getComputedStyle(input).appearance)).toBe('radio');
  await page.screenshot({path:info.outputPath('candidate-story-mobile.png')});
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/shell/games'&&r.request().method()==='POST');
  await story.getByRole('button',{name:'Play Babs',exact:true}).click();
  const game=(await (await response).json()).game;
  expect(game.computer.modelId).toBe(candidate.id);expect(game.computer.seats).toEqual({p1:null,p2:'babs'});
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',game.id);
  await submitPlayableAction(page,game.legalActions.find(action=>action.from&&action.to));
  await expect.poll(async()=>(await projected(page,game.id)).moves.length).toBeGreaterThan(0);
  if((await projected(page,game.id)).canEndTurn)await page.locator('[data-board-preview-action="end-turn"]').click();
  const played=await waitForComputerDecision(page,game.id,'babs',{guest:true,modelId:candidate.id});
  await page.reload();await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',game.id);
  expect((await projected(page,game.id)).computer.modelId).toBe(candidate.id);
  await info.attach('accepted-blue-candidate',{contentType:'application/json',body:JSON.stringify(played.moves)});
  await page.goto('/');await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();
  await expect(page.getByRole('radio',{name:'Incumbent',exact:true})).toBeChecked();
  expect(incumbent.id).toBe('trained-20261029-1086');
});


test('a finished incumbent game can start an explicitly selected Candidate A rematch',async({page})=>{
  await page.goto('/');await waitForLegacyIdentity(page);
  const catalog=JSON.parse(await readFile(new URL('../../apps/web/scenarios/catalog.json',import.meta.url),'utf8'));
  const scenario=catalog.scenarios.find(item=>item.title==='Capture supply point to win by unsupplying the commander');
  const source=(await post(page,'/api/shell/scenarios/import',{scenario})).game;
  const game=(await post(page,'/api/shell/history/branch',{sourceGameId:source.id,sourceDecisionId:source.moves.at(-1).moveId,creatorSide:'p2',computer:{p1:'babs',p2:null},computerModelId:incumbent.id})).game;
  await page.goto(`/#/game/${game.id}`);
  await waitForComputerDecision(page,game.id,'babs',{guest:true,modelId:incumbent.id});
  await expect.poll(async()=>(await projected(page,game.id)).board.state.outcome.status).toBe('p1_win');
  await page.getByTestId('game-result').getByRole('button',{name:'Play again',exact:true}).click();
  const rematch=page.getByRole('dialog',{name:'Play again',exact:true});
  await expect(rematch.getByRole('radio',{name:'Incumbent',exact:true})).toBeChecked();
  await rematch.getByRole('radio',{name:'Candidate A',exact:true}).check();
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/shell/games'&&r.request().method()==='POST');
  await rematch.getByRole('button',{name:'Start game',exact:true}).click();
  const fresh=(await (await response).json()).game;
  expect(fresh.computer.modelId).toBe(candidate.id);expect(fresh.computer.seats).toEqual({p1:null,p2:'babs'});
  expect((await projected(page,game.id)).computer.modelId).toBe(incumbent.id);
});
