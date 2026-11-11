import test from 'node:test';
import assert from 'node:assert/strict';
import {groupUndoHistory, renderUndoHistoryGroups, noteUndoHistorySelection, observeUndoHistoryDisclosure, toggleUndoHistoryGroup, finishUndoHistoryRequesterReturn} from '../shell/history-undo-groups.js';
const item=(id,index,seq,extra={})=>({moveId:id,index,turnIndex:Math.floor(index/2),turnMoveIndex:index%2,undone:true,...(seq===undefined?{}:{undoEventSeq:seq}),...extra});
const escape=String;
test('one contiguous accepted run spans operations without duplicate records or timestamp grouping',()=>{
 const moves=[item('one',1,10,{undoneAt:'same'}),item('two',2,11,{undoneAt:'same'}),item('three',3,10,{undoneAt:'same'}),item('four',4,10)],old=structuredClone(moves);
 const groups=groupUndoHistory('g',moves,[{id:'one',eventSeq:1,ordinal:0,move:item('one',1,10)},{id:'four',eventSeq:4,ordinal:0,move:item('four',4,10)}]);
 assert.equal(groups.length,1);assert.equal(groups[0].eventSeq,null);assert.deepEqual(groups[0].eventSeqs,[10,11]);
 assert.deepEqual(groups[0].records.map(record=>record.move.moveId),['four','three','two','one']);assert.deepEqual(moves,old);
 const html=renderUndoHistoryGroups('g',groups,move=>`<li>${move.moveId}</li>`,new Set(),escape);
 assert.equal((html.match(/data-undo-boundary="accepted"/g)??[]).length,1);assert.equal((html.match(/aria-expanded="false"/g)??[]).length,1);assert.doesNotMatch(html,/<li>one/);
 const expanded=renderUndoHistoryGroups('g',groups,move=>`<li>${move.moveId}</li>`,new Set(['g:undo-run:accepted:four']),escape);
 assert(expanded.indexOf('<li>four</li>')<expanded.indexOf('<li>three</li>'));assert(expanded.indexOf('<li>two</li>')<expanded.indexOf('<li>one</li>'));
});
test('pending prediction, unknown legacy provenance and accepted sequence never share a boundary',()=>{
 const groups=groupUndoHistory('g',[item('known',0,5),item('legacy',1,undefined,{undoneAt:'same'}),item('pending',2,undefined,{pendingUndoRequestId:'r'}),item('bad',3,-1),item('string',4,'5')]);
 assert.deepEqual(groups.map(g=>g.kind),['unavailable','pending','unavailable','accepted']);assert.deepEqual(groups.filter(g=>g.kind==='unavailable').flatMap(g=>g.records.map(r=>r.move.moveId)),['string','bad','legacy']);
 const html=renderUndoHistoryGroups('g',groups,()=>'',new Set(),escape);assert.match(html,/Original Undo boundary unavailable/);assert.match(html,/Undo pending/);assert.equal((html.match(/data-undo-event-seq=/g)??[]).length,1);
 assert.deepEqual(groupUndoHistory('g',[],[{id:'uncertain',historyStatus:'unknown',move:item('uncertain',0,5)}]),[]);
});
test('the latest accepted archive-only restoration remains visible without fabricating members',()=>{
 const groups=groupUndoHistory('g',[],[],{decisionId:'archived',undoEventSeq:7,at:'same'});assert.equal(groups.length,1);assert.deepEqual(groups[0].records,[]);
 const html=renderUndoHistoryGroups('g',groups,()=>{throw Error('No fabricated record');},new Set(['g:undo:accepted:7']),escape);assert.match(html,/Undo applied · Earlier history/);assert.match(html,/not in the loaded history/);
 for(const seq of [0,-1,1.5,'7',NaN,Infinity])assert.deepEqual(groupUndoHistory('g',[],[],{decisionId:'a',undoEventSeq:seq}),[]);
});
test('authoritative live membership wins over stale archived copies and other games use different keys',()=>{
 const archived=[{id:'a',move:item('a',1,8)}];assert.deepEqual(groupUndoHistory('g',[{moveId:'a',undone:false}],archived),[]);
 assert.notEqual(groupUndoHistory('one',[item('a',0,8)])[0].key,groupUndoHistory('two',[item('a',0,8)])[0].key);
});

test('display order uses recorded turn chronology when bounded live indexes have restarted',()=>{
 const live={...item('live',0,20),turnIndex:8,turnMoveIndex:1},evicted={...item('evicted',199,20),turnIndex:7,turnMoveIndex:3};
 assert.deepEqual(groupUndoHistory('g',[live],[{id:'evicted',eventSeq:1,ordinal:0,move:evicted}],null,{archiveComplete:true})[0].records.map(r=>r.move.moveId),['live','evicted']);assert.equal(evicted.index,199);assert.equal(live.index,0);
});

test('conflicting accepted membership for the same immutable move becomes unavailable rather than choosing a winner',()=>{
 for(const [first,second]of [[10,11],[11,10]]){
  const live=item('same',0,first),archive=item('same',0,second),original=structuredClone([live,archive]);
  const groups=groupUndoHistory('g',[live],[{id:'same',move:archive}]);assert.equal(groups.length,1);assert.equal(groups[0].kind,'unavailable');assert.equal(groups[0].eventSeq,null);assert.deepEqual([live,archive],original);
 }
});

test('combined live/archive grouping folds the actual known closure and omits orphan closures without changing records',()=>{
 const action={...item('action',3,8),turnIndex:1,turnMoveIndex:0,action:{type:'move'},snapshot:{pieces:[],label:'before'},destroyedPieces:[]};
 const closure={...item('closure',4,8),turnIndex:1,turnMoveIndex:1,action:{type:'end_turn'},snapshot:{pieces:[],label:'final'},destroyedPieces:[{eventId:'end:piece',pieceId:'lost'}]};
 const orphan={...item('orphan',5,8),turnIndex:99,turnMoveIndex:3,action:{type:'end_turn'}};const original=structuredClone([action,closure,orphan]);
 const groups=groupUndoHistory('g',[closure],[{id:'action',eventSeq:1,ordinal:0,move:action},{id:'orphan',eventSeq:0,ordinal:0,move:orphan}],null,{archiveComplete:true});assert.equal(groups.length,1);assert.equal(groups[0].records.length,1);assert.equal(groups[0].records[0].move.moveId,'action');assert.equal(groups[0].records[0].entry.id,'action');assert.equal(groups[0].records[0].move.snapshot.label,'final');assert.equal(groups[0].records[0].move.destroyedPieces[0].pieceId,'lost');assert.deepEqual([action,closure,orphan],original);
});

test('a selected record becoming undone reveals only its operation once and honors explicit collapse',()=>{
 const expanded=new Set(),owner={getIdentityId:()=> 'viewer'},selected={id:'g',inHistoryMode:true,historyIndex:1,moves:[{moveId:'selected',index:1}]};
 assert.equal(observeUndoHistoryDisclosure(expanded,selected,[],owner),false);
 const records=[item('selected',1,8),{moveId:'retained',index:2,turnIndex:1,undone:false},item('other',3,9)],groups=groupUndoHistory('g',records),view={...selected,moves:records};
 assert.equal(observeUndoHistoryDisclosure(expanded,view,groups,owner),true);assert.deepEqual([...expanded],['g:undo-run:accepted:selected']);
 expanded.delete('g:undo-run:accepted:selected');assert.equal(observeUndoHistoryDisclosure(expanded,view,groups,owner),false);assert.equal(expanded.size,0,'Passive renders must not undo a deliberate collapse');
 noteUndoHistorySelection(expanded,'g','selected',owner);assert.equal(observeUndoHistoryDisclosure(expanded,view,groups,owner),true);assert(expanded.has('g:undo-run:accepted:selected'));assert(!expanded.has('g:undo-run:accepted:other'));
});
test('other viewers, later transport/identity scopes and pending explicit selections cannot reopen the old selection',()=>{
 const a=new Set(),b=new Set(),owner={getIdentityId:()=> 'one'},groups=groupUndoHistory('g',[item('selected',1,8),{moveId:'retained',index:2,turnIndex:1,undone:false},item('second',3,9)]),first={id:'g',inHistoryMode:true,inspectedDecision:{moveId:'selected'}};
 observeUndoHistoryDisclosure(a,first,groups,owner);assert(a.has('g:undo-run:accepted:selected'));observeUndoHistoryDisclosure(b,{...first,inHistoryMode:false},groups,owner);assert.equal(b.size,0);
 a.clear();noteUndoHistorySelection(a,'g','second',owner);assert.equal(observeUndoHistoryDisclosure(a,first,groups,owner),false,'Pending selection of another record must not reopen the old one');
 assert.equal(observeUndoHistoryDisclosure(a,{...first,inspectedDecision:{moveId:'second'}},groups,owner),true);assert.deepEqual([...a],['g:undo-run:accepted:second']);
 observeUndoHistoryDisclosure(a,{...first,inHistoryMode:false},groups,{getIdentityId:()=> 'two'});assert.equal(a.size,0,"A new owner cannot inherit the other viewer’s disclosure state");
});

test('an explicit projected conflict survives deduplication even when its numeric claim was removed',()=>{
 for(const reverse of [false,true]){
  const known=item('same',1,8),conflict=item('same',1,undefined,{undoBoundaryStatus:'conflict'});
  const groups=reverse?groupUndoHistory('g',[conflict],[{id:'same',move:known}]):groupUndoHistory('g',[known],[{id:'same',move:conflict}]);
  assert.equal(groups.length,1);assert.equal(groups[0].kind,'unavailable');assert.equal(groups[0].eventSeq,null);
 }
});
test('same selected stale views stay retired across transport and same-object identity replacement',()=>{
 for(const replace of ['transport','identity']){
  const expanded=new Set(),groups=groupUndoHistory('g',[item('selected',1,8)]),view={id:'g',inHistoryMode:true,inspectedDecision:{moveId:'selected'}};let identity='one',owner={getIdentityId:()=>identity};
  assert.equal(observeUndoHistoryDisclosure(expanded,view,groups,owner),true);
  if(replace==='transport')owner={getIdentityId:()=> 'two'};else identity='two';
  assert.equal(observeUndoHistoryDisclosure(expanded,view,groups,owner),false);assert.equal(expanded.size,0);assert.equal(observeUndoHistoryDisclosure(expanded,view,groups,owner),false);assert.equal(expanded.size,0);
  noteUndoHistorySelection(expanded,'g','selected',owner);assert.equal(observeUndoHistoryDisclosure(expanded,view,groups,owner),true);assert(expanded.has('g:undo-run:accepted:selected'));
 }
});
test('a native explicit selection arriving before the first new-owner render is owned by that new scope',()=>{
 const expanded=new Set(),groups=groupUndoHistory('g',[item('selected',1,8)]),view={id:'g',inHistoryMode:true,inspectedDecision:{moveId:'selected'}},first={getIdentityId:()=> 'one'},next={getIdentityId:()=> 'two'};
 observeUndoHistoryDisclosure(expanded,view,groups,first);noteUndoHistorySelection(expanded,'g','selected',next);assert.equal(observeUndoHistoryDisclosure(expanded,view,groups,next),true);assert(expanded.has('g:undo-run:accepted:selected'));
 assert.throws(()=>noteUndoHistorySelection(expanded,'g','selected'),/owner required/);
});

test('requester return-live retires only the new automatic reveal, preserving older groups',()=>{
 const expanded=new Set(['g:undo:accepted:7']),owner={getIdentityId:()=> 'viewer'},groups=groupUndoHistory('g',[item('selected',1,8)]),view={id:'g',inHistoryMode:true,inspectedDecision:{moveId:'selected'}};
 observeUndoHistoryDisclosure(expanded,view,groups,owner);assert.deepEqual([...expanded],['g:undo:accepted:7','g:undo-run:accepted:selected']);
 assert.equal(finishUndoHistoryRequesterReturn(expanded,'g',8,owner),true);assert.deepEqual([...expanded],['g:undo:accepted:7']);
 assert.equal(observeUndoHistoryDisclosure(expanded,{...view,inHistoryMode:false},groups,owner),false);assert.deepEqual([...expanded],['g:undo:accepted:7']);
 for(const seq of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1])assert.equal(finishUndoHistoryRequesterReturn(expanded,'g',seq,owner),false);
});
test('explicit native group choices survive requester return-live, including deliberate collapse',()=>{
 for(const reopen of [false,true]){
  const expanded=new Set(),owner={getIdentityId:()=> 'viewer'},groups=groupUndoHistory('g',[item('selected',1,8)]),view={id:'g',inHistoryMode:true,inspectedDecision:{moveId:'selected'}};
  observeUndoHistoryDisclosure(expanded,view,groups,owner);toggleUndoHistoryGroup(expanded,'g:undo-run:accepted:selected',owner);
  if(reopen)toggleUndoHistoryGroup(expanded,'g:undo-run:accepted:selected',owner);
  assert.equal(finishUndoHistoryRequesterReturn(expanded,'g',8,owner),false);assert.equal(expanded.has('g:undo-run:accepted:selected'),reopen);
 }
});
test('a separate inspector retains its selected undone operation when the requester returns live',()=>{
 const requester=new Set(),inspector=new Set(),owner={getIdentityId:()=> 'viewer'},groups=groupUndoHistory('g',[item('selected',1,8)]),view={id:'g',inHistoryMode:true,inspectedDecision:{moveId:'selected'}};
 observeUndoHistoryDisclosure(requester,view,groups,owner);observeUndoHistoryDisclosure(inspector,view,groups,owner);
 finishUndoHistoryRequesterReturn(requester,'g',8,owner);assert.equal(requester.size,0);assert.deepEqual([...inspector],['g:undo-run:accepted:selected']);
});
