import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {switchGamePanel,submitPlayableAction,waitForLegacyIdentity} from '../support/app.mjs';
import {readProjectedGame,waitForComputerDecision,waitForOpponentReady} from '../support/computer-projection.mjs';
import {CURRENT_COMPUTER_MODEL} from '../../packages/shared-types/src/computer-play.ts';
import {STORAGE_GENERATION_HEADER} from '../../packages/shared-types/src/storage-policy.js';

const read=(page,id)=>page.evaluate(readProjectedGame,{id,guest:true});
const canonical=game=>({id:game.id,board:game.board,moves:game.moves,turns:game.turns,revision:game.gameplayRevision,terminalOutcome:game.terminalOutcome});
const story=page=>page.getByRole('dialog',{name:'Babs',exact:true});

test('computer player opens its story while the same match continues at 390px',async({page},info)=>{
 await page.setViewportSize({width:390,height:900});await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/');await expect(page.getByTestId('home-create-game')).toBeVisible();
 await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();
 await waitForOpponentReady(page);await story(page).getByRole('button',{name:'Play Babs',exact:true}).click();
 await expect(page.getByTestId('game-shell')).toBeVisible();
 const id=await page.getByTestId('game-shell').getAttribute('data-game-id');
 await switchGamePanel(page,'players');const before=await read(page,id);
 const identity=page.locator('[data-testid="participant-player-2"] .participant-computer');
 await identity.click();await expect(story(page)).toBeVisible();
 await expect(story(page).getByRole('button',{name:'Return to game',exact:true})).toBeVisible();
 await expect(story(page).locator('[data-story-play],[data-story-retry]')).toHaveCount(0);
 const opened=await read(page,id);
 expect(canonical(opened)).toEqual(canonical(before));
 expect(before.computer.paused).toBe(false);
 expect(opened.computer.paused).toBe(false);

 // A second normal page supplies the human move while the first stays in its
 // story. The accepted computer response must still advance the same match.
 const other=await page.context().newPage();
 try {
  await other.goto(`/#/game/${id}`);await expect(other.getByTestId('game-board')).toBeVisible();
  await switchGamePanel(other,'players');
  await other.locator('[data-testid="participant-player-2"] [data-action="toggle-computer-card"]').click();
  const resume=other.getByRole('button',{name:'Resume here',exact:true});
  if(await resume.count())await resume.click();
  await expect(story(page).locator('[data-story-readiness]')).toHaveText('Active in another tab');
  await switchGamePanel(other,'board');
  const game=await read(other,id),action=game.legalActions.find(action=>action.type==='move'&&action.from&&action.to);
  expect(action).toBeTruthy();await submitPlayableAction(other,action);
  if((await read(other,id)).canEndTurn)await other.locator('[data-board-preview-action="end-turn"]').click();
  await waitForComputerDecision(other,id,'babs',{guest:true,modelId:before.computer.modelId});
  await expect(story(page)).toBeVisible();
  const after=await read(page,id);expect(after.moves.length).toBeGreaterThan(before.moves.length+1);
  expect(after.computer.paused).not.toBe(true);
  expect(await story(page).locator('[data-story-readiness]').textContent()).not.toMatch(/Preparing|Ready to play/);
  await info.attach('continued-match',{contentType:'application/json',body:JSON.stringify({gameId:id,beforeMoves:before.moves.length,afterMoves:after.moves.length,paused:after.computer.paused??false})});
 } finally {await other.close();}
 await page.bringToFront();await page.screenshot({path:info.outputPath('revisited-story-390.png'),fullPage:true});
 await story(page).getByRole('button',{name:'Return to game',exact:true}).click();await expect(identity).toBeFocused();
 const status=page.locator('[data-testid="participant-player-2"] [data-action="toggle-computer-card"]');
 await status.focus();await page.keyboard.press('Enter');await expect(status).toHaveAttribute('aria-expanded','true');
 expect(await status.evaluate(node=>node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});

test('completed computer story opens the current result at 1440px',async({page},info)=>{
 await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/');await expect(page.getByTestId('home-create-game')).toBeVisible();await waitForLegacyIdentity(page);
 const scenario=JSON.parse(readFileSync(new URL('../../apps/web/scenarios/catalog.json',import.meta.url))).scenarios.find(item=>item.title==='Capture supply point to win by unsupplying the commander');
 const request=(route,body)=>page.evaluate(async({route,body,header})=>{
  const bootstrap=await fetch('/api/shell/bootstrap');if(!bootstrap.ok)throw Error(`Bootstrap HTTP ${bootstrap.status}`);
  const generation=bootstrap.headers.get(header),identityId=localStorage.getItem('righelt.identity.id.v1');
  const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json',...(generation?{[header]:generation}:{})},body:JSON.stringify({...body,identityId,protocolVersion:2})});
  if(!response.ok)throw Error(`Fresh fixture HTTP ${response.status}`);return response.json();
 },{route,body,header:STORAGE_GENERATION_HEADER});
 const source=(await request('/api/shell/scenarios/import',{scenario})).game,final=source.moves.at(-1);
 const game=(await request('/api/shell/history/branch',{sourceGameId:source.id,sourceDecisionId:final.moveId,creatorSide:'p2',computer:{p1:'babs',p2:null},computerModelId:CURRENT_COMPUTER_MODEL.id})).game;
 await page.goto(`/#/game/${game.id}`);await waitForComputerDecision(page,game.id,'babs',{guest:true,modelId:game.computer.modelId});
 await expect.poll(async()=>(await read(page,game.id)).board.state.outcome.status).toBe('p1_win');
 await page.locator('[data-action="analysis"]').click();await switchGamePanel(page,'players');
 const before=await read(page,game.id);await page.locator('[data-testid="participant-player-1"] .participant-computer').click();
 await expect(story(page)).toBeVisible();await expect(story(page)).toHaveAttribute('data-action-affiliation','blue');
 await expect(story(page).locator('[data-story-readiness]')).toHaveText('Game finished');
 await expect(story(page).getByRole('button',{name:'View result',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('completed-story-1440.png'),fullPage:true});
 await story(page).getByRole('button',{name:'View result',exact:true}).click();
 await expect(story(page)).not.toBeVisible();await expect(page.getByTestId('game-result')).toBeVisible();
 expect(canonical(await read(page,game.id))).toEqual(canonical(before));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});
