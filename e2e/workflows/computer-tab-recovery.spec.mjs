import {test,expect} from '@playwright/test';
import {STORAGE_GENERATION_HEADER} from '../../packages/shared-types/src/storage-policy.js';
import {submitPlayableAction,switchGamePanel} from '../support/app.mjs';
import {readProjectedGame,waitForComputerDecision} from '../support/computer-projection.mjs';

const guestRequest=(page,route,body)=>page.evaluate(async({route,body,header})=>{
 const bootstrap=await fetch('/api/shell/bootstrap');const generation=bootstrap.headers.get(header);
 const identityId=localStorage.getItem('righelt.identity.id.v1');
 const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json',...(generation?{[header]:generation}:{})},body:JSON.stringify({...body,identityId,protocolVersion:2})});
 if(!response.ok)throw Error(`Local computer fixture failed: ${response.status}`);
 return response.json();
},{route,body,header:STORAGE_GENERATION_HEADER});
const projected=(page,id)=>page.evaluate(readProjectedGame,{id,guest:true});
const createComputer=async page=>{
 await page.goto('/');await expect(page.getByTestId('home-create-game')).toBeVisible();
 const {game}=await guestRequest(page,'/api/shell/games',{selfPlayMode:true,computer:{p1:null,p2:'babs'}});
 await page.goto(`/#/game/${game.id}`);await switchGamePanel(page,'players');
 await expect(page.getByRole('button',{name:'Babs, Blue, Active here',exact:true})).toBeVisible({timeout:20000});return game.id;
};

test('closing the original tab automatically restores computer play in a new tab with the same owner',async({page,context},info)=>{
 const id=await createComputer(page);const next=await context.newPage();await page.close();
 await next.goto(`/#/game/${id}`);await switchGamePanel(next,'players');
 await expect(next.getByRole('button',{name:'Babs, Blue, Active here',exact:true})).toBeVisible({timeout:25000});
 const submissions=[];next.on('request',request=>{if(request.method()!=='POST')return;try{const value=request.postDataJSON();if(value?.payload?.computer)submissions.push(value);}catch{}});
 const game=await projected(next,id);await switchGamePanel(next,'board');
 await submitPlayableAction(next,game.legalActions.find(action=>action.from&&action.to));
 if((await projected(next,id)).canEndTurn)await next.locator('[data-board-preview-action="end-turn"]').click();
 await waitForComputerDecision(next,id,'babs',{guest:true});
 const finished=await projected(next,id);expect(finished.moves.some(move=>move.computerProof)).toBe(true);
 expect(new Set(finished.moves.map(move=>move.moveId)).size).toBe(finished.moves.length);
 expect(submissions.length).toBeGreaterThan(0);
 const identities=new Map();for(const submission of submissions){const key=submission.expectedGameplayRevision;const original=identities.get(key);if(original)expect(submission).toEqual(original);else identities.set(key,submission);}
 expect(new Set(finished.moves.filter(move=>move.computerProof).map(move=>move.computerProof.attemptId)).size).toBe(finished.moves.filter(move=>move.computerProof).length);
 await switchGamePanel(next,'players');await next.screenshot({path:info.outputPath('computer-resumed-new-tab.png')});
});

test('player card deliberately restores paused manual play and lost acknowledgement keeps one resume intent',async({page},info)=>{
 const id=await createComputer(page);
 for(const action of ['takeover','manual','pause']){
  const game=await projected(page,id);
  await guestRequest(page,`/api/shell/games/${id}/computer-control`,{action,deviceId:game.computer.lease.deviceId,generation:game.computer.generation});
 }
 const card=page.getByRole('button',{name:'Babs, Blue, Paused',exact:true});await expect(card).toBeVisible();await card.click();
 const resume=page.getByRole('button',{name:'Resume here',exact:true});await expect(resume).toBeEnabled();
 const sent=[];let dropped=false;
 await page.route(`**/api/shell/games/${id}/shared`,async route=>{
  const envelope=route.request().postDataJSON();
  if(envelope.payload?.values?.action==='resume-here'){
   sent.push(envelope);
   if(!dropped){dropped=true;await route.fetch();await route.abort();return;}
  }
  await route.continue();
 });
 await resume.click();
 await expect(page.getByRole('button',{name:'Babs, Blue, Active here',exact:true})).toBeVisible({timeout:25000});
 await expect(page.getByRole('button',{name:'Resume here',exact:true})).toHaveCount(0);
 const game=await projected(page,id);
 expect([game.computer.paused,game.computer.manual,game.computer.singleStep,game.computer.takeoverTurn]).toEqual([false,false,false,null]);
 expect(sent.length).toBeGreaterThan(0);for(const envelope of sent)expect(envelope).toEqual(sent[0]);
 expect(game.pendingCommandCount).toBe(0);
 await page.screenshot({path:info.outputPath('computer-card-resumed.png')});
});
