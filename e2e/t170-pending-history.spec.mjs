import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {importScenarioGame,submitPlayableAction,switchGamePanel} from './support/app.mjs';
import {readProjectedGame} from './support/computer-projection.mjs';
const input=JSON.parse(readFileSync(new URL('./fixtures/t170-turn39-pending.json',import.meta.url)));
const canonical=g=>({id:g.id,board:g.board,moves:g.moves,turns:g.turns,revision:g.gameplayRevision,terminalOutcome:g.terminalOutcome??null});
for(const width of [390,1440])test(`pending History treatment follows all five recorded positions at ${width}px`,async({page,baseURL},testInfo)=>{
 test.setTimeout(65000);await page.setViewportSize({width,height:1100});
 const {gameId}=await importScenarioGame(page,{formatVersion:2,id:'7f48615a-e7ae-4652-9b98-8e24ef5cab59',title:'T170 fresh pending History contract',description:'Test-owned Turn39 reconstruction',incorrect:false,initialState:input.initialState,moves:[],resultingState:input.initialState,expectedFinalStateHash:'',expectedOutcome:'ongoing'},baseURL);
 const read=()=>page.evaluate(readProjectedGame,{id:gameId,guest:true});
 for(let i=0;i<5;i++){await submitPlayableAction(page,input.actions[i]);await expect.poll(async()=>(await read()).moves.length).toBe(i+1);}
 await page.locator('[data-board-preview-action="end-turn"],[data-board-message-action="end-turn"]').filter({visible:true}).click();await expect.poll(async()=>(await read()).board.state.turnIndex).toBe(39);const before=canonical(await read());
 await switchGamePanel(page,'history');const rows=page.getByTestId('history-move-item');await expect(rows).toHaveCount(5);
 const bullets=[];
 for(const move of before.moves){const row=page.locator(`[data-testid="history-move-item"][data-move-id="${move.moveId}"]`);bullets.push(await row.getByTestId('history-destruction-item').allTextContents());}
 expect(bullets).toEqual([[],['DESTROYED (2,7)'],[],['DESTROYED (0,7)'],[]]);
 for(let i=0;i<5;i++){
  const row=page.locator(`[data-testid="history-move-item"][data-move-id="${before.moves[i].moveId}"]`);await row.locator(':scope > .history-move-hit').click();await expect(row).toHaveAttribute('aria-current','true');
  const surface=width===390?row.getByTestId('history-inline-preview'):page.locator('#shell-board');
  await expect(surface.locator('.history-destruction-piece')).toHaveCount([0,1,1,2,2][i]);await expect(surface.locator('.removal-piece')).toHaveCount(0);
 }
 const selectedSurface=width===390?page.locator('[data-testid="history-move-item"][aria-current="true"]').getByTestId('history-inline-preview'):page.locator('#shell-board');
 await selectedSurface.screenshot({path:testInfo.outputPath('final-move-pending.png')});
 expect(canonical(await read())).toEqual(before);
});
