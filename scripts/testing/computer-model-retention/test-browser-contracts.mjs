// UNEXECUTED pure metadata/closure regression. Fake interfaces below make NO browser,
// application, network, model, state-copy or acceptance-proof claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {versionedReadBody,flowTools} from './browser-flows.mjs';
test('canonical read body adds protocol 2 without changing original metadata',()=>{const input={kind:'computer',attemptId:'synthetic-attempt'};assert.deepEqual(versionedReadBody(input),{...input,protocolVersion:2});assert.equal(input.protocolVersion,undefined);assert.deepEqual(versionedReadBody({}),{protocolVersion:2});assert.equal(versionedReadBody(undefined),undefined);});
test('read body rejects incompatible or malformed protocol metadata',()=>{for(const value of [null,[],1,{protocolVersion:1},{protocolVersion:'2'}])assert.throws(()=>versionedReadBody(value));});
function harness({wrongSnapshot=false,wrongProof=false}={}) {
 const state={synthetic:true},action={type:'move',actorId:'synthetic-piece'};
 const sourceDecision={moveId:'original-human-move',selectionSnapshot:state};
 const acceptedDecision={moveId:'new-computer-move',action,computerProof:{modelId:'synthetic-closed-model',attemptId:'synthetic-attempt'}};
 const saved={gameId:'old-game',modelId:'initial-1554',ownerId:'same-owner',history:{moves:[sourceDecision],turns:[{index:0,endedAt:'synthetic-end'}]}};
 const oldGame={id:saved.gameId,computer:{ownerId:saved.ownerId,modelId:saved.modelId},moves:saved.history.moves,turns:saved.history.turns};
 const created={id:'new-branch',computer:{modelId:acceptedDecision.computerProof.modelId},board:{state:wrongSnapshot?{wrong:true}:state}};
 const finished={...created,moves:[acceptedDecision],computerTurn:null};const calls=[],clicks=[];
 function locator(page,selector){return {page,selector,locator(child){return locator(page,selector+' '+child);},getByRole(role,options){return locator(page,selector+' '+role+':'+options.name);},async click(){clicks.push(selector);},async check(){}};}
 function page(kind){return {kind,async goto(){},getByTestId(id){return locator(this,id);},locator(selector){return locator(this,selector);},getByRole(role,options){return locator(this,role+':'+options.name);},async waitForResponse(predicate){const response={status:()=>200,json:async()=>({game:created}),url:()=> 'https://127.0.0.1:9988/api/shell/history/branch',request:()=>({method:()=> 'POST'})};assert.equal(predicate(response),true);return response;},async waitForEvent(event){assert.equal(event,'popup');return popup;},async evaluate(fn,arg){if(arg?.id)return arg.id===saved.gameId?oldGame:finished;return [{metadata:{gameId:created.id,modelVersion:'synthetic-sha'}}];},async close(){this.closed=true;}};}
 const owner=page('owner'),popup=page('popup');
 const tools=flowTools({appHelpers:{switchGamePanel:async(p,panel)=>assert.equal(panel,'history')},projection:{readProjectedGame(){}},requests:{request:async(p,route,body,authProtocol)=>{calls.push({route,body,authProtocol});assert.equal(body.protocolVersion,2);assert.equal(authProtocol,2);return {status:200,body:route.endsWith('/decision-attempt')?{attempt:{result:{status:'ready',action:wrongProof?{type:'pass'}:action}}}:{items:[{id:acceptedDecision.moveId}]}};}},expect:loc=>({async toBeEnabled(){assert.ok(loc.selector.includes('Start game'));},async toHaveAttribute(name,value){assert.equal(name,'data-game-id');assert.equal(value,loc.page.kind==='popup'?created.id:saved.gameId);}}),check:async()=>{},output:'/synthetic-only'});
 return {tools,owner,popup,saved,sourceDecision,acceptedDecision,created,calls,clicks};
}
test('actual branch closure retains distinct source and accepted metadata, with protocol on both proof reads',async()=>{const h=harness(),result=await h.tools.branch(h.owner,h.saved,{modelId:'synthetic-closed-model',assetSha256:'synthetic-sha'});assert.equal(result.sourceDecision,h.sourceDecision);assert.equal(result.decision,h.acceptedDecision);assert.equal(result.created,h.created);assert.equal(h.popup.closed,true);assert.equal(h.calls.length,2);assert.ok(h.calls.every(call=>call.body.protocolVersion===2));assert.ok(h.clicks.some(selector=>selector.includes('original-human-move')&&selector.endsWith('.history-move-line')));});
test('actual branch closure still rejects a mismatched captured source snapshot',async()=>{const h=harness({wrongSnapshot:true});await assert.rejects(()=>h.tools.branch(h.owner,h.saved,{modelId:'synthetic-closed-model',assetSha256:'synthetic-sha'}),{code:'ERR_ASSERTION'});assert.equal(h.popup.closed,true);});
test('actual branch closure still rejects accepted proof/action mismatch',async()=>{const h=harness({wrongProof:true});await assert.rejects(()=>h.tools.branch(h.owner,h.saved,{modelId:'synthetic-closed-model',assetSha256:'synthetic-sha'}),{code:'ERR_ASSERTION'});assert.equal(h.popup.closed,true);});
test('actual registration flow starts at exact Home create-self-play action',async()=>{
 const clicks=[],fills=[];const account={authenticated:true,account:{id:'synthetic-owner'},contextId:'synthetic-context'};
 const loc=label=>({async click(){clicks.push(label);},async fill(value){fills.push({label,value});},getByRole(role,o){return loc(role+':'+o.name);},getByLabel(name){return loc('label:'+name);}});
 const page={async goto(url){assert.equal(url,'/');},locator(selector){assert.equal(selector,'button[data-action="create-self-play"]');return loc(selector);},getByTestId(id){return loc(id);},async evaluate(){return account;}};
 const tools=flowTools({appHelpers:{},projection:{},requests:{},expect:()=>({async toBeVisible(){}}),check:async()=>{},output:'/synthetic-only'});
 await tools.register(page);assert.equal(clicks[0],'button[data-action="create-self-play"]');assert.ok(clicks.includes('button:Create account & continue'));assert.equal(fills.length,2);
});
test('actual create flow calls the existing waitForOpponentReady export before Play',async()=>{
 const events=[],spec={modelId:'synthetic-closed-model'},created={id:'synthetic-created',computer:{modelId:spec.modelId,lease:{deviceId:'synthetic-tab'}},canRecordMove:true};
 const response={url:()=> 'https://127.0.0.1:9988/api/shell/games',request:()=>({method:()=> 'POST',postDataJSON:()=>({computer:{p2:'babs'},computerModelId:spec.modelId})}),status:()=>200,json:async()=>({game:created})};
 const page={async goto(url){assert.equal(url,'/#/');},locator(){return {async click(){events.push('story');}};},async waitForResponse(predicate){assert.equal(predicate(response),true);return response;},getByRole(role,o){assert.equal(o.name,'Play Babs');return {async click(){events.push('play');}};},getByTestId(id){return {id};},async evaluate(fn,arg){assert.equal(arg.id,created.id);return created;}};
 const tools=flowTools({appHelpers:{},projection:{async waitForOpponentReady(p){assert.equal(p,page);events.push('ready');return {elapsedMs:1};},readProjectedGame(){}},requests:{},expect:loc=>({async toHaveAttribute(name,value){assert.equal(loc.id,'game-shell');assert.equal(name,'data-game-id');assert.equal(value,created.id);}}),check:async()=>{},output:'/synthetic-only'});
 assert.equal(await tools.createComputer(page,spec),created);assert.deepEqual(events,['story','ready','play']);
});
