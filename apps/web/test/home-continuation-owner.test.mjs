import {createAccountContinuationOwner} from '../shell/account-continuation-owner.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {homeContinuationLayoutCompatible,bindHomeContinuationAfterSettlement,bindHomeContinuationAfterRender,createHomeReadReplacement,resultForHomeContinuation,createHomeSectionReads,createHomeSectionState,sameRouteRead} from '../shell/home-section-reads.js';

const owner={};
const read=(columns=1)=>({generation:7,epoch:3,owner,hash:'#/',routeKey:'home',route:{name:'home'},homeVisit:4,homeDebug:false,
 inputs:JSON.stringify([4,false,['my','completed','other'].map(key=>[key,0,columns===1?3:4,columns])])});
const pending=source=>({...source,intent:{hash:'#/',action:'create-self-play'},running:true,recoveryEpisode:false});

test('layout replacement creates a new pending identity while preserving the exact intent and recovery episode',()=>{
 const before=read(),after=read(2),old=pending(before);old.recoveryEpisode=true;
 const job={read:before};const replacement=createHomeReadReplacement({job,activeJob:job,read:after,pending:old});
 assert.notEqual(replacement.continuation,old);assert.equal(replacement.continuation.intent,old.intent);
 assert.equal(replacement.continuation.running,false);assert.equal(replacement.continuation.recoveryEpisode,true);
 assert.equal(replacement.continuation.inputs,after.inputs);assert.equal(old.inputs,before.inputs);assert.equal(old.running,true);
});
for(const kind of ['account','owner','epoch','hash','visit','debug','page','keys','unsafe-page','unsafe-size','malformed'])test(`a ${kind} change cannot borrow a Home continuation`,()=>{
 const before=read(),after=read(2),old=pending(before);
 if(kind==='account')after.generation++;
 if(kind==='owner')after.owner={};
 if(kind==='epoch')after.epoch++;
 if(kind==='hash')after.hash='#/?scenarios=1';
 if(kind==='visit')after.homeVisit++;
 if(kind==='debug')after.homeDebug=true;
 if(['page','keys','unsafe-page','unsafe-size'].includes(kind)){
  const values=JSON.parse(after.inputs);
  if(kind==='page')values[2][0][1]=1;
  if(kind==='keys')values[2].pop();
  if(kind==='unsafe-page')values[2][0][1]=Number.MAX_SAFE_INTEGER+1;
  if(kind==='unsafe-size')values[2][0][2]=0;
  after.inputs=JSON.stringify(values);
 }
 if(kind==='malformed')after.inputs='not JSON';
 assert.equal(homeContinuationLayoutCompatible(before,after),false);
 const job={read:before};const replacement=createHomeReadReplacement({job,activeJob:job,read:after,pending:old});
 assert.equal(replacement.continuation,undefined);assert.equal(replacement.retiredContinuation,old);
});
test('foreign jobs, replacement owners and newer pending intents cannot be adopted',()=>{
 const before=read(),after=read(2),old=pending(before),job={read:before};
 assert.equal(createHomeReadReplacement({job,activeJob:{read:before},read:after,pending:old}).continuation,undefined);
 const first=createHomeReadReplacement({job,activeJob:job,read:after,pending:old});
 assert.equal(createHomeReadReplacement({job,previous:first,currentReplacement:{...first},read:read(3),pending:first.continuation}).continuation,undefined);
 assert.equal(createHomeReadReplacement({job,previous:first,currentReplacement:first,read:read(3),pending:pending(after)}).continuation,undefined);
 const next=createHomeReadReplacement({job,previous:first,currentReplacement:first,read:read(3),pending:first.continuation});
 assert.notEqual(next.continuation,first.continuation);assert.equal(next.continuation.intent,old.intent);
});
test('the same owned synchronous render may bind layout but cannot replace a newer action or page choice',()=>{
 const before=read(),old=pending(before),after=read(2);
 const bound=bindHomeContinuationAfterRender(old,old,after);
 assert.notEqual(bound,old);assert.equal(bound.intent,old.intent);
 assert.equal(bindHomeContinuationAfterRender(old,pending(before),after),null);
 const page=read(2),values=JSON.parse(page.inputs);values[2][0][1]=1;page.inputs=JSON.stringify(values);
 assert.equal(bindHomeContinuationAfterRender(old,old,page),null);
});
for(const outcome of ['failed','retired','partial'])test(`a ${outcome} settled job never grants continuation`,()=>{
 const error=new Error(outcome),record={outcome:outcome==='partial'?'fulfilled':outcome,result:{healthySettled:outcome!=='partial',error},error};
 assert.throws(()=>resultForHomeContinuation(record),value=>value===error);
});
test('a successful recovered read keeps its recovery result instead of treating it as ordinary success',()=>{
 const result={healthySettled:true,recovered:true};assert.equal(resultForHomeContinuation({outcome:'fulfilled',result}),result);
});

test('a known actual recovery is carried before the retired old catch can report its cancellation',()=>{
 const before=read(),after=read(2),old=pending(before),job={read:before};
 const replacement=createHomeReadReplacement({job,activeJob:job,read:after,pending:old,recovery:{read:before,error:new Error('temporary')}});
 assert.equal(replacement.continuation.recoveryEpisode,true);assert.equal(old.recoveryEpisode,false);
 const foreign=createHomeReadReplacement({job,activeJob:job,read:after,pending:old,recovery:{read:{...before,owner:{}},error:new Error('foreign')}});
 assert.equal(foreign.continuation.recoveryEpisode,false);
});

const terminalFixture=()=>{const before=read(),after=read();const tuples=JSON.parse(after.inputs);tuples[2][0][3]=5;tuples[2][1][3]=5;after.inputs=JSON.stringify(tuples);const original=pending(before);return {pending:original,currentPending:original,read:after,settledRead:before,result:{healthySettled:true,recovered:false},job:null,replacement:null};};
test('a healthy terminal columns-only render retains the exact data window and original intent once',()=>{
 const value=terminalFixture(),decision=bindHomeContinuationAfterSettlement(value),bound=decision.continuation;
 assert.equal(decision.requiresRead,false);
 assert.ok(bound);assert.notEqual(bound,value.pending);assert.equal(bound.intent,value.pending.intent);assert.equal(bound.inputs,value.read.inputs);assert.equal(value.pending.inputs,value.settledRead.inputs);
 assert.equal(bindHomeContinuationAfterSettlement({...value,currentPending:bound}),null,'the previous attempt cannot reclaim the new owner');
 value.pending.recoveryEpisode=true;assert.equal(bindHomeContinuationAfterSettlement(value).continuation.recoveryEpisode,true,'a real recovery still cannot auto-write');
});
for(const kind of ['partial','failed','foreign-pending','foreign-read','live-job','replacement','page','keys','account','visit','owner'])test(`terminal settlement refuses ${kind} adoption`,()=>{
 const value=terminalFixture();
 if(kind==='partial')value.result={healthySettled:false};
 if(kind==='failed')value.result=undefined;
 if(kind==='foreign-pending')value.currentPending={...value.pending};
 if(kind==='foreign-read')value.settledRead={...value.settledRead,epoch:99};
 if(kind==='live-job')value.job={};
 if(kind==='replacement')value.replacement={};
 if(kind==='account')value.read.generation++;
 if(kind==='visit')value.read.homeVisit++;
 if(kind==='owner')value.read.owner={};
 if(['page','page-size','keys'].includes(kind)){const values=JSON.parse(value.read.inputs);if(kind==='page')values[2][0][1]++;if(kind==='page-size')values[2][0][2]++;if(kind==='keys')values[2].pop();value.read.inputs=JSON.stringify(values);}
 assert.equal(bindHomeContinuationAfterSettlement(value),null);
});

test('a terminal larger visible data window transfers ownership but requires a real current read',()=>{
 const value=terminalFixture(),inputs=JSON.parse(value.read.inputs);inputs[2][0][2]=4;value.read.inputs=JSON.stringify(inputs);value.pending.recoveryEpisode=true;
 const decision=bindHomeContinuationAfterSettlement(value);assert.ok(decision);assert.equal(decision.requiresRead,true);assert.equal(decision.continuation.running,false);assert.equal(decision.continuation.intent,value.pending.intent);assert.equal(decision.continuation.recoveryEpisode,true);
});

test('the production continuation owner resolves live dependencies lazily and claims a healthy terminal column change once',async()=>{
 const value=terminalFixture();let current=value.settledRead,calls=0,reads=0,resolutions=0,rendered=0;
 const state={accountContinuation:value.pending,homeReadJob:null,pendingResponsiveHomeRead:null,transport:owner};value.pending.running=false;
 const controller=createAccountContinuationOwner(()=>{resolutions++;return {state,captureRouteRead:()=>current,routeReadIsCurrent:other=>sameRouteRead(other,current),homeSectionReads:{},render:()=>{rendered++;},async syncRouteDataAndLiveChannels(){reads++;current=value.read;return value.result;},queueResponsiveHomeSectionPageSizes(){assert.fail('columns-only must not schedule data read');},issueDiagnostics:{resolve(){}},account:{canPlay:()=>true},getGameResult(){},rematchDialog:{},appEl:{querySelector:()=>({click(){calls++;}})},CSS:{escape:value=>value},window:{location:{hash:'#/'}}};});
 assert.equal(resolutions,0,'construction must not touch later dialog/account dependencies');
 await controller.retry();assert.equal(calls,1);assert.equal(reads,1);assert.equal(state.accountContinuation,null);assert.ok(rendered>=2);
 await controller.retry();assert.equal(calls,1,'the exact original action cannot be replayed twice');
});
