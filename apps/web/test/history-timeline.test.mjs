import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHistoryTimeline} from '../shell/history-timeline.js';
import {groupUndoHistory,observeUndoHistoryDisclosure,toggleUndoHistoryGroup,noteUndoHistorySelection,finishUndoHistoryRequesterReturn} from '../shell/history-undo-groups.js';
const move=(id,index,undone=false,undoEventSeq=10)=>({moveId:id,index,turnIndex:Math.floor(index/2),turnMoveIndex:index%2,notation:id,action:{type:'rush'},at:'same',...(undone?{undone:true,undoEventSeq}:{})});
const timeline=(moves,entries=[],options={})=>buildHistoryTimeline('g',moves,entries,null,options);
const literal=result=>result.nodes.filter(node=>node.type!=='gap').map(node=>node.type==='undone'?node.records.map(record=>record.move.moveId):node.records.map(record=>record.move.moveId)).flatMap((members,index)=>result.nodes.filter(node=>node.type!=='gap')[index].type==='undone'?[members]:members);

test('confirmed original chronology merges contiguous undone runs across accepted operations and turns',()=>{
 const a=move('A',0),b=move('B',1),c=move('C',2,true),d=move('D',3,true);
 assert.deepEqual(literal(timeline([a,b,c,d])),[['D','C'],'B','A']);
 const e=move('E',2,true,11),f=move('F',2);
 assert.deepEqual(literal(timeline([a,b,c,d,e,f])),['F',['E','D','C'],'B','A']);
 const retainedE=move('E',2),undoneF=move('F',3,true,11);
 assert.deepEqual(literal(timeline([a,b,c,d,retainedE,undoneF])),[['F'],'E',['D','C'],'B','A']);
 const interleaved=[move('A',0,true,12),move('B',1,true,11),move('C',2,true,11),move('D',1,true,12),move('E',2,true,12)];
 const before=structuredClone(interleaved);
 assert.deepEqual(literal(timeline(interleaved)),[['E','D','C','B','A']]);
 assert.deepEqual(interleaved,before,'recorded IDs, indexes, original memberships and snapshots remain untouched');
 assert.deepEqual(groupUndoHistory('g',interleaved).map(group=>group.records.map(record=>record.move.moveId)),[['E','D','C','B','A']]);
});

test('original archive metadata and bounded live array order outrank rebased indexes and reused turn coordinates',()=>{
 const old=move('archived',199,true),recent=move('live',0,true),latest=move('latest',1);
 old.turnIndex=8;recent.turnIndex=1;
 const entries=[{id:'archived',eventSeq:100,ordinal:2,move:old}];
 assert.deepEqual(literal(timeline([recent,latest],entries,{archiveComplete:true})),['latest',['live','archived']]);
 assert.deepEqual(literal(timeline([recent,latest],entries)),['latest',['live'],['archived']]);
 assert.equal(timeline([recent,latest],entries).nodes.filter(node=>node.type==='gap').length,1,'a still-unloaded page is a real boundary');
 const first=move('first',150,true),second=move('second',0,true);
 assert.deepEqual(literal(timeline([],[{id:'second',eventSeq:2,ordinal:0,move:second},{id:'first',eventSeq:1,ordinal:8,move:first}])),[['second','first']]);
});

test('closures fold across a proven loaded boundary and duplicate live/archive rows never count twice',()=>{
 const action={...move('action',3,true),turnIndex:1,turnMoveIndex:0,snapshot:{final:false}};
 const closure={...move('closure',4,true),turnIndex:1,turnMoveIndex:1,action:{type:'end_turn'},snapshot:{final:true}};
 const orphan={...move('orphan',5,true),turnIndex:99,turnMoveIndex:9,action:{type:'end_turn'}};
 const entries=[{id:'action',eventSeq:1,ordinal:0,move:action}];
 const result=timeline([closure,orphan],entries,{archiveComplete:true});
 assert.deepEqual(literal(result),[['action']]);
 assert.deepEqual(result.groups[0].records[0].move.snapshot,{final:true});
 const duplicate=timeline([action,closure],[...entries,{id:'closure',eventSeq:2,ordinal:0,move:closure}],{archiveComplete:true});
 assert.deepEqual(literal(duplicate),[['action']]);
 assert.equal(duplicate.groups[0].records.length,1);
});

test('unknown chronology and conflicting provenance stay explicit and never become an accepted contiguous bridge',()=>{
 const a=move('a',0,true),c=move('c',2,true),b=move('b',1);
 const malformed=timeline([a,c],[{id:'b',move:b}]);
 assert.equal(malformed.nodes.find(node=>node.type==='gap').unknown,true);
 assert.equal(malformed.records.find(record=>record.move.moveId==='b').chronology,'unknown');
 const conflict=timeline([a],[{id:'a',eventSeq:1,ordinal:0,move:{...a,undoEventSeq:12}}]);
 assert.equal(conflict.groups[0].kind,'unavailable');
 const uncertain=timeline([],[{id:'u',eventSeq:1,ordinal:0,historyStatus:'unknown',move:move('u',0,true)}]);
 assert.equal(uncertain.groups.length,0);
 const collision=timeline([],[{id:'a',eventSeq:1,ordinal:0,move:a},{id:'c',eventSeq:1,ordinal:0,move:c}]);
 assert.equal(collision.groups.length,2);assert(collision.groups.every(group=>group.chronology==='unknown'));
});

test('empty accepted restoration keeps its truthful placeholder without inventing loaded members',()=>{
 const result=buildHistoryTimeline('g',[],[],{decisionId:'old',undoEventSeq:8});
 assert.equal(result.groups.length,1);assert.deepEqual(result.groups[0].records,[]);assert.equal(result.groups[0].key,'g:undo:accepted:8');
});

test('paging and accepted-run merges preserve native disclosure identity and deliberate collapse',()=>{
 const owner={getIdentityId:()=> 'viewer'},expanded=new Set(),view={id:'g',inHistoryMode:true,inspectedDecision:{moveId:'D'}};
 let groups=groupUndoHistory('g',[move('C',0,true),move('D',1,true)]);
 observeUndoHistoryDisclosure(expanded,view,groups,owner);const initial=groups[0].key;
 assert.equal(initial,'g:undo-run:accepted:D');assert(expanded.has(initial));
 toggleUndoHistoryGroup(expanded,initial,owner);
 groups=groupUndoHistory('g',[move('C',0,true),move('D',1,true),move('E',1,true,11)]);
 observeUndoHistoryDisclosure(expanded,view,groups,owner);
 assert.equal(groups[0].key,initial);assert.equal(expanded.has(initial),false,'new members do not undo deliberate native collapse');
 groups=groupUndoHistory('g',[move('C',0,true),move('D',1,true),move('E',1,true,11)],[{id:'B',eventSeq:1,ordinal:0,move:move('B',199,true)}],null,{archiveComplete:true});
 observeUndoHistoryDisclosure(expanded,view,groups,owner);
 assert.equal(groups[0].key,initial);assert.equal(expanded.size,0);
});

test('a focused older disclosure keeps its native key when two accepted display runs merge',()=>{
 const owner={getIdentityId:()=> 'viewer'},expanded=new Set(),view={id:'g',inHistoryMode:false};
 const old=[move('B',0,true),move('C',1),move('D',2,true,11)];
 let groups=groupUndoHistory('g',old);observeUndoHistoryDisclosure(expanded,view,groups,owner);
 const olderKey=groups[1].key,priorDocument=globalThis.document;
 try{
  globalThis.document={querySelector:()=>null,activeElement:{dataset:{groupKey:olderKey}}};
  toggleUndoHistoryGroup(expanded,olderKey,owner);
  groups=groupUndoHistory('g',[old[0],{...old[1],undone:true,undoEventSeq:12},old[2]]);
  observeUndoHistoryDisclosure(expanded,view,groups,owner);
  assert.equal(groups.length,1);assert.equal(groups[0].key,olderKey);assert(expanded.has(olderKey));
 }finally{globalThis.document=priorDocument;}
});


test('a new explicit selected member overrides an older run collapse once and stays revealed across passive renders',()=>{
 const owner={getIdentityId:()=> 'viewer'},expanded=new Set();
 const d=move('D',0,true),e=move('E',1);
 let groups=groupUndoHistory('g',[d,e]),view={id:'g',inHistoryMode:true,inspectedDecision:{moveId:'D'}};
 observeUndoHistoryDisclosure(expanded,view,groups,owner);const key=groups[0].key;
 toggleUndoHistoryGroup(expanded,key,owner);
 noteUndoHistorySelection(expanded,'g','E',owner);view={...view,inspectedDecision:{moveId:'E'}};
 observeUndoHistoryDisclosure(expanded,view,groups,owner);
 groups=groupUndoHistory('g',[d,{...e,undone:true,undoEventSeq:11}]);
 assert.equal(observeUndoHistoryDisclosure(expanded,view,groups,owner),true);assert(expanded.has(key));
 assert.equal(observeUndoHistoryDisclosure(expanded,view,groups,owner),false);assert(expanded.has(key));
 toggleUndoHistoryGroup(expanded,key,owner);observeUndoHistoryDisclosure(expanded,view,groups,owner);assert.equal(expanded.has(key),false);
});

test('requester return-live does not retire an automatic reveal inherited from an earlier operation',()=>{
 const owner={getIdentityId:()=> 'viewer'},expanded=new Set(),d=move('D',0,true);
 let groups=groupUndoHistory('g',[d]);const view={id:'g',inHistoryMode:true,inspectedDecision:{moveId:'D'}};
 observeUndoHistoryDisclosure(expanded,view,groups,owner);const key=groups[0].key;
 groups=groupUndoHistory('g',[d,move('E',1,true,11)]);observeUndoHistoryDisclosure(expanded,view,groups,owner);
 assert.equal(finishUndoHistoryRequesterReturn(expanded,'g',11,owner),false);assert(expanded.has(key));
 assert.equal(finishUndoHistoryRequesterReturn(expanded,'g',10,owner),true);assert.equal(expanded.has(key),false);
});


test('non-decision event and ordinal gaps do not split a contiguous loaded visible-record run',()=>{
 const ids=['A','B','C','D','E'],sequences=[1,2,3,5,6];
 const entries=ids.map((id,index)=>({id,eventSeq:sequences[index],ordinal:0,move:move(id,index,true,index===1||index===2?11:12)}));
 assert.deepEqual(literal(timeline([],entries)),[['E','D','C','B','A']]);
 const sameCommit=[{id:'A',eventSeq:7,ordinal:0,move:move('A',0,true)},{id:'B',eventSeq:7,ordinal:3,move:move('B',1,true)}];
 assert.deepEqual(literal(timeline([],sameCommit)),[['B','A']]);
});
