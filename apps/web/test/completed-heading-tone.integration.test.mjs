import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedHistoryPresentation} from '../shell/history-narration.js';
import {playbackTurnIndicator} from '../shell/playback-presentation.js';
import {createBoardRuntime} from '../board/runtime/board-runtime.js';

const person=(identityId,name)=>({identityId,profile:{displayName:name}});
const record={moveId:'final',index:1,turnIndex:4,turnMoveIndex:0,actorSide:'P1',action:{type:'move',from:{row:3,col:6},to:{row:4,col:6}},selectionSnapshot:{sideToMove:'P1',pieces:[]},snapshot:{pieces:[]}};
const game=(status='p1_win',extra={})=>({id:'g',board:{state:{outcome:{status},pieces:[]}},moves:[record],turns:[{index:4,playerSeat:'Player 1',moveIndexes:[1]}],player1:person('red','Maya'),player2:person('blue','Ada'),inHistoryMode:true,historyTurnIndex:4,historyTurnMoves:[record],...extra});
const cases=[['p1_win','red',{},'You won','P1'],['p2_win','red',{},'Ada won','P2'],['p1_win','viewer',{},'Maya won','P1'],['draw','red',{},'Draw',null],['p2_win','same',{player1:person('same','Maya'),player2:person('same','Maya'),selfPlayMode:true},'You won','P2'],['p1_win','viewer',{player1:person('red','שלום <&> on Turn 99')},'שלום <&> on Turn 99 won','P1']];

test('decisive captions separate the complete winner phrase from a neutral turn suffix',()=>{
 for(const [status,identityId,extra,name,side] of cases){
  const view=game(status,extra),before=JSON.stringify(view),caption=playbackTurnIndicator(view,{},{identityId});
  assert.deepEqual(caption,{text:name+' on Turn 5',name,suffix:' on Turn 5',neutralSuffix:true,side});
  assert.equal(JSON.stringify(view),before);
 }
 const earlier=selectedHistoryPresentation({...game(),historyTurnIndex:3},{identityId:'red'}).caption;
 assert.equal(earlier.text,'Turn 4');assert.equal(earlier.neutralSuffix,undefined);
});

const noop=()=>{};
const element=()=>{let text='',children=[],classes=new Set();return{ownerDocument:{createElement:()=>element()},get children(){return children},set textContent(value){text=value;children=[]},get textContent(){return children.length?children.map(n=>n.textContent).join(''):text},get className(){return[...classes].join(' ')},set className(value){classes=new Set(value.split(' ').filter(Boolean))},classList:{add:value=>classes.add(value),remove:(...values)=>values.forEach(value=>classes.delete(value))},replaceChildren(...values){children=values}};};

test('actual runtime colors only the winner phrase and resets ordinary heading state',async()=>{
 const indicator=element();let current;
 const runtime=createBoardRuntime({controls:{getTurnIndicator:()=>current},boardAdapter:{mount:noop,render:noop,getSelectedPieceSummary:()=>null},host:{canInteract:()=>false}});
 runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:null,boardTurnIndicatorEl:indicator});
 for(const [status,identityId,extra,name,side] of cases){
  current=playbackTurnIndicator(game(status,extra),{},{identityId});
  await runtime.loadSnapshot({sideToMove:'P1',pieces:[],outcome:{status:'ongoing'}},{legalActions:[]});
  assert.equal(indicator.textContent,name+' on Turn 5');assert.equal(indicator.children.length,2);
  assert.equal(indicator.children[0].textContent,name);assert.equal(indicator.children[0].className,'board-turn-name'+(side?' player-tone-'+side.toLowerCase():''));
  assert.equal(indicator.children[1].textContent,' on Turn 5');assert.equal(indicator.className,'');
 }
 current={text:'Turn 4',side:'P2'};runtime.refreshStatus();assert.equal(indicator.children.length,0);assert.equal(indicator.textContent,'Turn 4');assert.equal(indicator.className,'player-tone-p2');
 current={text:'Your turn to play',name:'You',suffix:'r turn to play',side:'P1'};runtime.refreshStatus();assert.equal(indicator.className,'player-tone-p1');assert.equal(indicator.textContent,'Your turn to play');
});
