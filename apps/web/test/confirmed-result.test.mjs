import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfirmedResultOwner,confirmedResultKey,resumeAfterDialogFocusRestore} from '../shell/confirmed-result.js';

const game=(status='ongoing',revision=1,extra={})=>({id:'g',gameplayRevision:revision,board:{state:{outcome:{status,reason:status==='ongoing'?null:'p2_commander_unsupplied'}}},...extra});

test('only an observed authoritative ongoing-to-terminal transition becomes eligible',()=>{
 const owner=createConfirmedResultOwner();
 assert.equal(owner.observe(game('p1_win')).becameTerminal,false,'cold completed hydration is quiet');
 assert.deepEqual(owner.evaluate('g',{current:true}),{present:false,allowReview:true,notice:false});
 owner.clear();owner.observe(game());
 assert.equal(owner.observe(game('p1_win',2)).becameTerminal,true);
 assert.deepEqual(owner.evaluate('g',{current:true}),{present:true,allowReview:false,notice:false});
 assert.deepEqual(owner.evaluate('g',{current:true}),{present:false,allowReview:true,notice:false},'ordinary redraw does not reopen');
});

test('pending confirmation survives route, background and dialog deferral without being consumed',()=>{
 const owner=createConfirmedResultOwner();owner.observe(game());owner.observe(game('p1_win',2));
 for(const options of [{current:false},{current:true,visible:false},{current:true,dialogOpen:true}])
  assert.deepEqual(owner.evaluate('g',options),{present:false,allowReview:false,notice:false});
 assert.equal(owner.evaluate('g',{current:true,visible:true,dialogOpen:false}).present,true);
});

test('deliberate History turns a pending result into dismissible manual entry',()=>{
 const owner=createConfirmedResultOwner();owner.observe(game());owner.deliberateHistory('g');owner.observe(game('p1_win',2));
 assert.deepEqual(owner.evaluate('g',{current:true,inHistory:true}),{present:false,allowReview:false,notice:true});
 owner.dismissNotice('g');assert.equal(owner.evaluate('g',{current:true,inHistory:true}).notice,false);
 assert.equal(owner.present('g'),true);assert.equal(owner.evaluate('g',{current:true}).allowReview,true);
});

test('a failed History selection releases its intent without consuming the pending result',()=>{
 const owner=createConfirmedResultOwner();owner.observe(game());const intent=owner.deliberateHistory('g');owner.observe(game('p1_win',2));
 assert.equal(owner.evaluate('g',{current:true,inHistory:true}).notice,true);
 assert.equal(owner.abandonHistory(intent),true);
 assert.equal(owner.evaluate('g',{current:true}).present,true);
});

test('an older failed History selection cannot abandon a newer selection around terminal delivery',()=>{
 const owner=createConfirmedResultOwner();owner.observe(game());const older=owner.deliberateHistory('g'),newer=owner.deliberateHistory('g');
 owner.observe(game('p1_win',2));assert.equal(owner.evaluate('g',{current:true,inHistory:true}).notice,true);
 assert.equal(owner.abandonHistory(older),false);assert.equal(owner.evaluate('g',{current:true,inHistory:true}).notice,true);
 assert.equal(owner.abandonHistory(newer),true);assert.equal(owner.evaluate('g',{current:true}).present,true);
});

test('dialog result resume waits until native trigger-focus restoration has completed',()=>{
 const order=[];let resume;
 resumeAfterDialogFocusRestore(()=>order.push('result-focus'),callback=>{resume=callback;});
 order.push('trigger-focus');assert.deepEqual(order,['trigger-focus']);resume();assert.deepEqual(order,['trigger-focus','result-focus']);
});

test('undo retires stale ownership and a genuine later finish is independently eligible',()=>{
 const owner=createConfirmedResultOwner();owner.observe(game());owner.observe(game('p1_win',2));owner.evaluate('g',{current:true});
 owner.observe(game('ongoing',3));assert.deepEqual(owner.evaluate('g',{current:true}),{present:false,allowReview:false,notice:false});
 assert.equal(owner.observe(game('p2_win',4)).becameTerminal,true);assert.equal(owner.evaluate('g',{current:true}).present,true);
});

test('duplicates, presence-only revisions and later provenance do not recreate a result',()=>{
 const owner=createConfirmedResultOwner();owner.observe(game());const terminal=game('p1_win',2);
 owner.observe(terminal);owner.evaluate('g',{current:true});
 owner.observe({...terminal,presenceRevision:99});
 owner.observe({...terminal,terminalOutcome:{commit:{eventSeq:7,gameplayRevision:2,clientCommandId:'v2:final'}}});
 assert.equal(owner.evaluate('g',{current:true}).present,false);
 assert.match(confirmedResultKey({...terminal,terminalOutcome:{commit:{eventSeq:7,gameplayRevision:2,clientCommandId:'v2:final'}}}),/^commit:7:2:v2:final$/);
});

test('a later authoritative completion commit is eligible even when disconnected delivery skips the intervening undo',()=>{
 const owner=createConfirmedResultOwner(),withCommit=(status,eventSeq,revision)=>game(status,revision,{terminalOutcome:{commit:{eventSeq,gameplayRevision:revision,clientCommandId:`v2:${eventSeq}`}}});
 owner.observe(game());owner.observe(withCommit('p1_win',7,2));owner.evaluate('g',{current:true});
 assert.equal(owner.observe(withCommit('p2_win',12,5)).becameTerminal,true);
 assert.equal(owner.evaluate('g',{current:true}).present,true);
});

test('clearing the page/account scope retires late eligibility',()=>{
 const owner=createConfirmedResultOwner();owner.observe(game());owner.observe(game('draw',2));owner.clear();
 assert.deepEqual(owner.evaluate('g',{current:true}),{present:false,allowReview:false,notice:false});
});
