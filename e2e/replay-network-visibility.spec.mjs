import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {applyAction,resolveToStability} from '../apps/web/generated/packages/game-engine/src/index.js';
import {importScenarioGame} from './support/app.mjs';
import {readProjectedGame} from './support/computer-projection.mjs';
const canonical=g=>({id:g.id,board:g.board.state,moves:g.moves,turns:g.turns,revision:g.gameplayRevision});
const pieces=s=>s.pieces.map(p=>({id:p.id,row:p.position.row,col:p.position.col})).sort((a,b)=>a.id.localeCompare(b.id));
const painted=root=>root.locator('.piece-token[data-piece-id]:not(.move-ghost):not(.history-destruction-piece)').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.pieceId,row:Number(n.closest('.cell').dataset.row),col:Number(n.closest('.cell').dataset.col)})).sort((a,b)=>a.id.localeCompare(b.id)));
const geometry=page=>page.locator('#shell-board').evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});
const visibleLines=page=>page.locator('[data-testid="game-board-wrap"] [data-legend-kind]').evaluateAll(nodes=>nodes.filter(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity)>0&&r.width+r.height>0;}).length);
function prefixFixture(){
 const original=JSON.parse(readFileSync(new URL('../apps/web/scenarios/catalog.json',import.meta.url),'utf8')).scenarios.find(s=>s.title==='Cannot rush into unsupplied area');
 const scenario=structuredClone(original);scenario.title='Recorded replay network visibility';scenario.moves=scenario.moves.slice(0,8);let state=resolveToStability(scenario.initialState,{artifactMode:'full'});
 const endTurn=()=>{const prior=state.turnIndex;state=resolveToStability(applyAction(state,{type:'end_turn'}).state,{artifactMode:'full'});expect(state.turnIndex).toBeGreaterThan(prior);};
 for(const move of scenario.moves){while(state.turnIndex<move.turnIndex)endTurn();state=resolveToStability(applyAction(state,move.action).state,{artifactMode:'full'});}
 while(state.turnIndex<6)endTurn();
 state.pieces=state.pieces.map(piece=>({...piece,shifted:piece.shifted??false,pushed:piece.pushed??false}));scenario.resultingState=state;scenario.savedSelection=null;return scenario;
}
test('actual recorded rush replay hides live networks and restores inspection without moving the Board',async({page,baseURL},info)=>{
 await page.setViewportSize({width:1440,height:1100});await page.emulateMedia({reducedMotion:'reduce'});const {gameId}=await importScenarioGame(page,prefixFixture(),baseURL);const read=()=>page.evaluate(readProjectedGame,{id:gameId,guest:true});const before=await read();expect(before.moves).toHaveLength(8);const turn=before.moves.filter(m=>m.turnIndex===5);expect(turn).toHaveLength(3);const frame=turn[0].inspectionSnapshot??turn[0].snapshot;
 expect(frame.pieces.find(p=>p.id==='C2').position).toEqual({row:6,col:3});expect(before.board.state.pieces.find(p=>p.id==='C2').position).toEqual({row:6,col:4});const bluePaths=s=>s.pieces.filter(p=>p.owner==='P2').flatMap(p=>(s.artifacts.command.shortestPathToCommanderByPieceId[p.id]?.length??0)>1?[p.id]:[]);expect(bluePaths(frame)).toEqual([]);expect(bluePaths(before.board.state)).toHaveLength(2);
 await page.locator('#shell-board .cell[data-row="6"][data-col="4"]').click();const inspector=page.locator('[data-board-inspection="command"]');await inspector.click();await expect(inspector).toHaveAttribute('data-inspection-owner','P2');await expect(page.locator('#shell-overlay-lines [data-legend-kind="command"]')).toHaveCount(2);expect(await visibleLines(page)).toBe(2);const initial=await geometry(page);
 const replay=page.getByRole('button',{name:'Show me again',exact:true});await expect(replay).toHaveCount(1);await replay.click();await expect(page.locator('.computer-replay')).toBeVisible();await expect.poll(()=>painted(page.locator('.computer-replay'))).toEqual(pieces(frame));await page.screenshot({path:info.outputPath('recorded-frame-without-live-networks.png'),fullPage:true});
 for(let step=0;step<3;step++){
  expect(await visibleLines(page)).toBe(0);await expect(page.locator('[data-legend-entry="command"]')).toBeHidden();await expect(inspector).toBeVisible();await expect(inspector).toHaveAttribute('aria-pressed','true');for(const[k,v]of Object.entries(await geometry(page)))expect(Math.abs(v-initial[k]),k).toBeLessThanOrEqual(0.5);await page.locator('[data-board-message-action="replay-next"]').click();
 }
 await expect(page.locator('.computer-replay')).toHaveCount(0);expect(await visibleLines(page)).toBe(2);await expect(page.locator('[data-legend-entry="command"]')).toBeVisible();await expect(inspector).toHaveAttribute('aria-pressed','true');await expect(replay).toBeFocused();expect(canonical(await read())).toEqual(canonical(before));for(const[k,v]of Object.entries(await geometry(page)))expect(Math.abs(v-initial[k]),k).toBeLessThanOrEqual(0.5);
});
