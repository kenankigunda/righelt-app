import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountContinuationOwner} from '../shell/account-continuation-owner.js';
import {createHomeReadReplacement,resultForHomeContinuation,createHomeSectionReads,createHomeSectionState,sameRouteRead} from '../shell/home-section-reads.js';

const owner={};
const read=(columns=1)=>({generation:7,epoch:3,owner,hash:'#/',routeKey:'home',route:{name:'home'},homeVisit:4,homeDebug:false,
 inputs:JSON.stringify([4,false,['my','completed','other'].map(key=>[key,0,columns===1?3:4,columns])])});
const pending=source=>({...source,intent:{hash:'#/',action:'create-self-play'},running:true,recoveryEpisode:false});

test('the actual Home controller borrows its exact already-settled job without issuing a third batch',async()=>{
 const current=read(2),before=read();
 const requests=[];let batches=0,borrowed,token,callbackPending;
 const transport={getHomeListRevision:()=>1,createHomeRead:()=>{batches++;return {readPage:async options=>{requests.push(options.section);return{page:0,totalGames:1,totalPages:1,homeListRevision:1,games:[{id:options.section+'-current'}]};},getHomeListRevision:()=>1,commit(){},retire(){}};}};
 current.owner=transport;before.owner=transport;
 const old=pending(before),job={read:before};
 const replacement=createHomeReadReplacement({job,activeJob:job,read:current,pending:old});
 const state={currentRoute:{name:'home'},homeReadVisit:4,homeReadJob:null,pendingResponsiveHomeRead:replacement,homeReadRecovery:null,accountContinuation:replacement.continuation,
  homeSections:Object.fromEntries(['my','completed','other'].map(key=>[key,createHomeSectionState(key)]))};
 const controller=createHomeSectionReads({state,
  getHomeSection:key=>state.homeSections[key],setHomeSection:(key,value)=>{state.homeSections={...state.homeSections,[key]:value};},
  getVisibleHomeSectionKeys:()=>['my','completed','other'],getHomeSectionVisiblePageSize:()=>4,getHomeSectionColumnCount:()=>2,
  captureRouteRead:()=>current,routeReadIsCurrent:value=>sameRouteRead(value,current),assertCurrentRouteRead:value=>assert.equal(sameRouteRead(value,current),true),
  pendingHomeSectionKeys:new Set(),window:{},document:{},appEl:{},gameSound:{},storyDialog:{refresh(){}},
  resumeAccountContinuation:async(pending,value)=>{callbackPending=pending;token=value;borrowed=controller.takeContinuationSettlement(pending,value);},
 });
 await controller.syncSections(current);
 assert.equal(state.pendingResponsiveHomeRead.fulfilledByNewer,true);
 await controller.refreshResponsive();
 assert.equal(callbackPending,state.accountContinuation);assert.equal(borrowed.outcome,'fulfilled');assert.equal(resultForHomeContinuation(borrowed).healthySettled,true);
 assert.equal(controller.takeContinuationSettlement(callbackPending,token),null,'a settled result can be consumed only once');
 assert.deepEqual(requests,['my','completed','other']);assert.equal(batches,1,'the existing full read is borrowed, not repeated');
});



test('a read begun before the continuation cannot lend a partial result as successful admission',async()=>{
 const current=read(2),before=read(),failure=Object.assign(new Error('completed unavailable'),{code:'temporary_unavailable',status:503});
 let batches=0,record,reported,grants=0;const requests=[];
 const transport={getHomeListRevision:()=>1,createHomeRead:()=>{batches++;return {
  async readPage(options){requests.push(options.section);if(options.section==='completed')throw failure;return{page:0,totalGames:1,totalPages:1,homeListRevision:1,games:[{id:options.section+'-current'}]};},
  getHomeListRevision:()=>1,commit(){},retire(){},
 };}};
 current.owner=transport;before.owner=transport;
 const original=pending(before),job={read:before};
 const replacement=createHomeReadReplacement({job,activeJob:job,read:current,pending:original});
 const state={currentRoute:{name:'home'},homeReadVisit:4,homeReadJob:null,pendingResponsiveHomeRead:replacement,homeReadRecovery:null,accountContinuation:null,
  homeSections:Object.fromEntries(['my','completed','other'].map(key=>[key,createHomeSectionState(key)]))};
 const controller=createHomeSectionReads({state,
  getHomeSection:key=>state.homeSections[key],setHomeSection:(key,value)=>{state.homeSections={...state.homeSections,[key]:value};},
  getVisibleHomeSectionKeys:()=>['my','completed','other'],getHomeSectionVisiblePageSize:()=>4,getHomeSectionColumnCount:()=>2,
  captureRouteRead:()=>current,routeReadIsCurrent:value=>sameRouteRead(value,current),assertCurrentRouteRead:value=>assert.equal(sameRouteRead(value,current),true),
  pendingHomeSectionKeys:new Set(),window:{},document:{},appEl:{},gameSound:{},storyDialog:{refresh(){}},render(){},
  setTimeout:callback=>{queueMicrotask(callback);return 1;},clearTimeout(){},
  resumeAccountContinuation:async(pending,token)=>{record=controller.takeContinuationSettlement(pending,token);try{resultForHomeContinuation(record);grants++;}catch(error){reported=error;pending.recoveryEpisode=true;pending.running=false;}},
 });
 const result=await controller.syncSections(current);
 assert.equal(result.healthySettled,false,'the real reader published only its healthy sections');
 assert.equal(state.homeSections.completed.error,true);
 // The account continuation becomes bound only after this preexisting job settled.
 state.accountContinuation=replacement.continuation;
 state.accountContinuation.inputs=current.inputs;
 await controller.refreshResponsive();
 assert.equal(record.outcome,'fulfilled');assert.equal(record.result.healthySettled,false);
 assert.equal(reported,failure);assert.equal(grants,0);assert.equal(state.accountContinuation.recoveryEpisode,true);assert.equal(state.accountContinuation.running,false);
 assert.equal(batches,2);assert.deepEqual(requests,['my','completed','other','my','completed','other'],'borrowing the failed admission cannot create a third batch');
});


const terminalControllerFixture=({requiresRead=false,recovery=false}={})=>{
 let current=read(),batches=0,actions=0,renderedAfterRead=0,first=true;const requests=[],frames=new Map();let frameId=0;
 const transport={getHomeListRevision:()=>1,createHomeRead:()=>{batches++;return {async readPage({section}){requests.push(section);return{page:0,totalGames:1,totalPages:1,homeListRevision:1,games:[{id:section+'-current'}]};},getHomeListRevision:()=>1,commit(){},retire(){}};}};
 current.owner=transport;const initial=current,after={...current};const tuples=JSON.parse(after.inputs);for(const tuple of tuples[2]){tuple[3]=5;if(requiresRead)tuple[2]=4;}after.inputs=JSON.stringify(tuples);
 const original=pending(initial);original.running=false;original.recoveryEpisode=recovery;
 const state={transport,currentRoute:{name:'home'},homeReadVisit:4,accountContinuation:original,homeReadJob:null,pendingResponsiveHomeRead:null,homeReadRecovery:null,homeReadChoice:null,routeHydrated:false,homeSectionResizeFrame:0,homeSections:Object.fromEntries(['my','completed','other'].map(key=>[key,createHomeSectionState(key)]))};
 let continuation;const capture=()=>{continuation.observeRead(current);return current;};const isCurrent=value=>sameRouteRead(value,capture());
 const browser={location:{hash:'#/'},cancelAnimationFrame:id=>frames.delete(id),requestAnimationFrame:callback=>{frames.set(++frameId,callback);return frameId;}};
 const controller=createHomeSectionReads({state,getHomeSection:key=>state.homeSections[key],setHomeSection:(key,value)=>{state.homeSections={...state.homeSections,[key]:value};},getVisibleHomeSectionKeys:()=>['my','completed','other'],getHomeSectionVisiblePageSize:()=>JSON.parse(current.inputs)[2][0][2],getHomeSectionColumnCount:()=>JSON.parse(current.inputs)[2][0][3],captureRouteRead:capture,routeReadIsCurrent:isCurrent,assertCurrentRouteRead:value=>assert.ok(isCurrent(value)),pendingHomeSectionKeys:new Set(),window:browser,document:{},appEl:{},gameSound:{},storyDialog:{refresh(){}},render(){},resumeAccountContinuation:(expectedPending,settlement)=>continuation.retry({expectedPending,settlement})});
 continuation=createAccountContinuationOwner(()=>({state,homeSectionReads:controller,captureRouteRead:capture,routeReadIsCurrent:isCurrent,render(){},async syncRouteDataAndLiveChannels(value){const result=await controller.syncSections(value);if(first){first=false;assert.equal(state.homeReadJob,null,'the actual transaction has retired before the external route render');current=after;renderedAfterRead++;state.routeHydrated=true;}return result;},queueResponsiveHomeSectionPageSizes:controller.queueResponsive,issueDiagnostics:{resolve(){}},account:{canPlay:()=>true},getGameResult(){},rematchDialog:{},appEl:{querySelector:()=>({click(){actions++;}})},CSS:{escape:value=>value},window:browser}));
 return {continuation,controller,state,original,requests,frames,batches:()=>batches,actions:()=>actions,renderedAfterRead:()=>renderedAfterRead,async flushFrame(){assert.equal(frames.size,1);const work=[...frames.values()];frames.clear();for(const callback of work)await callback();}};
};
test('actual Home and continuation owners reuse the healthy data window after a terminal columns-only render',async()=>{
 const f=terminalControllerFixture();await f.continuation.retry();
 assert.equal(f.renderedAfterRead(),1);assert.equal(f.batches(),1);assert.equal(f.actions(),1);assert.equal(f.state.accountContinuation,null);assert.equal(f.frames.size,0);assert.deepEqual(f.requests,['my','completed','other']);
 assert.equal(f.original.running,true,'the original owner is not mutated into its successor');await f.continuation.retry();assert.equal(f.actions(),1);
});
test('actual owners defer a terminal visible-page-size change to one real responsive transaction',async()=>{
 const f=terminalControllerFixture({requiresRead:true});await f.continuation.retry();
 assert.equal(f.renderedAfterRead(),1);assert.equal(f.actions(),0,'the smaller completed data window cannot grant the original action');assert.equal(f.batches(),1);assert.equal(f.state.accountContinuation.running,false);assert.notEqual(f.state.accountContinuation,f.original);assert.equal(f.state.accountContinuation.intent,f.original.intent);
 await f.flushFrame();assert.equal(f.batches(),2);assert.equal(f.actions(),1);assert.equal(f.state.accountContinuation,null);assert.deepEqual(f.requests,['my','completed','other','my','completed','other']);await f.continuation.retry();assert.equal(f.actions(),1);
});
test('terminal data-window reuse preserves an earlier recovery as an explicit choice without an automatic action',async()=>{
 const f=terminalControllerFixture({recovery:true});await f.continuation.retry();assert.equal(f.batches(),1);assert.equal(f.actions(),0);assert.equal(f.state.accountContinuation,null);assert.equal(f.state.homeReadChoice.action,'create-self-play');assert.equal(f.state.homeReadChoice.read.recoveryEpisode,true);
});
