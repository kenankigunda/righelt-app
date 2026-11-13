import test from 'node:test';
import assert from 'node:assert/strict';
import {joinNarrationEvents,describeRecordedMove,describeRecordedTurn,recordedMoveNumber,visibleRecordedMoves,recordedNarrationCoordinates} from '../shell/recorded-narration.js';
const a={row:4,col:3},b={row:4,col:4},c={row:5,col:3};
const move=(type,id='A',owner='P1',from=a,to=b)=>({index:40,turnIndex:4,actorSide:owner,action:{type,actorId:id,from,to},snapshot:{pieces:[]},destroyedPieces:[]});
const removal=(id,ownerSeat,position=c)=>({pieceId:id,ownerSeat,position});
const piece=(id,owner,position)=>({id,owner,kind:'unit',position});
test('every approved action uses recorded coordinates and exact past tense',()=>{
 const examples={move:'moved commander from (4, 3) to (4, 4)',project:'projected new piece from (4, 3) to (4, 4)',rush:'rushed from (4, 3) to (4, 4)',push:'pushed onto (4, 4)',retreat:'retreated from (4, 3) to (4, 4)',follow:'followed from (4, 3) to (4, 4)',pass:'passed'};
 for(const[type,copy]of Object.entries(examples))assert.equal(describeRecordedMove(move(type),'Maya'),`Maya ${copy}`);
 assert.equal(describeRecordedMove(move('end_turn'),'Maya'),null);
});
test('event punctuation handles one through four clauses independently of coordinate lists',()=>{
 assert.equal(joinNarrationEvents(['a']),'a');assert.equal(joinNarrationEvents(['a','b']),'a and b');assert.equal(joinNarrationEvents(['a','b','c']),'a, b, and c');assert.equal(joinNarrationEvents(['a',null,'b','c','d']),'a, b, c, and d');
 const push=move('push'),retreat=move('retreat','D','P2',b,c),follow=move('follow','B');
 follow.destroyedPieces=[removal('own','p1'),removal('opp1','p2'),removal('opp2','p2')];
 assert.equal(describeRecordedTurn([push,retreat,follow],'Maya'),'Maya pushed onto (4, 4) and had 1 piece follow. Maya also lost piece at (5, 3) and destroyed 2 pieces');
 assert.equal(describeRecordedMove({...retreat,destroyedPieces:[removal('defender','p2')]},'Kenan'),'Kenan retreated from (4, 4) to (5, 3) and lost piece at (5, 3)');
});
test('rush counts distinct actors and keeps acknowledged destination order',()=>{
 const rushes=[move('rush','A'),move('rush','B','P1',a,c),move('rush','C','P1',a,{row:4,col:5})];
 assert.equal(describeRecordedTurn(rushes,'Maya'),'Maya rushed 3 pieces to (4, 4), (5, 3), and (4, 5)');
 assert.equal(describeRecordedTurn([rushes[0],{...rushes[1],undone:true}],'Maya'),describeRecordedMove(rushes[0],'Maya'));
});
test('push follower counts exclude initial pusher and deduplicate actors',()=>{
 const push=move('push'),follow=move('follow','A'),other=move('follow','B');
 assert.equal(describeRecordedTurn([push,follow],'Maya'),'Maya pushed onto (4, 4)');
 assert.equal(describeRecordedTurn([push,follow,other,{...other}],'Maya'),'Maya pushed onto (4, 4) and had 1 piece follow');
});
test('an exact opposing no-retreat record at the push destination is narrated once as a capture',()=>{
 const push={...move('push'),selectionSnapshot:{pieces:[piece('A','P1',a),piece('defender','P2',b)]},destroyedPieces:[{...removal('defender','p2',b),reason:'no_retreat'}]};
 assert.equal(describeRecordedMove(push,'Maya'),'Maya pushed onto (4, 4) and captured piece at (4, 4)');
 assert.equal(describeRecordedTurn([push],'Maya'),'Maya pushed onto (4, 4) and captured piece at (4, 4)');
 const follow={...move('follow','follower'),turnMoveIndex:1};
 assert.equal(describeRecordedTurn([push,follow],'Maya'),'Maya pushed onto (4, 4) and captured piece at (4, 4). Maya also had 1 piece follow');
});
test('same-square own loss and turn-end destruction are never inferred as captures',()=>{
 const ownLoss={...move('push'),selectionSnapshot:{pieces:[piece('A','P1',a),piece('own','P1',b)]},destroyedPieces:[{...removal('own','p1',b),reason:'no_retreat'}]};
 assert.equal(describeRecordedMove(ownLoss,'Maya'),'Maya pushed onto (4, 4) and lost piece at (4, 4)');
 const turnEnd={...move('push'),selectionSnapshot:{pieces:[piece('A','P1',a),piece('defender','P2',b)]},destroyedPieces:[{...removal('defender','p2',b),reason:'loss_of_supply'}]};
 assert.equal(describeRecordedMove(turnEnd,'Maya'),'Maya pushed onto (4, 4) and destroyed piece at (4, 4)');
 const beforeClosure={...turnEnd,destroyedPieces:[]},closure={...move('end_turn'),index:41,turnMoveIndex:1,destroyedPieces:turnEnd.destroyedPieces};
 assert.equal(describeRecordedTurn([beforeClosure,closure],'Maya'),'Maya pushed onto (4, 4) and destroyed piece at (4, 4)');
 const wrongIdentity={...turnEnd,destroyedPieces:[{...removal('different-piece','p2',b),reason:'no_retreat'}]};
 assert.equal(describeRecordedMove(wrongIdentity,'Maya'),'Maya pushed onto (4, 4) and destroyed piece at (4, 4)');
});
test('closure folds final board and distinct removals into last real action once without mutating records',()=>{
 const first={...move('rush'),destroyedPieces:[removal('victim','p2')]},closure={...move('end_turn'),index:41,snapshot:{pieces:['final']},destroyedPieces:[removal('victim','p2'),removal('lost','p1')]};
 const original=structuredClone([first,closure]);const visible=visibleRecordedMoves([first,closure]);
 assert.equal(visible.length,1);assert.deepEqual(visible[0].snapshot,{pieces:['final']});assert.equal(visible[0].destroyedPieces.length,2);assert.deepEqual([first,closure],original);
 assert.equal(describeRecordedTurn([first,closure],'Maya'),'Maya rushed from (4, 3) to (4, 4) and lost piece at (5, 3). Maya also destroyed piece at (5, 3)');
 assert(recordedNarrationCoordinates(visible).some(point=>point===c));
});
test('numbering is board-wide and missing metadata stays unavailable',()=>{
 assert.equal(recordedMoveNumber({index:40,turnMoveIndex:0}),41);assert.equal(recordedMoveNumber({index:40,displayMoveNumber:17}),17);assert.equal(recordedMoveNumber({turnMoveIndex:0}),null);
 assert.equal(describeRecordedMove({action:{type:'rush'}},'Maya'),null);
});

test('reverse archived pages fold closure into its recorded branch only',()=>{
 const old={...move('rush'),moveId:'old',index:4,turnIndex:2,undone:true,snapshot:{label:'old'}},active={...move('rush'),moveId:'active',index:6,turnIndex:2,snapshot:{label:'active'}};
 const closure={...move('end_turn'),moveId:'closure',index:5,turnIndex:2,undone:true,snapshot:{label:'closed-old'}};
 const visible=visibleRecordedMoves([closure,active,old],{includeUndone:true});
 assert.deepEqual(visible.map(move=>[move.moveId,move.snapshot.label]),[['old','closed-old'],['active','active']]);
 assert.deepEqual(visibleRecordedMoves([closure,active,old]).map(move=>[move.moveId,move.snapshot.label]),[['active','active']]);
});

test('partial archive never assigns a later closure to an earlier action',()=>{
 const first={...move('rush'),moveId:'A',index:1,turnIndex:2,turnMoveIndex:0,snapshot:{label:'A-only'}};
 const closure={...move('end_turn'),moveId:'closure',index:5,turnIndex:2,turnMoveIndex:4,snapshot:{label:'after-omitted-actions'}};
 assert.deepEqual(visibleRecordedMoves([first,closure])[0].snapshot,{label:'A-only'});
});

test('closure folding never attaches another accepted or provisional Undo operation to an earlier record',()=>{
 const action={moveId:'action',index:1,turnIndex:0,turnMoveIndex:0,undone:true,undoEventSeq:7,action:{type:'move'},snapshot:{label:'own'}};
 const closure={moveId:'closure',index:2,turnIndex:0,turnMoveIndex:1,undone:true,undoEventSeq:8,action:{type:'end_turn'},snapshot:{label:'other'}};
 const original=structuredClone([action,closure]);assert.equal(visibleRecordedMoves([action,closure],{includeUndone:true})[0].snapshot.label,'own');
 assert.equal(visibleRecordedMoves([action,{...closure,undoEventSeq:7}],{includeUndone:true})[0].snapshot.label,'other');
 assert.equal(visibleRecordedMoves([{...action,undoEventSeq:undefined,pendingUndoRequestId:'one'},{...closure,undoEventSeq:undefined,pendingUndoRequestId:'two'}],{includeUndone:true})[0].snapshot.label,'own');assert.deepEqual([action,closure],original);
});
