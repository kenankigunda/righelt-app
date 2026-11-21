import wide from '../fixtures/automatic-ending-wide-rush.json' with { type: 'json' };
import rescue from '../fixtures/automatic-ending-rescue.json' with { type: 'json' };
import {makeState,commander,unit} from './state-builders.mjs';
import {applyAction,createInitialState,listLegalActions,resolveToStability,deterministicStateHash} from '../../src/index.ts';

export const automaticEndingCorpus=()=>{
 const wideState=resolveToStability(applyAction(structuredClone(wide.initialState),wide.decisiveAction).state,{artifactMode:'full'});
 const optional=makeState(structuredClone(rescue));optional.continuation.rushChainPieceIds=['B'];optional.continuation.rushedPieceIds=['A','C1'];
 const terminal=makeState(structuredClone(rescue));terminal.continuation.rushedPieceIds=terminal.pieces.filter(p=>p.owner==='P1'&&p.id!=='B').map(p=>p.id);
 const prefix=makeState(structuredClone(rescue));prefix.pieces.push(unit('Y','P1',7,6));prefix.continuation.frozenPieceStatesById.Y={supplied:true,commanded:true};
 const draw=makeState(structuredClone(rescue));draw.pieces.find(p=>p.id==='A').position.col=2;draw.pieces.find(p=>p.id==='C2').position={row:7,col:3};draw.pieces.push(unit('north','P1',6,3),unit('south','P1',8,3));for(const id of ['north','south'])draw.continuation.frozenPieceStatesById[id]={supplied:true,commanded:true};draw.continuation.rushedPieceIds=draw.pieces.filter(p=>p.owner==='P1'&&p.id!=='B').map(p=>p.id);
 const pushed=trapped=>{
  const row=trapped?0:4,col=trapped?0:5,from=trapped?{row:0,col:1}:{row:4,col:4};
  const pieces=[commander('C1','P1',trapped?0:3,trapped?9:6),unit('A','P1',row,col,{shifted:true}),commander('C2','P2',row,col,{pushed:true,supplied:false,commanded:false,shifted:false})];
  if(trapped)pieces.push(unit('wall-e','P1',0,2),unit('wall-se','P1',1,1),unit('wall-s','P1',2,0));
  const state=makeState({pieces,sideToMove:'P2',continuation:{type:'push',owner:'P2',attackerOwner:'P1',phase:'retreat',pushedPieceId:'C2',followPoint:from,followGroupPieceIds:['A'],chainLength:1}});
  return {state,options:{push:{decisionId:'benchmark-push',frameHash:deterministicStateHash(state),action:{type:'push',actorId:'A',targetId:'C2',from,to:{row,col}}}}};
 };
 const initial=makeState({pieces:[commander('C1','P1',3,6),commander('C2','P2',6,3),unit('L','P1',3,3),unit('A','P1',4,4),unit('B','P1',5,3),unit('E','P2',4,2)]});
 const rush={type:'rush',actorId:'A',from:{row:4,col:4},to:{row:4,col:3}};
 return [
  {name:'wide winning rush',state:wideState,expected:'proven-terminal',outcome:'p1_win'},
  {name:'required attacker rescue',state:makeState(structuredClone(rescue)),expected:'continue'},
  {name:'optional multi-step attacker rescue',state:optional,expected:'continue'},
  {name:'required terminal continuation',state:terminal,expected:'proven-terminal',outcome:'p2_win'},
  {name:'required prefix before optional rescue',state:prefix,expected:'continue'},
  {name:'required win-to-draw change',state:draw,expected:'continue'},
  {name:'saving defender retreat',...pushed(false),expected:'continue'},
  {name:'trapped defender finality',...pushed(true),expected:'proven-terminal',outcome:'p1_win'},
  {name:'ordinary ongoing rush',state:resolveToStability(applyAction(initial,rush).state),expected:'continue'},
 ];
};
