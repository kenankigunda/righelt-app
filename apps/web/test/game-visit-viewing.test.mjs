import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameVisitViewingOwner} from '../shell/game-visit-viewing.js';

function fixture(){
 const state={scope:'account-a',route:{name:'game',gameId:'g'},generation:0,ready:true,authoritative:null,selection:'move-1',calls:[]};
 const transport=()=>{
  const tokens=new WeakMap();
  return {
   captureHistoryView(){const token={};tokens.set(token,state.selection);return token;},
   restoreHistoryView({checkpoint}){if(!tokens.has(checkpoint))return false;state.selection=tokens.get(checkpoint);state.calls.push('restore');return true;},
   getAuthoritativeGame(){return state.authoritative;},
   returnToLive(){state.selection='live';state.calls.push('live');},
  };
 };
 state.transport=transport();
 const owner=createGameVisitViewingOwner(()=>({getTransport:()=>state.transport,getScope:()=>state.scope,getRoute:()=>state.route,getViewGeneration:()=>state.generation,isReady:()=>state.ready,advanceView:()=>{state.generation++;},restorePersonalHistory:()=>state.calls.push('personal')}));
 return {state,owner,transport};
}
const ongoing={id:'g',board:{state:{outcome:{status:'ongoing'}}}};

test('explicit ongoing Home entry waits for authority, survives same-game utility entry and returns live once',()=>{
 const {state,owner}=fixture();
 owner.arrive(state.route,{fromHome:true});
 assert.equal(owner.sync(),false);assert.equal(state.selection,'move-1');
 owner.arrive({...state.route,utility:'debug'});
 state.authoritative=ongoing;state.ready=false;
 assert.equal(owner.sync(),false);
 state.ready=true;assert.equal(owner.sync(),true);assert.equal(owner.sync(),false);
 assert.equal(state.selection,'live');assert.deepEqual(state.calls,['live']);assert.equal(state.generation,1);
});

test('completed Home entry leaves decisive review to its existing owner and utility navigation preserves inspection',()=>{
 const {state,owner}=fixture();state.authoritative={...ongoing,board:{state:{outcome:{status:'p1_win'}}}};
 owner.arrive(state.route,{fromHome:true});assert.equal(owner.sync(),false);
 state.authoritative=ongoing;owner.arrive(state.route);assert.equal(owner.sync(),false);
 assert.equal(state.selection,'move-1');assert.deepEqual(state.calls,[]);
});

test('each browser visit restores its own opaque selection after a new Home entry returns live',()=>{
 const {state,owner}=fixture();state.authoritative=ongoing;
 const older=owner.capture('old',state.route);
 assert.deepEqual(JSON.parse(JSON.stringify(older)),{visitId:'old',gameId:'g'});
 owner.arrive({name:'home'});owner.arrive(state.route,{fromHome:true});owner.sync();
 const newer=owner.capture('new',state.route);
 owner.arrive(state.route,{traversed:true,restore:older});assert.equal(state.selection,'move-1');
 assert.equal(owner.consumeRestored({id:'g',inHistoryMode:true,historyLoading:true}),false);
 assert.equal(owner.consumeRestored({id:'g',inHistoryMode:true}),true);
 assert.equal(owner.consumeRestored({id:'g',inHistoryMode:true}),false);
 owner.arrive(state.route,{traversed:true,restore:newer});assert.equal(state.selection,'live');
 assert.equal(owner.consumeRestored({id:'g',inHistoryMode:false}),false);
});

for(const boundary of ['account','transport','game','unknown visit'])test(`traversal refuses checkpoint across ${boundary}`,()=>{
 const {state,owner,transport}=fixture();const restore=owner.capture('old',state.route);state.selection='live';
 if(boundary==='account')state.scope='account-b';
 if(boundary==='transport')state.transport=transport();
 if(boundary==='game')state.route={name:'game',gameId:'other'};
 if(boundary==='unknown visit')restore.visitId='missing';
 owner.arrive(state.route,{traversed:true,restore});assert.equal(state.selection,'live');assert.deepEqual(state.calls,[]);
});

for(const boundary of ['account','transport','generation','route'])test(`late Home authority cannot override newer ${boundary} intent`,()=>{
 const {state,owner,transport}=fixture();owner.arrive(state.route,{fromHome:true});
 if(boundary==='account')state.scope='account-b';
 if(boundary==='transport')state.transport=transport();
 if(boundary==='generation')state.generation++;
 if(boundary==='route')state.route={name:'home'};
 state.authoritative=ongoing;assert.equal(owner.sync(),false);assert.equal(state.selection,'move-1');assert.deepEqual(state.calls,[]);
});

test('traversal retires an outstanding Undo before synchronous transport restoration can return live',async()=>{
 const {createViewingIntent}=await import('../shell/viewing-state.js');
 const viewing=createViewingIntent(),game={id:'g',gameplayRevision:2,moves:[{moveId:'undone',undone:true}]};
 const token=viewing.beginUndo('g',{targetMoveId:'undone',revision:1,scope:'account'});viewing.commitUndo('g',token);
 let staleUndoReturnedLive=false;
 const checkpoint={},transport={captureHistoryView:()=>checkpoint,restoreHistoryView:()=>{staleUndoReturnedLive=viewing.observeUndo('g',game,'account');return true;}};
 const owner=createGameVisitViewingOwner(()=>({getTransport:()=>transport,getScope:()=> 'account',getRoute:()=>({name:'game',gameId:'g'}),getViewGeneration:viewing.generation,advanceView:id=>viewing.navigate(id)}));
 const restore=owner.capture('old',{name:'game',gameId:'g'});
 owner.arrive({name:'game',gameId:'g'},{traversed:true,restore});
 assert.equal(staleUndoReturnedLive,false,'restoration event must see a new viewing generation');
 assert.equal(viewing.generation('g'),1);
});
