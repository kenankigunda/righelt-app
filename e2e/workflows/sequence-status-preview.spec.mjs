import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {importScenarioGame,submitPlayableAction,switchGamePanel} from '../support/app.mjs';
import {readProjectedGame} from '../support/computer-projection.mjs';
import {installPassiveAudioObservations} from '../support/audio-observations.mjs';

const fixture=JSON.parse(readFileSync(new URL('../../packages/game-engine/test/fixtures/destruction-turn-end.json',import.meta.url)));
const scenario={formatVersion:2,id:'845a2cb9-a73d-49f3-8699-376e949791b8',title:'Sequence status and rescue',description:'Projected end-turn losses remain real pieces until the sequence ends',incorrect:false,initialState:fixture.initialState,moves:[],resultingState:fixture.initialState,expectedFinalStateHash:'',expectedOutcome:'ongoing'};
const rescue={type:'rush',actorId:'U2-5',from:{row:8,col:3},to:{row:7,col:3}};

for(const width of [390,1440])test(`sequence status forecasts losses and restores rescued pieces at ${width}px`,async({page,baseURL},info)=>{
 await page.addInitScript(installPassiveAudioObservations);await page.setViewportSize({width,height:1000});
 const {gameId}=await importScenarioGame(page,scenario,baseURL);await switchGamePanel(page,'board');
 const board=page.getByTestId('game-board'),losses=board.locator('.projected-destruction-piece');
 await expect(losses).toHaveCount(2);
 const initial=await page.evaluate(readProjectedGame,{id:gameId,guest:true});
 const ids=initial.board.state.pieces.map(piece=>piece.id).sort();
 for(const id of ['U1-2','U1-3']){
  const token=board.locator(`[data-piece-id="${id}"]`);
  await expect(token).toHaveClass(/projected-destruction-piece/);
  await expect(token).toHaveAccessibleName(/will be destroyed if the turn ends now/);
 }
 await expect(board.locator('.removal-piece')).toHaveCount(0);
 await submitPlayableAction(page,fixture.action);
 await expect.poll(async()=>(await page.evaluate(readProjectedGame,{id:gameId,guest:true})).moves.length).toBe(1);
 await expect(losses).toHaveCount(2);
 await page.screenshot({path:info.outputPath(`sequence-at-risk-${width}.png`),fullPage:true});
 await submitPlayableAction(page,rescue);
 await expect.poll(async()=>(await page.evaluate(readProjectedGame,{id:gameId,guest:true})).moves.length).toBe(2);
 await expect(losses).toHaveCount(0);
 const after=await page.evaluate(readProjectedGame,{id:gameId,guest:true});
 expect(after.board.state.pieces.map(piece=>piece.id).sort()).toEqual(ids);
 expect(after.board.state.continuation.type).toBe('rush');
 expect(after.moves.every(move=>(move.destroyedPieces??[]).length===0)).toBe(true);
 await expect(board.locator('.removal-piece')).toHaveCount(0);
 expect(await page.evaluate(()=>window.passiveAudioObservations.filter(event=>event.kind==='source-start'&&event.channels===1&&Math.abs(event.duration-.13)<.0001&&Math.abs(event.firstSample-(-.43989384174346924))<1e-8))).toHaveLength(0);
 await page.screenshot({path:info.outputPath(`sequence-rescued-${width}.png`),fullPage:true});
 await info.attach('projected-sequence-authority',{contentType:'application/json',body:JSON.stringify({gameId,initialPieceIds:ids,finalPieceIds:after.board.state.pieces.map(piece=>piece.id).sort(),moves:after.moves.map(move=>({moveId:move.moveId,destroyedPieces:move.destroyedPieces})),continuation:after.board.state.continuation})});
});
