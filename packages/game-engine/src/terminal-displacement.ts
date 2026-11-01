import type { GameState, TerminalDisplacement } from './types';

// This validates the serialized representation, not acknowledged archive
// membership or the terminal outcome proof. Those remain authority boundaries.
export function canonicalTerminalDisplacement(state: GameState): TerminalDisplacement | undefined {
 const value=state.terminalDisplacement;
 if(value===undefined)return undefined;
 const fail=():never=>{throw new Error('Invalid terminal displacement');};
 const record=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
 const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0;
 const point=(value:unknown):value is {row:number;col:number}=>record(value)&&Object.keys(value).length===2&&Object.keys(value).every(key=>key==='row'||key==='col')&&Number.isInteger(value.row)&&Number.isInteger(value.col)&&Number(value.row)>=0&&Number(value.row)<state.boardSize&&Number(value.col)>=0&&Number(value.col)<state.boardSize;
 const same=(a:{row:number;col:number},b:{row:number;col:number})=>a.row===b.row&&a.col===b.col;
 if(!record(value)||Object.keys(value).some(key=>!['decisionId','frameHash','attackerId','action','piece'].includes(key))||!['p1_win','p2_win','draw'].includes(state.outcome.status)||state.continuation!==null||
  !text(value.decisionId)||typeof value.frameHash!=='string'||!/^[0-9a-f]{64}$/.test(value.frameHash)||!text(value.attackerId))return fail();
 const action=value.action,piece=value.piece;
 if(!record(action)||Object.keys(action).some(key=>!['type','actorId','from','to','targetId'].includes(key))||action.type!=='push'||action.actorId!==value.attackerId||!point(action.from)||!point(action.to))return fail();
 if(!record(piece)||Object.keys(piece).some(key=>!['id','owner','kind','position','supplied','commanded','displaySupplied','displayCommanded','pushed','shifted'].includes(key))||!text(piece.id)||!['P1','P2'].includes(String(piece.owner))||!['unit','commander'].includes(String(piece.kind))||!point(piece.position)||piece.pushed!==true||typeof piece.supplied!=='boolean'||typeof piece.commanded!=='boolean'||!same(action.to,piece.position)||
  (action.targetId!==undefined&&action.targetId!==piece.id))return fail();
 for(const key of ['displaySupplied','displayCommanded','shifted'] as const)if(piece[key]!==undefined&&typeof piece[key]!=='boolean')return fail();
 const attacker=state.pieces.filter(candidate=>candidate.id===value.attackerId);
 if(attacker.length!==1||state.pieces.some(candidate=>candidate.pushed)||state.pieces.filter(candidate=>same(candidate.position,piece.position)).length!==1||attacker[0].pushed||attacker[0].owner===piece.owner||!same(attacker[0].position,piece.position)||state.pieces.some(candidate=>candidate.id===piece.id))return fail();
 return structuredClone(value);
}
