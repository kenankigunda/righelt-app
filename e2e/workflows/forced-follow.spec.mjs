import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createInitialState, resolveToStability } from '../../apps/web/generated/packages/game-engine/src/index.js';
import { importScenarioGame, submitPlayableAction, switchGamePanel } from '../support/app.mjs';
import { readProjectedGame } from '../support/computer-projection.mjs';

const piece=(id,owner,kind,row,col)=>({id,owner,kind,position:{row,col},supplied:true,commanded:true});
const initialState=resolveToStability({...createInitialState(),pieces:[piece('C1','P1','commander',3,6),piece('C2','P2','commander',6,3),piece('A1','P1','unit',4,1),piece('A2','P1','unit',3,1),piece('D1','P2','unit',4,2)]});
const scenario={formatVersion:2,id:'902c315a-a1cd-4e47-90c2-35e07dd48b64',title:'Mandatory follow acceptance',description:'One legal follow after an acknowledged retreat',incorrect:false,initialState,moves:[],resultingState:initialState,expectedFinalStateHash:'',expectedOutcome:'ongoing'};
const projected=(page,id)=>page.evaluate(readProjectedGame,{id,guest:true});
const instrument=()=>{
  window.forcedFollowProbe={notes:[],motions:[],acknowledgements:[]};
  const acknowledge=body=>{const move=body?.game?.moves?.at(-1);if(move?.action?.type==='follow')window.forcedFollowProbe.acknowledgements.push({at:performance.now(),moveId:move.moveId,clientCommandId:move.clientCommandId});};
  const json=Response.prototype.json;
  Response.prototype.json=function(...args){return Reflect.apply(json,this,args).then(body=>{acknowledge(body);return body;});};
  if(typeof WebSocket==='function'){
    const Native=WebSocket;
    window.WebSocket=new Proxy(Native,{construct(target,args,newTarget){const socket=Reflect.construct(target,args,newTarget);socket.addEventListener('message',event=>{try{acknowledge(JSON.parse(event.data));}catch{}});return socket;}});
  }
  const start=OscillatorNode.prototype.start;
  OscillatorNode.prototype.start=function(...args){const result=Reflect.apply(start,this,args);window.forcedFollowProbe.notes.push({at:performance.now(),frequency:this.frequency.value});return result;};
  const animate=Element.prototype.animate;
  Element.prototype.animate=function(frames,options){const result=Reflect.apply(animate,this,[frames,options]);if(this.closest('.computer-replay')&&this.dataset.pieceId)window.forcedFollowProbe.motions.push({at:performance.now(),pieceId:this.dataset.pieceId,frames,options});return result;};
};

for(const fault of ['none','lost reply','refresh pending'])test(`mandatory follow and exact sequence replay (${fault})`,async({page,baseURL},info)=>{
  await page.setViewportSize({width:fault==='none'?390:1440,height:1000});
  await page.addInitScript(instrument);
  if(fault!=='none')await page.addInitScript(()=>{window.WebSocket=undefined;});
  const {gameId}=await importScenarioGame(page,scenario,baseURL);
  await switchGamePanel(page,'players');await page.getByRole('button',{name:'Play both sides',exact:true}).click();await switchGamePanel(page,'board');
  const requests=[],holds=[];let injected=false,release,observed;
  const gate=new Promise(resolve=>{release=resolve;}),persisted=new Promise(resolve=>{observed=resolve;});
  const pattern=`**/api/shell/games/${gameId}/apply`;
  await page.route(pattern,async route=>{
    const envelope=route.request().postDataJSON();
    if(envelope.payload?.action?.type==='follow'){
      requests.push(envelope);
      holds.push(await page.evaluate(()=>{
        const position=id=>{const cell=document.querySelector(`.computer-replay .piece-token[data-piece-id="${id}"]`)?.closest('.cell');return cell?{row:Number(cell.dataset.row),col:Number(cell.dataset.col)}:null;};
        return{at:performance.now(),follower:position('A2'),defender:position('D1'),message:document.getElementById('shell-board-preview-label')?.textContent,moveCues:window.forcedFollowProbe.notes.filter(note=>note.frequency===820).length};
      }));
      if(fault!=='none'&&!injected){
        injected=true;const response=await route.fetch();expect(response.ok()).toBe(true);observed();
        if(fault==='refresh pending')await gate;
        try{await route.abort('failed');}catch(error){if(fault!=='refresh pending')throw error;}
        return;
      }
    }
    await route.continue();
  });
  try{
    const first=await projected(page,gameId),push=first.legalActions.find(action=>action.type==='push'&&action.actorId==='A1');expect(push).toBeTruthy();
    await submitPlayableAction(page,push);
    await expect.poll(async()=> (await projected(page,gameId)).board.state.continuation?.phase).toBe('retreat');
    const pushed=await projected(page,gameId),retreat=pushed.legalActions.find(action=>action.type==='retreat');expect(retreat).toBeTruthy();
    await submitPlayableAction(page,retreat);
    if(fault==='refresh pending'){
      await persisted;await page.reload();await expect(page.getByTestId('game-shell')).toBeVisible();release();
    }
    await expect.poll(async()=> (await projected(page,gameId)).moves.filter(move=>move.action?.type==='follow').length,{timeout:20000}).toBe(1);
    const replay=page.locator('[data-board-message-action="replay-push-sequence"]');await expect(replay).toBeVisible();
    const after=await projected(page,gameId),follow=after.moves.find(move=>move.action?.type==='follow');
    expect(after.moves.map(move=>move.action.type)).toEqual(['push','retreat','follow']);
    expect(follow.action.actorId).toBe('A2');expect(new Set(requests.map(request=>request.clientCommandId)).size).toBe(1);
    for(const envelope of requests)expect(envelope).toEqual(requests[0]);
    const probe=await page.evaluate(()=>window.forcedFollowProbe);
    expect(holds[0]).toMatchObject({follower:{row:3,col:1},defender:retreat.to,moveCues:0});expect(holds[0].message).toContain('Following the push');
    if(fault==='refresh pending')expect(probe.notes.filter(note=>note.frequency===820)).toHaveLength(0);
    else{
      const sounds=probe.notes.filter(note=>note.frequency===820),motions=probe.motions.filter(motion=>motion.pieceId==='A2');
      expect(sounds).toHaveLength(1);expect(motions).toHaveLength(1);
      const acknowledgement=probe.acknowledgements.find(receipt=>receipt.clientCommandId===follow.clientCommandId);expect(acknowledgement).toBeTruthy();
      expect(holds[0].at).toBeLessThanOrEqual(acknowledgement.at);expect(acknowledgement.at).toBeLessThanOrEqual(sounds[0].at);expect(sounds[0].at).toBeLessThanOrEqual(motions[0].at);
    }
    await expect(page.locator('.computer-replay')).toHaveCount(0);
    const liveSelection = await page.locator('[data-testid="game-board"] .cell.selected-piece').evaluateAll(cells=>cells.map(cell=>({row:cell.dataset.row,col:cell.dataset.col,className:cell.className})));
    expect(liveSelection).toEqual([]);
    const retreatCell = await page.locator(`[data-testid="game-board"] .cell[data-row="${retreat.to.row}"][data-col="${retreat.to.col}"]`).evaluate(cell=>({className:cell.className,hovered:cell.matches(':hover'),borderColor:getComputedStyle(cell).borderColor,boxShadow:getComputedStyle(cell).boxShadow}));
    await page.mouse.move(0,0);
    await page.screenshot({path:info.outputPath(`forced-follow-${fault.replaceAll(' ','-')}.png`)});
    const admissions=requests.length;
    await page.emulateMedia({reducedMotion:'reduce'});await replay.click();
    await expect(page.locator('#shell-board-preview-label')).toContainText('1 of 3');
    for(let index=0;index<3;index++)await page.getByRole('button',{name:'Next',exact:true}).click();
    await expect(page.locator('.computer-replay')).toHaveCount(0);
    const replayed=await projected(page,gameId);expect(replayed.gameplayRevision).toBe(after.gameplayRevision);expect(replayed.board.state).toEqual(after.board.state);expect(replayed.moves.map(move=>move.moveId)).toEqual(after.moves.map(move=>move.moveId));expect(requests.length).toBe(admissions);
    const proof=JSON.stringify({fault,requests,holds,follow,probe,liveSelection,retreatCell},null,2);
    await writeFile(info.outputPath('forced-follow-proof.json'),proof);
    await info.attach('forced-follow-proof',{contentType:'application/json',body:proof});
  }finally{release();await page.unrouteAll({behavior:'wait'});}
});
