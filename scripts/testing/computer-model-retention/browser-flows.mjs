// Real-browser operations only. Acceptance never injects board state or mock replies.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {writePrivate,validateSnapshot,assertHistoryPrefix} from './state-fixture.mjs';
export function passiveWorkerIdentity() {
 const Native=window.Worker;window.retentionWorkerIdentities=[];
 window.Worker=new Proxy(Native,{construct(target,args,newTarget){
  const worker=Reflect.construct(target,args,newTarget),send=worker.postMessage;
  worker.postMessage=function(...values){
   try {const message=values[0];if(window.retentionWorkerIdentities.length<1000)window.retentionWorkerIdentities.push({at:Date.now(),type:message?.type,modelVersion:message?.modelVersion,metadata:message?.metadata?{gameId:message.metadata.gameId,modelVersion:message.metadata.modelVersion,gameplayRevision:message.metadata.gameplayRevision}:null});}catch{}
   return Reflect.apply(send,this,values);
  };return worker;
 }});
}
export function restoreSession({origin,values}) {if(location.origin===origin)for(const [key,value]of Object.entries(values))sessionStorage.setItem(key,value);}
export async function pendingJournal(page) {
 return page.evaluate(async()=>{
  const known=await indexedDB.databases();if(!known.some(item=>item.name==='righelt.online-commands.v2'))throw Error('Real command journal was never initialized');
  return new Promise((resolve,reject)=>{const request=indexedDB.open('righelt.online-commands.v2');request.onerror=()=>reject(request.error);request.onupgradeneeded=()=>{request.transaction.abort();reject(Error('Refuse to manufacture a missing journal'));};request.onsuccess=()=>{const db=request.result;try{const tx=db.transaction('commands','readonly'),read=tx.objectStore('commands').getAll();let rows;read.onsuccess=()=>{rows=read.result;};tx.oncomplete=()=>{db.close();resolve(rows);};tx.onabort=()=>{db.close();reject(tx.error);};}catch(error){db.close();reject(error);}};});
 });
}
export async function session(page) {
 return page.evaluate(async()=>{const response=await fetch('/api/auth/session',{cache:'no-store'});if(!response.ok)throw Error(`Session read failed: ${response.status}`);const value=await response.json();if(!value.authenticated||!value.account?.id||!value.contextId)throw Error('Original authenticated account/session required');return value;});
}
export async function waitValue(read,predicate,{label,timeout=100000,check=()=>{}}) {
 const end=Date.now()+timeout;for(;;){await check();const value=await read();if(predicate(value))return value;if(Date.now()>=end)throw Error(`Timed out: ${label}`);await new Promise(resolve=>setTimeout(resolve,200));}
}
export function versionedReadBody(body) {
 if(body===undefined)return undefined;assert.ok(body&&typeof body==='object'&&!Array.isArray(body),'Operation body must be an object');assert.ok(body.protocolVersion===undefined||body.protocolVersion===2,'Only current protocol 2 allowed');return {...body,protocolVersion:2};
}
export function flowTools({appHelpers,projection,requests,expect,check,output}) {
 const game=(page,id)=>page.evaluate(projection.readProjectedGame,{id});
 const request=async(page,route,body)=>{await check();const result=await requests.request(page,route,versionedReadBody(body),2);assert.equal(result.status,200,`Real API failed: ${route}`);return result.body;};
 const navigate=async(page,id)=>{await check();await page.goto(`/#/game/${encodeURIComponent(id)}`);await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',id);};
 const stable=async(page,id,model)=>waitValue(()=>game(page,id),g=>g.computer?.modelId===model&&!g.computerTurn&&(g.canRecordMove===true||g.canEndTurn===true),{label:'stable human turn',check});
 const history=game=>({version:1,gameId:game.id,moves:structuredClone(game.moves),turns:structuredClone(game.turns),board:structuredClone(game.board)});
 async function humanThenComputer(page,id,modelId,assetSha,{afterMoveIds=[]}={}) {
  let prior=await stable(page,id,modelId);assert.equal(prior.board.state.outcome.status,'ongoing');
  const known=new Set(afterMoveIds.length?afterMoveIds:prior.moves.map(move=>move.moveId));
  for(let index=0;index<32;index++) {
   await check();const current=await game(page,id);assert.equal(current.computer.modelId,modelId);
   if(current.computerTurn)break;
   if(current.canEndTurn){await page.locator('[data-action="end-turn"], [data-board-preview-action="end-turn"]').filter({visible:true}).click();break;}
   assert.equal(current.canRecordMove,true,'Human input must be authoritatively enabled');
   const action=current.legalActions.find(a=>a.type==='project')??current.legalActions.find(a=>a.type==='move')??current.legalActions.find(a=>a.from&&a.to);
   assert.ok(action?.from&&action?.to,'No legal human spatial action');
   await appHelpers.switchGamePanel(page,'board');await appHelpers.submitPlayableAction(page,action);
   await waitValue(()=>game(page,id),g=>g.gameplayRevision>current.gameplayRevision,{label:'accepted human action',check});
  }
  const accepted=await waitValue(()=>game(page,id),g=>g.computer?.modelId===modelId&&g.moves.some(move=>!known.has(move.moveId)&&move.computerProof?.modelId===modelId)&&!g.computerTurn,{label:'new accepted computer decision and completed turn',check});
  const decision=accepted.moves.find(move=>!known.has(move.moveId)&&move.computerProof?.modelId===modelId);assert.ok(decision?.moveId);
  const attempt=await request(page,`/api/shell/games/${encodeURIComponent(id)}/decision-attempt`,{attemptId:decision.computerProof.attemptId,kind:'computer'});
  const archive=await request(page,`/api/shell/games/${encodeURIComponent(id)}/decision-history`,{});
  assert.equal(attempt.attempt.result.status,'ready');assert.deepEqual(attempt.attempt.result.action,decision.action);assert.ok(archive.items.some(row=>row.id===decision.moveId));
  const workers=await page.evaluate(()=>window.retentionWorkerIdentities??[]);
  assert.ok(workers.some(row=>row.type==='compute'&&row.metadata?.gameId===id&&row.metadata?.modelVersion===assetSha),'Actual compute request must use the selected asset SHA');
  await waitValue(()=>pendingJournal(page),rows=>rows.length===0,{label:'durable queue settles without reconstructed intent',check});
  return {game:accepted,decision,attempt:attempt.attempt,archive,workers};
 }
 async function createComputer(page,spec) {
  await page.goto('/#/');await page.locator('[data-action="opponent-story"][data-opponent="babs"]').click();
  await projection.waitForOpponentReady(page);
  const responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/shell/games'&&r.request().method()==='POST'&&r.request().postDataJSON()?.computer?.p2==='babs');
  await page.getByRole('button',{name:'Play Babs',exact:true}).click();const response=await responsePromise;assert.equal(response.status(),200);
  const created=(await response.json()).game;assert.equal(response.request().postDataJSON().computerModelId,spec.modelId);assert.equal(created.computer.modelId,spec.modelId);
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',created.id);
  await waitValue(()=>game(page,created.id),g=>g.canRecordMove===true&&g.computer?.lease?.deviceId,{label:'acknowledged initial computer control',check});
  return created;
 }
 async function register(page) {
  await page.goto('/');await page.locator('button[data-action="create-self-play"]').click();const dialog=page.getByTestId('account-dialog');
  await dialog.getByRole('button',{name:'Create account',exact:true}).click();
  await dialog.getByLabel('Username',{exact:true}).fill(`Retain_${Date.now().toString(36)}`);await dialog.getByLabel('Password',{exact:true}).fill(`Private retention ${Date.now()} 482`);
  await dialog.getByRole('button',{name:'Create account & continue',exact:true}).click();await expect(page.getByTestId('game-shell')).toBeVisible();await session(page);
 }
 async function snapshot(page,proof,spec) {
  const account=await session(page),pendingCommands=await pendingJournal(page);assert.deepEqual(pendingCommands,[]);
  const value={kind:'actual-old026-computer-retention-v1',source:spec,account:account.account,sessionContextId:account.contextId,gameId:proof.game.id,gameURL:page.url(),modelId:proof.game.computer.modelId,ownerId:proof.game.computer.ownerId,computer:structuredClone(proof.game.computer),history:history(proof.game),acceptedDecision:proof.decision,attempt:proof.attempt,archive:proof.archive,storage:await page.context().storageState({indexedDB:true}),sessionStorage:await page.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage))),pendingCommands};
  validateSnapshot(value);await writePrivate(path.join(output,'old026-owner-fixture.json'),value);return value;
 }
 async function retained(page,saved,spec,nextSpec) {
  await navigate(page,saved.gameId);const account=await session(page);assert.equal(account.account.id,saved.account.id);assert.equal(account.contextId,saved.sessionContextId,'Retain original session; no fresh login fallback');
  const before=await game(page,saved.gameId);assert.equal(before.computer.modelId,saved.modelId);assert.equal(before.computer.ownerId,saved.ownerId);assert.deepEqual(history(before),saved.history);
  const proof=await humanThenComputer(page,saved.gameId,saved.modelId,spec.assetSha256,{afterMoveIds:saved.history.moves.map(move=>move.moveId)});assertHistoryPrefix(proof.game,saved);
  await page.locator('[data-action="computer-control"][data-control="decline-upgrade"]').click();
  const controlled=await waitValue(()=>game(page,saved.gameId),g=>g.computer?.declinedModelId===nextSpec.modelId,{label:'explicit Keep current control accepted',check});assert.equal(controlled.computer.modelId,saved.modelId);assertHistoryPrefix(controlled,saved);
  await page.reload();await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',saved.gameId);const reloaded=await game(page,saved.gameId);assertHistoryPrefix(reloaded,saved);assert.equal(reloaded.computer.modelId,saved.modelId);assert.ok(reloaded.moves.some(move=>move.moveId===proof.decision.moveId));assert.equal(reloaded.computer.declinedModelId,nextSpec.modelId);
  return {...proof,controlled,reloaded};
 }
 async function branch(page,saved,spec) {
  await navigate(page,saved.gameId);await appHelpers.switchGamePanel(page,'history');
  const sourceDecision=saved.history.moves.find(move=>!move.computerProof);assert.ok(sourceDecision?.moveId);
  const row=page.locator(`[data-testid="history-move-item"][data-move-id="${sourceDecision.moveId}"]`);await row.locator('.history-move-line').click();await row.locator('[data-action="launch-history-branch"]').click();
  const chooser=page.getByRole('dialog',{name:'Create a new game here',exact:true});await chooser.locator('input[name="rematch-opponent"][value="babs"]').check();await chooser.getByRole('radio',{name:'Blue',exact:true}).check();
  await expect(chooser.getByRole('button',{name:'Start game',exact:true})).toBeEnabled({timeout:45000});
  const responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/shell/history/branch'&&r.request().method()==='POST');const popupPromise=page.waitForEvent('popup');
  await chooser.getByRole('button',{name:'Start game',exact:true}).click();const [response,popup]=await Promise.all([responsePromise,popupPromise]);
  try{
   assert.equal(response.status(),200);const created=(await response.json()).game;assert.equal(created.computer.modelId,spec.modelId);assert.deepEqual(created.board.state,sourceDecision.selectionSnapshot);assert.notEqual(created.id,saved.gameId);
   await expect(popup.getByTestId('game-shell')).toHaveAttribute('data-game-id',created.id);
   const finished=await waitValue(()=>game(popup,created.id),g=>g.moves.some(move=>move.computerProof?.modelId===spec.modelId)&&!g.computerTurn,{label:'new-model branch computer proof',check});
   const worker=await popup.evaluate(()=>window.retentionWorkerIdentities??[]);assert.ok(worker.some(r=>r.metadata?.gameId===created.id&&r.metadata.modelVersion===spec.assetSha256));
   const acceptedDecision=finished.moves.find(move=>move.computerProof?.modelId===spec.modelId);assert.ok(acceptedDecision?.moveId);
   const attempt=await request(popup,`/api/shell/games/${encodeURIComponent(created.id)}/decision-attempt`,{attemptId:acceptedDecision.computerProof.attemptId,kind:'computer'});
   const archive=await request(popup,`/api/shell/games/${encodeURIComponent(created.id)}/decision-history`,{});assert.equal(attempt.attempt.result.status,'ready');assert.deepEqual(attempt.attempt.result.action,acceptedDecision.action);assert.ok(archive.items.some(row=>row.id===acceptedDecision.moveId));
   assertHistoryPrefix(await game(page,saved.gameId),saved);return {created,finished,sourceDecision,decision:acceptedDecision,attempt:attempt.attempt,archive,worker};
  }finally{await popup.close();}
 }
 async function rematch(page,spec,root) {
  const catalog=JSON.parse(await readFile(path.join(root,'apps/web/scenarios/catalog.json'),'utf8'));const scenario=requests.selectTerminalScenario(catalog);
  const created=(await request(page,'/api/shell/games',{selfPlayMode:false,creatorSide:'p2'})).game;await navigate(page,created.id);await appHelpers.closeHostInvitation(page);
  const imported=await request(page,'/api/shell/scenarios/import',{scenario,targetGameId:created.id,protocolVersion:2});assert.notEqual(imported.game.board.state.outcome.status,'ongoing');
  const result=page.getByTestId('game-result');await expect(result).toBeVisible();await result.getByRole('button',{name:'Play again',exact:true}).click();
  const chooser=page.getByRole('dialog',{name:'Play again',exact:true});await chooser.locator('input[name="rematch-opponent"][value="babs"]').check();await chooser.getByRole('radio',{name:'Red',exact:true}).check();
  await expect(chooser.getByRole('button',{name:'Start game',exact:true})).toBeEnabled({timeout:45000});
  const responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/shell/games'&&r.request().method()==='POST');await chooser.getByRole('button',{name:'Start game',exact:true}).click();const response=await responsePromise;
  assert.equal(response.status(),200);assert.equal(response.request().postDataJSON().computerModelId,spec.modelId);const fresh=(await response.json()).game;assert.equal(fresh.computer.modelId,spec.modelId);assert.notEqual(fresh.id,created.id);
  await expect(page.getByTestId('game-shell')).toHaveAttribute('data-game-id',fresh.id);return humanThenComputer(page,fresh.id,spec.modelId,spec.assetSha256);
 }
 return {register,createComputer,humanThenComputer,snapshot,retained,branch,rematch,game,navigate,request,history};
}
