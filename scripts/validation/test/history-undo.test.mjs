import test from 'node:test';
import assert from 'node:assert/strict';
import {humanMoveForUndo,assertUndoReceipt,undoBeforeHumanMove} from '../history-undo.mjs';
import {commandFingerprint} from '../../../packages/shared-types/src/sync-protocol.ts';

const state={turnIndex:1,pieces:[{id:'human'}]};
const action={type:'move',from:{row:1,col:1},to:{row:2,col:1}};
const human={moveId:'human-1',action,selectionSnapshot:state};
const computer={moveId:'computer-1',action:{type:'pass'},computerProof:{modelId:'baseline'}};
test('undo selects the unique new human decision, excluding prior, undone and computer entries',()=>{
 const initial={moves:[{moveId:'old'}],board:{state}};
 const accepted={moves:[{moveId:'old'},{moveId:'undone',undone:true},human,computer]};
 assert.equal(humanMoveForUndo(initial,accepted,action),human);
});
for(const mutation of ['missing','ambiguous','wrongAction','wrongSnapshot'])test(`human decision selection rejects ${mutation}`,()=>{
 const moves=mutation==='missing'?[computer]:mutation==='ambiguous'?[human,{...human,moveId:'human-2'},computer]:[{...human,...(mutation==='wrongAction'?{action:{type:'pass'}}:{selectionSnapshot:{turnIndex:2}})},computer];
 assert.throws(()=>humanMoveForUndo({moves:[],board:{state}},{moves},action));
});
async function receipt(shared=true){
 const envelope=shared?{protocolVersion:2,actionContractVersion:2,gameId:'game-1',identityId:'human-account',kind:'shared',clientCommandId:'v2:undo-1',expectedState:{turnIndex:3},expectedGameplayRevision:2,payload:{operation:'revert-request',values:{targetMoveId:'human-1'}}}:{identityId:'human-account',targetMoveId:'human-1'};
 if(shared)envelope.fingerprint=await commandFingerprint(envelope);
 const body={ok:true,autoApproved:true,accepted:true,protocolVersion:2,gameId:'game-1',eventSeq:10,gameplayRevision:2,clientCommandId:envelope.clientCommandId,commandOutcomes:[{gameId:'game-1',identityId:'human-account',clientCommandId:'v2:undo-1',fingerprint:envelope.fingerprint,outcome:'accepted',reason:null,eventSeq:10,gameplayRevision:2}],game:{id:'game-1',lastRestoration:{decisionId:'human-1'},board:{state},moves:[{...human,undone:true},{...computer,undone:true}]}};
 if(shared){delete body.accepted;delete body.clientCommandId;}
 return {envelope,body,expected:{actionContractVersion:2,gameId:'game-1',moveId:'human-1',identityId:'human-account',initialState:state,beforeState:{turnIndex:3},beforeRevision:2}};
}
for(const shared of [false,true])test(`accepted ${shared?'shared receipt':'legacy approval'} restores the exact human decision state`,async()=>{
 const {body,envelope,expected}=await receipt(shared);await assertUndoReceipt(body,envelope,expected);
});
for(const mutation of ['wrongTarget','rejected','missingOwnReceipt','wrongGame','wrongRestoration','wrongState','activeComputerMove','wrongFingerprint','missingFingerprint','wrongIdentity','missingIdentity','wrongRequestIdentity','missingRequestFingerprint','wrongRequestFingerprint','wrongRequestGame','malformedRequestId','wrongActionContract','unverifiedDependency','futureExpectedRevision','payloadAction'])test(`undo receipt rejects ${mutation}`,async()=>{
 const {body,envelope,expected}=await receipt();
 if(mutation==='wrongTarget')envelope.payload.values.targetMoveId='computer-1';
 if(mutation==='rejected')body.commandOutcomes[0].outcome='rejected';
 if(mutation==='missingOwnReceipt')body.commandOutcomes[0].clientCommandId='another-undo';
 if(mutation==='wrongGame')body.game.id='another-game';
 if(mutation==='wrongRestoration')body.game.lastRestoration.decisionId='computer-1';
 if(mutation==='wrongState')body.game.board.state={turnIndex:9};
 if(mutation==='activeComputerMove')body.game.moves[1].undone=false;
 if(mutation==='wrongFingerprint')body.commandOutcomes[0].fingerprint='f'.repeat(64);
 if(mutation==='missingFingerprint')delete body.commandOutcomes[0].fingerprint;
 if(mutation==='wrongIdentity')body.commandOutcomes[0].identityId='another-account';
 if(mutation==='missingIdentity')delete body.commandOutcomes[0].identityId;
 if(mutation==='wrongRequestIdentity')envelope.identityId='another-account';
 if(mutation==='missingRequestFingerprint')delete envelope.fingerprint;
 if(mutation==='wrongRequestFingerprint')envelope.fingerprint='f'.repeat(64);
 if(mutation==='wrongRequestGame')envelope.gameId='another-game';
 if(mutation==='malformedRequestId')envelope.clientCommandId='not-a-v2-command';
 if(mutation==='wrongActionContract')envelope.actionContractVersion=999;
 if(mutation==='unverifiedDependency')envelope.predecessor={clientCommandId:'v2:unverified',fingerprint:'a'.repeat(64)};
 if(mutation==='futureExpectedRevision')envelope.expectedGameplayRevision=expected.beforeRevision+1;
 if(mutation==='payloadAction')envelope.payload.action={type:'pass'};
 if(['wrongActionContract','unverifiedDependency','futureExpectedRevision','payloadAction'].includes(mutation)){
  envelope.fingerprint=await commandFingerprint(envelope);
  // Keep the hypothetical accepted reply internally consistent. The unsafe
  // intent must fail its admission guard, not an unrelated receipt mismatch.
  body.commandOutcomes[0].fingerprint=envelope.fingerprint;
  if(mutation==='futureExpectedRevision'){
   body.gameplayRevision=envelope.expectedGameplayRevision;
   body.commandOutcomes[0].gameplayRevision=envelope.expectedGameplayRevision;
   body.game.gameplayRevision=envelope.expectedGameplayRevision;
  }
 }
 await assert.rejects(()=>assertUndoReceipt(body,envelope,expected));
});


test('undo requires its explicit supported source label before any browser activity',async()=>{
 for(const undoLabel of [undefined,'','Undo anything'])await assert.rejects(()=>undoBeforeHumanMove(null,{undoLabel,actionContractVersion:2}),/explicit supported source-selected undo label/);
});

for(const version of [2,3,null])test(`undo validates exact source-selected action version ${version}`,async()=>{
 const {body,envelope,expected}=await receipt();
 expected.actionContractVersion=version;
 if(version===null)delete envelope.actionContractVersion;else envelope.actionContractVersion=version;
 envelope.fingerprint=await commandFingerprint(envelope);body.commandOutcomes[0].fingerprint=envelope.fingerprint;
 await assertUndoReceipt(body,envelope,expected);
 for(const mismatch of [undefined,null,2,3,999].filter(value=>value!==(version===null?undefined:version))){
  if(mismatch===undefined)delete envelope.actionContractVersion;else envelope.actionContractVersion=mismatch;
  envelope.fingerprint=await commandFingerprint(envelope);body.commandOutcomes[0].fingerprint=envelope.fingerprint;
  await assert.rejects(()=>assertUndoReceipt(body,envelope,expected));
 }
});
test('undo requires source-selected action version before browser activity',async()=>{
 for(const actionContractVersion of [undefined,1,999,'3'])await assert.rejects(()=>undoBeforeHumanMove(null,{undoLabel:'Undo before this move',actionContractVersion}),/explicit supported source-selected action version/);
});
