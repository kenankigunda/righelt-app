import {test,expect} from '@playwright/test';
import {CURRENT_COMPUTER_MODEL} from '../../packages/shared-types/src/computer-play.ts';
import {ACTION_CONTRACT_HEADER,ACTION_CONTRACT_VERSION} from '../../apps/web/generated/packages/shared-types/src/sync-protocol.js';
import {readProjectedGame,waitForComputerDecision,waitForOpponentReady} from '../support/computer-projection.mjs';

test.use({viewport:{width:390,height:740},hasTouch:true});
const notice=page=>page.locator('[data-computer-status]');
const geometry=page=>page.getByTestId('game-board').evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};});
async function createBabs(page){
  await page.goto('/');
  await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();
  await waitForOpponentReady(page);
  const creation=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/shell/games'&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Play Babs',exact:true}).click();
  const response=await creation;expect(response.ok()).toBe(true);
  const game=(await response.json()).game;
  expect(response.request().postDataJSON().computerModelId).toBe(CURRENT_COMPUTER_MODEL.id);
  expect(game.computer.modelId).toBe(CURRENT_COMPUTER_MODEL.id);
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',game.id);
  await expect(page.locator('[data-shell-transition-phase]')).toHaveAttribute('data-shell-transition-phase','idle');
  return game;
}
const settleNotice=page=>notice(page).evaluate(el=>Promise.all(el.getAnimations({subtree:true}).filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation=>animation.finished.catch(()=>{}))));
const readyAttempt=route=>{const body=route.request().postDataJSON();return body?.operation==='write'&&body?.kind==='computer'&&body?.attempt?.result?.status==='ready';};

test('computer save failures take priority while the delayed saving notice stays available without shifting the board',async({page,context},info)=>{
  const game=await createBabs(page);
  let holdGameplay=true,attemptSeen=false,originalCommand;const submissions=[];
  // The proof save keeps its normal five-second failure budget. Lose only
  // the durable gameplay submission; real reconciliation and leases stay live.
  await context.route('**/apply',async route=>{const command=route.request().postDataJSON();if(command?.payload?.computer){originalCommand??=command;submissions.push({id:command.clientCommandId,generation:command.payload.computer.generation});if(holdGameplay){attemptSeen=true;await route.abort();return;}}await route.continue();});
  try{
    const before=await geometry(page);
    await page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true}).tap();
    await expect.poll(()=>attemptSeen,{timeout:30000}).toBe(true);
    const heldLease=(await page.evaluate(readProjectedGame,{id:game.id,guest:true})).computer.lease;
    await expect(notice(page)).toHaveCount(0);
    await expect(page.locator('#shell-board-preview-label')).not.toContainText('Select a piece');
    await expect(page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true})).toHaveCount(0);
    await expect(page.getByTestId('sync-recovery-banner')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Interrupt',exact:true})).toHaveCount(0);
    await expect(page.getByText('Recording move',{exact:false})).toHaveCount(0);
    const delayed=notice(page).getByText('Saving the move is taking longer than usual',{exact:true});
    await expect(delayed).toHaveCount(1,{timeout:13000});
    if(await delayed.evaluate(el=>Boolean(el.closest('[hidden],[inert],[aria-hidden="true"]'))))await page.locator('[data-action="cycle-game-alert-stack"][tabindex="0"]').press('Enter');
    await expect(delayed).toBeVisible();
    await expect(page.getByTestId('sync-recovery-banner')).toHaveCount(0);
    await expect(page.getByTestId('sync-recovery-banner')).toContainText('Still checking your move. You can retry or view details.',{timeout:10000});
    await expect(page.getByTestId('sync-recovery-banner').getByRole('button',{name:'Reload game',exact:true})).toBeVisible();
    await expect(page.locator('[data-alert-stack-card][inert] .shell-game-alert-copy').first()).toBeHidden();
    await expect(page.locator('[data-alert-stack-card][inert] button').first()).toBeHidden();
    expect(await page.getByTestId('sync-recovery-banner').evaluate(el=>!el.closest('[hidden],[inert],[aria-hidden="true"]'))).toBe(true);
    await expect(page.getByRole('button',{name:'Interrupt',exact:true})).toHaveCount(0);
    expect(await geometry(page)).toEqual(before);
    await settleNotice(page);
    await page.screenshot({path:info.outputPath('computer-delayed-saving.png')});
    expect(heldLease.expiresAt).toBeLessThanOrEqual(Date.now());
    holdGameplay=false;
    // The original command can be durably rejected after its lease expires.
    // Allow automatic reacquisition to settle before judging the final result.
    // A transient recovery card here does not establish a terminal failure.
    await expect.poll(()=>page.evaluate(readProjectedGame,{id:game.id,guest:true,expectedComputer:{modelId:game.computer.modelId,profile:'babs'}}),{timeout:30000}).toBeTruthy();
    await expect(notice(page)).toHaveCount(0);
    expect(await geometry(page)).toEqual(before);
    const saved=await page.evaluate(readProjectedGame,{id:game.id,guest:true});
    const committed=saved.moves.filter(move=>move.computerProof?.modelId===game.computer.modelId);
    expect(committed).toHaveLength(1);
    expect(saved.computer.generation).toBeGreaterThan(originalCommand.payload.computer.generation);
    expect(committed[0].clientCommandId).not.toBe(originalCommand.clientCommandId);
    expect(committed[0].computerProof.generation).toBe(saved.computer.generation);
    // Read the original durable receipt without submitting or replacing it.
    const receipt=await context.request.post(`/api/shell/games/${game.id}/reconcile`,{headers:{[ACTION_CONTRACT_HEADER]:String(ACTION_CONTRACT_VERSION)},data:{protocolVersion:2,identityId:originalCommand.identityId,knownSnapshotEventSeq:0,commands:[originalCommand]}});
    expect(receipt.ok()).toBe(true);
    expect((await receipt.json()).commandOutcomes).toEqual([expect.objectContaining({clientCommandId:originalCommand.clientCommandId,fingerprint:originalCommand.fingerprint,outcome:'rejected',reason:'computer_control_changed'})]);
    for(const generation of new Set(submissions.map(command=>command.generation)))expect(new Set(submissions.filter(command=>command.generation===generation).map(command=>command.id)).size).toBe(1);
  }finally{holdGameplay=false;await context.unrouteAll({behavior:'wait'});}
});

test('a failed computer proof save exposes usable recovery immediately and Resume here completes the real move',async({page,context},info)=>{
  const game=await createBabs(page);let failed=false;
  await context.route('**/decision-attempt',async route=>{
    if(!failed&&readyAttempt(route)){failed=true;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'temporarily_unavailable'})});return;}
    await route.continue();
  });
  const before=await geometry(page);
  await page.locator('#shell-board-preview-label').getByRole('button',{name:'Pass',exact:true}).tap();
  await expect.poll(()=>failed,{timeout:30000}).toBe(true);
  const retry=notice(page).getByRole('button',{name:'Resume here',exact:true});
  await expect(retry).toBeVisible({timeout:3000});
  expect(await retry.evaluate(el=>!el.closest('[hidden],[inert],[aria-hidden="true"]'))).toBe(true);
  await expect(retry).toBeEnabled();
  await expect(page.getByRole('button',{name:'Interrupt',exact:true})).toHaveCount(0);
  expect(await geometry(page)).toEqual(before);
  await settleNotice(page);
  await page.screenshot({path:info.outputPath('computer-proof-recovery.png')});
  await retry.tap();
  await waitForComputerDecision(page,game.id,'babs',{guest:true,modelId:game.computer.modelId});
  await expect(notice(page)).toHaveCount(0);
  expect(await geometry(page)).toEqual(before);
});
