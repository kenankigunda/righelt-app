import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {applyAction,resolveToStability} from '../../apps/web/generated/packages/game-engine/src/index.js';
import {importScenarioGame,submitPlayableAction} from '../support/app.mjs';

const catalog=JSON.parse(readFileSync(new URL('../../apps/web/scenarios/catalog.json',import.meta.url),'utf8'));
const completed=catalog.scenarios.find(record=>record.title==='Capture supply point to win by unsupplying the commander');
const finalMove=completed.moves.at(-1);
let preFinal=resolveToStability(structuredClone(completed.initialState),{artifactMode:'full'});
for(const move of completed.moves.slice(0,-1)){
  while(preFinal.turnIndex<move.turnIndex)preFinal=resolveToStability(applyAction(preFinal,{type:'end_turn'}).state,{artifactMode:'full'});
  preFinal=resolveToStability(applyAction(preFinal,move.action).state,{artifactMode:'full'});
}
while(preFinal.turnIndex<finalMove.turnIndex)preFinal=resolveToStability(applyAction(preFinal,{type:'end_turn'}).state,{artifactMode:'full'});
const projectedFinal=resolveToStability(applyAction(preFinal,finalMove.action).state,{artifactMode:'full'});
if(preFinal.outcome.status!=='ongoing'||projectedFinal.outcome.status!=='p1_win')throw Error('Confirmed-result fixture must contain one legal winning action');
const scenario={...completed,id:'6a5311e9-8467-4bd8-b205-cf3708c20171',title:'Confirmed result ownership',moves:completed.moves.slice(0,-1),resultingState:preFinal,expectedFinalStateHash:'',expectedOutcome:'ongoing'};

const holdWinningAcknowledgement=async(context,gameId,{reject=false}={})=>{
  let release,command=null,seen;
  const held=new Promise(resolve=>release=resolve),observed=new Promise(resolve=>seen=resolve);
  await context.route(`**/api/shell/games/${gameId}/**`,async route=>{
    const request=route.request(),path=new URL(request.url()).pathname,body=request.method()==='POST'?request.postDataJSON():null;
    const candidates=path.endsWith('/apply')?[body]:path.endsWith('/reconcile')?(body?.commands??[]):[];
    const winning=candidates.find(candidate=>candidate?.payload?.action?.type===finalMove.action.type&&candidate.payload.action.actorId===finalMove.action.actorId&&candidate.payload.action.to?.row===finalMove.action.to.row&&candidate.payload.action.to?.col===finalMove.action.to.col);
    if(winning){if(!command){command=winning;seen();}await held;}
    else if(command&&path.endsWith('/reconcile'))await held;
    if(reject&&command&&(winning||path.endsWith('/reconcile'))){
      const currentUrl=new URL(`/api/shell/games/${encodeURIComponent(gameId)}`,request.url());currentUrl.searchParams.set('identityId',command.identityId);
      const current=await (await context.request.get(currentUrl.href)).json();
      await route.fulfill({json:{...current,protocolVersion:2,gameId,gameplayRevision:current.game.gameplayRevision,commandOutcomes:[{gameId,identityId:command.identityId,clientCommandId:command.clientCommandId,fingerprint:command.fingerprint,outcome:'rejected',reason:'stale_state',eventSeq:current.eventSeq,gameplayRevision:current.game.gameplayRevision}]}});return;
    }
    await route.continue();
  });
  return {observed,release:()=>release(),command:()=>command};
};

const openFixture=async(page,context,baseURL)=>{
  const imported=await importScenarioGame(page,scenario,baseURL);
  const gate=await holdWinningAcknowledgement(context,imported.gameId);
  const submission=submitPlayableAction(page,finalMove.action);
  await gate.observed;
  expect(gate.command().payload.action).toEqual(finalMove.action);
  await expect(page.getByTestId('game-result')).toHaveCount(0);
  await expect(page.locator('.history-turn-heading[aria-current="true"],.history-move-hit[aria-current="true"]')).toHaveCount(0);
  return {...imported,gate,submission};
};

test.beforeEach(async({},info)=>test.skip(info.project.name!=='chromium','Held-ack shell proof is intentionally bounded to Chromium'));

test('a legal optimistic win cannot open result or completed review before authoritative acknowledgement',async({page,context,baseURL})=>{
  const {gate,submission}=await openFixture(page,context,baseURL);
  try{
    gate.release();await submission;
    const result=page.getByTestId('game-result');await expect(result).toHaveCount(1);await expect(result).toBeVisible();await expect(result.getByRole('heading')).toContainText('You won');
    await page.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(result).toHaveCount(1);await expect(result).toBeVisible();
  }finally{gate.release();}
});

test('deliberate History keeps its selected move through confirmation and offers one manual result entry',async({page,context,baseURL})=>{
  const {gate,submission}=await openFixture(page,context,baseURL);
  try{
    const row=page.getByTestId('history-move-item').first(),hit=row.locator(':scope > .history-move-hit');
    const moveId=await row.getAttribute('data-move-id');expect(moveId).toBeTruthy();await hit.click();await expect(row).toHaveAttribute('aria-current','true');
    gate.release();await submission;
    const notice=page.getByTestId('confirmed-result-notice');await expect(notice).toBeVisible();await expect(page.getByTestId('game-result')).toHaveCount(0);
    await expect(page.locator(`[data-testid="history-move-item"][data-move-id="${moveId}"]`)).toHaveAttribute('aria-current','true');
    await notice.getByRole('button',{name:'View result',exact:true}).click();const result=page.getByTestId('game-result');await expect(result).toBeVisible();await expect(result.getByRole('heading')).toBeFocused();
    await expect(result).toHaveCount(1);
    await result.getByRole('button',{name:'Review game',exact:true}).click();
    await expect(result).toHaveCount(0);await expect(page.locator('#shell-board-turn-indicator')).toContainText(`You won on Turn ${finalMove.turnIndex+1}`);await expect(page.locator('[data-game-panel="history"] h2')).toBeFocused();
  }finally{gate.release();}
});

test('a rejected optimistic win rolls the visible target piece back without result or completed review',async({page,context,baseURL})=>{
  const imported=await importScenarioGame(page,scenario,baseURL),gate=await holdWinningAcknowledgement(context,imported.gameId,{reject:true});
  const submission=submitPlayableAction(page,finalMove.action);
  try{
    await gate.observed;expect(gate.command().payload.action).toEqual(finalMove.action);
    const target=page.locator(`[data-testid="game-board"] .cell[data-row="${finalMove.action.to.row}"][data-col="${finalMove.action.to.col}"]`);
    const optimisticPiece=target.locator('.piece-token.pending-recording-piece');
    await expect(optimisticPiece,'The held legal project win must visibly create its target piece before rejection so rollback proof is non-vacuous').toBeVisible();
    await expect(page.getByTestId('history-pending-move-item')).toHaveCount(1);await expect(page.getByTestId('game-result')).toHaveCount(0);
    gate.release();await submission;
    await expect(page.getByTestId('history-pending-move-item')).toHaveCount(0);await expect(optimisticPiece).toHaveCount(0);
    const source=page.locator(`[data-testid="game-board"] .cell[data-row="${finalMove.action.from.row}"][data-col="${finalMove.action.from.col}"]`);
    await expect(source.locator(`.piece-token[data-piece-id="${finalMove.action.actorId}"]:not(.move-ghost)`)).toBeVisible();
    await expect(page.getByTestId('game-result')).toHaveCount(0);await expect(page.locator('.history-turn-heading[aria-current="true"],.history-move-hit[aria-current="true"]')).toHaveCount(0);
  }finally{gate.release();}
});
