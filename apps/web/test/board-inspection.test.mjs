import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectionPaths, inspectionSegments, supplyOwnerAt} from '../board/inspection.js';
import {createBoardRuntime} from '../board/runtime/board-runtime.js';

const point = (row, col) => ({row, col});
const piece = (id, owner, kind = 'unit', position = point(3, 3)) => ({id,owner,kind,position,supplied:true,commanded:true});
const position = () => ({sideToMove:'P1',turnIndex:0,continuation:null,outcome:{status:'ongoing'},pieces:[piece('C1','P1','commander'),piece('A','P1','unit',point(4,3)),piece('B','P2','commander',point(6,3))],artifacts:{supply:[{player:'P1',shortestPathByPieceId:{C1:[point(3,3),point(3,4)],A:[point(4,3),point(3,3),point(3,4)]}},{player:'P2',shortestPathByPieceId:{B:[point(6,3),point(6,4)]}}],command:{shortestPathToCommanderByPieceId:{A:[point(4,3),point(3,3)],B:[point(6,3),point(6,4)]}}}});

test('inspection resolves piece or owned network paths, deduplicates shared segments, and never mutates snapshots', () => {
  const state = position(), original = structuredClone(state);
  assert.equal(inspectionPaths(state,{kind:'supply',pieceId:'A'}).length,1);
  assert.equal(inspectionPaths(state,{kind:'command',pieceId:'A'})[0].kind,'command');
  assert.equal(inspectionSegments(state,{kind:'supply'}).length,2);
  assert.equal(inspectionSegments(state,{kind:'supply',owner:'P2'}).length,1);
  assert.equal(inspectionPaths(state,{kind:'combined',pieceId:'A'}).length,2);
  assert.deepEqual(inspectionPaths(state,{kind:'command',pieceId:'missing'}),[]);
  assert.deepEqual(inspectionPaths(state,{kind:'supply',point:point(9,9)}),[]);
  assert.deepEqual(state,original);
});

test('supply-point lookup recognizes only actual supply coordinates', () => {
  let count=0;
  for(let row=0;row<10;row++) for(let col=0;col<10;col++) if(supplyOwnerAt(point(row,col))) count++;
  assert.equal(count,2);
  assert.equal(supplyOwnerAt(null),null);
});

function harness({canInteract=true, canPresentActions=canInteract, message=null, moves=[], previews=moves, loadMoves=null, onMessageAction=()=>{}}={}) {
  let click, rendered, prompt='', writes=0, messageClick;
  const label={get innerHTML(){return prompt;},set innerHTML(value){prompt=value;},get textContent(){return prompt;},set textContent(value){prompt=value;},addEventListener(type,handler){if(type==='click')messageClick=handler;},removeEventListener(){}};
  const runtime=createBoardRuntime({
    boardAdapter:{mount:options=>{click=options.onCellClick;},render:value=>{rendered=value;},getSelectedPieceSummary:({selectedPieceId,snapshot})=>{const found=snapshot.pieces.find(item=>item.id===selectedPieceId);return found ? {details:found}:null;},getPieceById:(state,id)=>state.pieces.find(item=>item.id===id),getPieceAt:(state,coord)=>state.pieces.find(item=>item.position.row===coord.row&&item.position.col===coord.col),nextSelectionForCell:({snapshot,clickedCoord,selection})=>{const selected=snapshot.pieces.find(item=>item.position.row===clickedCoord.row&&item.position.col===clickedCoord.col);return {selection:selected?{selectedPieceId:selected.id,source:selected.position,target:null}:{...selection,target:clickedCoord},nextActionType:'move'};}},
    host:{canSelect:()=>true,canInteract:()=>canInteract,canPresentActions:()=>canPresentActions,loadPieceMoves:loadMoves??(async()=>({actions:moves,previewActions:previews})),applyAction:async()=>{writes++;return {accepted:false};}},
    controls:{getAllowFreeSelection:()=>true,getBoardMessage:()=>message,onBoardMessageAction:onMessageAction}
  });
  runtime.bindElements({boardEl:{},overlayLinesEl:{},boardPreviewLabelEl:label});
  return {runtime,click:coord=>click(coord),messageClick:id=>messageClick({target:{closest:selector=>selector==='[data-board-message-action]'?{getAttribute:()=>id}:null}}),get rendered(){return rendered;},get prompt(){return prompt;},get writes(){return writes;}};
}

test('legend inspection toggles single paths and owned networks without losing selection',async()=>{
  const h=harness(); await h.runtime.loadSnapshot(position(),{legalActions:[]});
  h.runtime.setInspection({kind:'command'});
  assert.deepEqual(h.runtime.getInspection(),{kind:'command',owner:'P1'});
  h.runtime.setInspection({kind:'command'}); assert.equal(h.runtime.getInspection(),null);
  h.click(point(4,3)); await Promise.resolve();
  h.runtime.setInspection({kind:'supply'});
  assert.deepEqual(h.runtime.getInspection(),{kind:'supply',pieceId:'A'});
  assert.equal(h.runtime.getSelection().selectedPieceId,'A');
  h.runtime.clearInspection(); assert.equal(h.runtime.getSelection().selectedPieceId,'A');
  assert.equal(h.writes,0);
});

test('inspection follows surviving pieces and drops removed piece targets across live snapshots',async()=>{
  const h=harness(); const state=position(); await h.runtime.loadSnapshot(state,{legalActions:[]});
  h.runtime.setInspection({kind:'command',pieceId:'A'});
  state.pieces.find(item=>item.id==='A').position=point(5,3);
  await h.runtime.loadSnapshot(state,{legalActions:[],resetSelection:true});
  assert.equal(h.runtime.getInspection().pieceId,'A');
  assert.deepEqual(h.runtime.getSelection().source,point(5,3));
  state.pieces=state.pieces.filter(item=>item.id!=='A');
  await h.runtime.loadSnapshot(state,{legalActions:[]});
  assert.equal(h.runtime.getInspection(),null);
});

test('commander reclick has exactly previews and combined connections phases',async()=>{
  const moves=[{type:'move',actorId:'C1',from:point(3,3),to:point(2,3)},{type:'move',actorId:'C1',from:point(3,3),to:point(3,2)}];
  const h=harness({moves}); await h.runtime.loadSnapshot(position(),{legalActions:moves});
  h.click(point(3,3)); await Promise.resolve();
  h.click(point(3,3)); assert.equal(h.runtime.getInspection().kind,'combined');
  h.click(point(3,3)); assert.equal(h.runtime.getInspection(),null);
  assert.equal(h.rendered.selectedPieceOverlayPhase,'actionPreviews');
});

test('unoccupied supply points toggle networks, occupied points select pieces, and replay blocks clicks',async()=>{
  const h=harness(); const state=position(); await h.runtime.loadSnapshot(state,{legalActions:[]});
  let supply; for(let row=0;row<10;row++)for(let col=0;col<10;col++)if(supplyOwnerAt(point(row,col))==='P1')supply=point(row,col);
  h.click(supply); assert.equal(h.runtime.getInspection().kind,'supply');
  h.click(supply); assert.equal(h.runtime.getInspection(),null);
  state.pieces.push(piece('on-supply','P1','unit',supply));
  await h.runtime.loadSnapshot(state,{legalActions:[]});
  h.click(supply); assert.equal(h.runtime.getSelection().selectedPieceId,'on-supply');
  h.runtime.setInteractionBlocked(true); h.click(point(3,3)); await h.runtime.submitCurrentAction({type:'pass'});
  assert.equal(h.runtime.getSelection().selectedPieceId,'on-supply'); assert.equal(h.writes,0);
});

test('computer message precedence suppresses human prompts while preserving inspection',async()=>{
  const h=harness({canInteract:false,message:{text:'Tau is thinking',action:{id:'replay',label:'Show me again'}}});
  await h.runtime.loadSnapshot(position(),{legalActions:[{type:'pass'}]});
  h.runtime.setInspection({kind:'supply'});
  assert.match(h.prompt,/Tau is thinking/); assert.match(h.prompt,/Show me again/); assert.doesNotMatch(h.prompt,/>Pass</);
  assert.equal(h.runtime.getInspection().kind,'supply');
});

test('historical inspection can replace then restore recorded action overlay without submitting',async()=>{
  const h=harness({canInteract:false}); const action={type:'move',actorId:'C1',from:point(3,3),to:point(3,4)};
  await h.runtime.loadSnapshot(position(),{legalActions:[],overlayMode:'recorded-action',recordedAction:action});
  h.click(point(4,3)); assert.equal(h.runtime.getInspection().pieceId,'A');
  assert.deepEqual(h.runtime.getOverlay().recordedAction,action);
  h.runtime.clearInspection(); assert.equal(h.runtime.getOverlay().inspection,null);
  assert.deepEqual(h.rendered.overlay.recordedAction,action); assert.equal(h.writes,0);
});

test('read-only commander starts with combined connections and repeat clears only personal selection',async()=>{
 const h=harness({canInteract:false});await h.runtime.loadSnapshot(position(),{legalActions:[]});
 h.click(point(3,3));await Promise.resolve();assert.equal(h.runtime.getInspection().kind,'combined');
 assert.equal(h.rendered.selectedPieceOverlayPhase,'supplyCommand');
 h.click(point(3,3));assert.equal(h.runtime.getInspection(),null);assert.equal(h.runtime.getSelection().selectedPieceId,null);
 h.click(point(3,3));assert.equal(h.runtime.getInspection().kind,'combined');assert.equal(h.writes,0);
});


test('external replay actions remain usable while board input is blocked',async()=>{
  const actions=[];
  const h=harness({message:{text:'Replay',actions:[{id:'stop',label:'Stop replay'},{id:'next',label:'Next step'}]},onMessageAction:id=>actions.push(id)});
  await h.runtime.loadSnapshot(position(),{legalActions:[]});
  h.runtime.setInteractionBlocked(true);
  h.messageClick('stop'); h.messageClick('next');
  assert.deepEqual(actions,['stop','next']);
  assert.match(h.prompt,/Stop replay/); assert.match(h.prompt,/Next step/);
  assert.equal(h.writes,0);
});


test('only legal destinations take priority over unoccupied supply-point inspection',async()=>{
  let supply; for(let row=0;row<10;row++)for(let col=0;col<10;col++)if(supplyOwnerAt(point(row,col))==='P1')supply=point(row,col);
  const blocked={type:'move',actorId:'C1',from:point(3,3),to:supply,legal:false};
  const h=harness({previews:[blocked]}); await h.runtime.loadSnapshot(position(),{legalActions:[]});
  h.click(point(3,3)); await Promise.resolve(); h.click(supply);
  assert.equal(h.runtime.getInspection().kind,'supply'); assert.equal(h.writes,0);
  const legal={...blocked,legal:true}; const playable=harness({moves:[legal]});
  await playable.runtime.loadSnapshot(position(),{legalActions:[legal]});
  playable.click(point(3,3)); await Promise.resolve(); playable.click(supply);
  assert.equal(playable.runtime.getInspection(),null);
});

test('whole networks deduplicate compressed and unit-step representations of the same connection',()=>{
  const state=position();
  state.artifacts.supply[0].shortestPathByPieceId={C1:[point(3,3),point(3,5)],A:[point(3,3),point(3,4),point(3,5)]};
  assert.equal(inspectionSegments(state,{kind:'supply',owner:'P1'}).length,2);
});


test('independent command and supply inspections preserve opposite owners and clear separately',async()=>{
 const h=harness({canInteract:false}),snapshot=position();
 let supply;for(let row=0;row<10;row++)for(let col=0;col<10;col++)if(supplyOwnerAt(point(row,col))==='P1')supply=point(row,col);
 snapshot.artifacts.supply[0].shortestPathByPieceId.C1=[point(3,3),point(3,9),supply];
 await h.runtime.loadSnapshot(snapshot,{legalActions:[]});h.click(point(6,3));await Promise.resolve();
 h.runtime.toggleNetworkInspection('command');
 const command={kind:'command',owner:'P2'};assert.deepEqual(h.runtime.getInspection(),command);
 h.click(supply);
 assert.deepEqual(h.runtime.getInspection(),{kind:'networks',command,supply:{kind:'supply',owner:'P1',point:supply}});
 assert.equal(h.runtime.getSelection().selectedPieceId,'B');
 assert.deepEqual(new Set(inspectionPaths(snapshot,h.runtime.getInspection()).map(path=>`${path.kind}:${path.owner}`)),new Set(['command:P2','supply:P1']));
 h.runtime.toggleNetworkInspection('supply');assert.deepEqual(h.runtime.getInspection(),command);
 h.runtime.toggleNetworkInspection('supply');h.runtime.toggleNetworkInspection('command');
 assert.deepEqual(h.runtime.getInspection(),{kind:'supply',owner:'P1',point:supply});
 await h.runtime.loadSnapshot(snapshot,{legalActions:[],resetSelection:false});
 assert.equal(h.runtime.getOverlay().networkOwners.command,'P2');assert.equal(h.runtime.getOverlay().networkOwners.supply,'P1');
 h.runtime.toggleNetworkInspection('supply');assert.equal(h.runtime.getInspection(),null);assert.equal(h.writes,0);
});


test('a pressed board command inspection clears on its first legend toggle and invalid input preserves other networks',async()=>{
 const h=harness({canInteract:false});await h.runtime.loadSnapshot(position(),{legalActions:[]});
 h.runtime.setInspection({kind:'command',owner:'P2'});h.runtime.toggleNetworkInspection('command',{owner:'P2'});
 assert.equal(h.runtime.getInspection(),null);
 h.runtime.toggleNetworkInspection('supply',{owner:'P1'});const before=structuredClone(h.runtime.getInspection());
 assert.equal(h.runtime.setInspection({kind:'command',pieceId:'missing'}),false);assert.deepEqual(h.runtime.getInspection(),before);
 assert.equal(h.runtime.toggleNetworkInspection('command',{owner:'invalid'}),false);assert.deepEqual(h.runtime.getInspection(),before);
 assert.equal(h.runtime.toggleNetworkInspection('supply',{owner:'P1',point:point(9,0)}),false);assert.deepEqual(h.runtime.getInspection(),before);
 h.runtime.toggleNetworkInspection('supply',{owner:'P1',point:{col:9,row:0}});assert.equal(h.runtime.getInspection(),null);assert.equal(h.writes,0);
});


test('authoritative loss of command paths clears only command inspection',async()=>{
 const h=harness({canInteract:false}),snapshot=position();
 await h.runtime.loadSnapshot(snapshot,{legalActions:[]});
 h.runtime.toggleNetworkInspection('command',{owner:'P2'});h.runtime.toggleNetworkInspection('supply',{owner:'P1'});
 snapshot.artifacts.command.shortestPathToCommanderByPieceId={};
 await h.runtime.loadSnapshot(snapshot,{legalActions:[],resetSelection:false});
 assert.equal(h.runtime.getInspection().kind,'supply');assert.equal(h.runtime.getOverlay().networkOwners.command,'P2');
 h.click(point(3,3));await Promise.resolve();assert.deepEqual(h.runtime.getOverlay().networkInspections,{command:null,supply:null});assert.equal(h.writes,0);
});

test('commander and legend skip command inspection when there are no paths',async()=>{
 const moves=[{type:'move',actorId:'C1',from:point(3,3),to:point(2,3)},{type:'move',actorId:'C1',from:point(3,3),to:point(3,2)}];
 const state=position();state.artifacts.command.shortestPathToCommanderByPieceId={};state.artifacts.supply[0].shortestPathByPieceId.C1=[point(3,3),point(0,3),point(0,9)];
 const h=harness({moves});await h.runtime.loadSnapshot(state,{legalActions:moves});
 h.click(point(3,3));await Promise.resolve();
 h.click(point(3,3));assert.equal(h.runtime.getInspection().kind,'combined');
 h.click(point(3,3));assert.equal(h.runtime.getInspection(),null);
 assert.match(h.prompt,/Select a move for piece at/);assert.doesNotMatch(h.prompt,/No command connection/);
 h.runtime.setInspection({kind:'command',owner:'P1'});
 assert.equal(h.runtime.getInspection(),null);assert.doesNotMatch(h.prompt,/No command connection/);assert.equal(h.writes,0);
});

test('combined commander uses its own supply route and all valid command routes to that commander',()=>{
 const c=piece('C','P2','commander',point(6,3)),u=piece('U','P2','unit',point(4,3)),v=piece('V','P2','unit',point(6,1));
 const state={sideToMove:'P2',pieces:[c,u,v,piece('E','P1','unit',point(5,3))],artifacts:{supply:[{player:'P2',shortestPathByPieceId:{C:[c.position,point(9,3),point(9,0)],U:[u.position,point(9,3),point(9,0)]}}],command:{shortestPathToCommanderByPieceId:{C:[c.position],U:[u.position,c.position],V:[v.position,c.position],E:[point(5,3),c.position]}}}};
 const original=structuredClone(state),paths=inspectionPaths(state,{kind:'combined',pieceId:'C'});
 assert.equal(paths.filter(path=>path.kind==='supply').length,1);assert.equal(paths.filter(path=>path.kind==='command').length,2);
 for(const path of paths){assert.equal(path.owner,'P2');assert.deepEqual(path.path.at(-1),path.kind==='command'?c.position:point(9,0));}
 assert.deepEqual(state,original);
 state.artifacts.command.shortestPathToCommanderByPieceId.V=[v.position,point(3,6)];
 state.artifacts.command.shortestPathToCommanderByPieceId.U=[point(0,0),c.position];
 assert.equal(inspectionPaths(state,{kind:'combined',pieceId:'C'}).filter(path=>path.kind==='command').length,0,'malformed endpoints never create substitute routes');state.artifacts.command.shortestPathToCommanderByPieceId.U=[u.position,{row:undefined,col:3},c.position];assert.equal(inspectionPaths(state,{kind:'combined',pieceId:'C'}).filter(path=>path.kind==='command').length,0,'malformed intermediate coordinates are dropped before normalization');
 assert.equal(inspectionPaths(original,{kind:'combined',pieceId:'U'}).filter(path=>path.kind==='supply').length,1,'ordinary personal unit inspection is unchanged');
});

test('Standard rush recorded engine artifacts drive both commander networks without extra personal supplies',async()=>{
 const {readFileSync}=await import('node:fs');
 const {normalizeState,resolveToStability}=await import('../generated/packages/game-engine/src/index.js');
 const catalog=JSON.parse(readFileSync(new URL('../scenarios/catalog.json',import.meta.url),'utf8'));
 const saved=catalog.scenarios.find(item=>item.title==='Standard rush');assert.ok(saved);
 const state=resolveToStability(normalizeState(saved.resultingState),{artifactMode:'full'}),before=structuredClone(state);
 for(const owner of ['P1','P2']){
  const commander=state.pieces.find(piece=>piece.owner===owner&&piece.kind==='commander');assert.ok(commander);
  const paths=inspectionPaths(state,{kind:'combined',pieceId:commander.id});
  const recorded=state.artifacts.command.shortestPathToCommanderByPieceId;
  const expected=state.pieces.filter(piece=>piece.owner===owner&&(recorded[piece.id]?.length??0)>1&&recorded[piece.id].at(-1).row===commander.position.row&&recorded[piece.id].at(-1).col===commander.position.col);
  assert.equal(paths.filter(path=>path.kind==='command').length,expected.length);
  assert.ok(paths.filter(path=>path.kind==='supply').length<=1);
  for(const path of paths){assert.equal(path.owner,owner);assert.deepEqual(path.path.at(-1),path.kind==='command'?commander.position:supplyPointForTest(owner));}
 }
 assert.deepEqual(state,before);
});
function supplyPointForTest(owner){return owner==='P1'?{row:0,col:9}:{row:9,col:0};}

test('explicit opposite supply replaces personal commander supply and clearing never restores it automatically',async()=>{
 const state=position();state.sideToMove='P2';state.pieces.push(piece('U2','P2','unit',point(4,3)));
 state.artifacts.command.shortestPathToCommanderByPieceId.U2=[point(4,3),point(6,3)];
 state.artifacts.supply[1].shortestPathByPieceId.B=[point(6,3),point(9,3),point(9,0)];
 state.artifacts.supply[0].shortestPathByPieceId.C1=[point(3,3),point(0,3),point(0,9)];
 const moves=[{type:'move',actorId:'B',from:point(6,3),to:point(5,3)},{type:'move',actorId:'B',from:point(6,3),to:point(6,4)}];
 const h=harness({moves});await h.runtime.loadSnapshot(state,{legalActions:moves});h.click(point(6,3));await Promise.resolve();h.click(point(6,3));
 const paths=()=>inspectionPaths(state,h.runtime.getInspection());
 assert.ok(paths().some(path=>path.kind==='supply'&&path.owner==='P2'));
 h.click(point(0,9));assert.equal(h.runtime.getSelection().selectedPieceId,'B');
 assert.ok(paths().some(path=>path.kind==='command'&&path.owner==='P2'));assert.ok(paths().some(path=>path.kind==='supply'&&path.owner==='P1'));
 assert.ok(!paths().some(path=>path.kind==='supply'&&path.owner==='P2'));
 h.click(point(0,9));assert.ok(paths().some(path=>path.kind==='command'&&path.owner==='P2'));assert.ok(!paths().some(path=>path.kind==='supply'));
 await h.runtime.loadSnapshot(state,{legalActions:moves,resetSelection:false});assert.ok(!paths().some(path=>path.kind==='supply'));
 h.click(point(6,3));assert.equal(h.runtime.getInspection(),null);assert.equal(h.rendered.selectedPieceOverlayPhase,'actionPreviews');
 h.click(point(6,3));assert.ok(paths().some(path=>path.kind==='supply'&&path.owner==='P2'));assert.equal(h.writes,0);
});

test('Commander legend remains command-only and clearing it retains an independent supply inspector',async()=>{
 const h=harness({canInteract:false}),state=position();await h.runtime.loadSnapshot(state,{legalActions:[]});h.click(point(3,3));await Promise.resolve();
 h.runtime.toggleNetworkInspection('command',{owner:'P1'});assert.ok(inspectionPaths(state,h.runtime.getInspection()).every(path=>path.kind==='command'));
 h.runtime.toggleNetworkInspection('supply',{owner:'P2'});h.runtime.toggleNetworkInspection('command',{owner:'P1'});
 assert.deepEqual(h.runtime.getInspection(),{kind:'supply',owner:'P2',point:point(9,0)});assert.equal(h.runtime.getSelection().selectedPieceId,'C1');assert.equal(h.writes,0);
});

test('commander previews remain first while move preparation is pending',async()=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;});const state=position();
 const moves=[{type:'move',actorId:'C1',from:point(3,3),to:point(2,3)},{type:'move',actorId:'C1',from:point(3,3),to:point(3,2)}];
 const h=harness({loadMoves:()=>pending});await h.runtime.loadSnapshot(state,{legalActions:[]});h.click(point(3,3));
 h.click(point(3,3));assert.equal(h.runtime.getInspection(),null);assert.equal(h.rendered.selectedPieceOverlayPhase,'actionPreviews');
 finish({actions:moves,previewActions:moves});await Promise.resolve();await Promise.resolve();
 assert.equal(h.runtime.getInspection(),null);assert.equal(h.rendered.selectedPieceOverlayPhase,'actionPreviews');assert.equal(h.writes,0);
});

test('a commander at its supply point skips an empty live connections stop and has useful read-only copy',async()=>{
 const state=position();state.pieces[0].position=point(0,9);state.artifacts.command.shortestPathToCommanderByPieceId={};state.artifacts.supply[0].shortestPathByPieceId.C1=[point(0,9)];
 const moves=[{type:'move',actorId:'C1',from:point(0,9),to:point(1,9)},{type:'move',actorId:'C1',from:point(0,9),to:point(0,8)}];
 const h=harness({moves});await h.runtime.loadSnapshot(state,{legalActions:moves});h.click(point(0,9));await Promise.resolve();h.click(point(0,9));
 assert.equal(h.runtime.getInspection(),null);assert.equal(h.rendered.selectedPieceOverlayPhase,'actionPreviews');assert.match(h.prompt,/Select a move for piece at/);
 const readOnly=harness({canInteract:false});await readOnly.runtime.loadSnapshot(state,{legalActions:[]});readOnly.click(point(0,9));
 assert.match(readOnly.prompt,/At its supply point\. No connected units\./);assert.equal(inspectionPaths(state,readOnly.runtime.getInspection()).length,0);assert.equal(readOnly.writes,0);
});

test('commander connection copy follows drawn roles and keeps shared coordinate pills',async()=>{
 const state=position();state.artifacts.supply[0].shortestPathByPieceId.C1=[point(3,3),point(0,3),point(0,9)];
 const both=harness({canInteract:false});await both.runtime.loadSnapshot(state,{legalActions:[]});both.click(point(3,3));
 assert.match(both.prompt,/Supply and command lines for piece at/);assert.match(both.prompt,/board-preview-coordinate-chip/);
 const supply=structuredClone(state);supply.artifacts.command.shortestPathToCommanderByPieceId={};
 const supplyOnly=harness({canInteract:false});await supplyOnly.runtime.loadSnapshot(supply,{legalActions:[]});supplyOnly.click(point(3,3));
 assert.match(supplyOnly.prompt,/Supply line for commander at/);assert.match(supplyOnly.prompt,/No connected units\./);assert.match(supplyOnly.prompt,/board-preview-coordinate-chip/);
 const atPoint=structuredClone(state);atPoint.pieces[0].position=point(0,9);atPoint.pieces[1].position=point(0,6);atPoint.artifacts.supply[0].shortestPathByPieceId.C1=[point(0,9)];atPoint.artifacts.command.shortestPathToCommanderByPieceId.A=[point(0,6),point(0,9)];
 const commandOnly=harness({canInteract:false});await commandOnly.runtime.loadSnapshot(atPoint,{legalActions:[]});commandOnly.click(point(0,9));
 assert.match(commandOnly.prompt,/Command lines for commander at/);assert.match(commandOnly.prompt,/Already at its supply point\./);assert.doesNotMatch(commandOnly.prompt,/No supply connection/);assert.equal(commandOnly.writes,0);
});
