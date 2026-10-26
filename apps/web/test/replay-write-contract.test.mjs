import test from 'node:test';
import assert from 'node:assert/strict';
import {assertReplayIntegrity} from '../../../e2e/support/replay-write-contract.mjs';
import {commandFingerprint} from '../generated/packages/shared-types/src/sync-protocol.js';
const before={id:'g',gameplayRevision:3,moves:[{moveId:'m',undone:false}],board:{state:{sideToMove:'P1'}},computer:{ownerId:'owner',generation:2,seats:{p1:null,p2:'babs'},paused:false,manual:false,takeoverTurn:null,lease:{deviceId:'device',expiresAt:0}}};
const renewal={method:'POST',path:'/api/shell/games/g/computer-control',body:{action:'renew',identityId:'owner',deviceId:'device',generation:2,protocolVersion:2}};
const resign=async write=>{write.body.fingerprint=await commandFingerprint(write.body);return write;};
async function sharedRenewal(game=before){
 const body={protocolVersion:2,gameId:game.id,identityId:game.computer.ownerId,clientCommandId:'v2:renewal',submittedAt:100,kind:'shared',
  payload:{operation:'computer-control',values:{action:'renew',identityId:game.computer.ownerId,deviceId:game.computer.lease.deviceId,generation:game.computer.generation,...(Object.hasOwn(game.computer.lease,'tabId')?{tabId:game.computer.lease.tabId}:{})}},
  expectedState:structuredClone(game.board.state),expectedGameplayRevision:game.gameplayRevision,
  ...(/^[a-f0-9]{64}$/.test(game.computer.lease.authContextId??'')?{authContextId:game.computer.lease.authContextId}:{})};
 return resign({method:'POST',path:`/api/shell/games/${game.id}/shared`,body});
}
test('replay permits only an existing legacy or durable owner renewal while preserving gameplay and control',async()=>{
 const after=structuredClone(before);after.computer.lease.expiresAt=30000;
 await assertReplayIntegrity({writes:[renewal],before,after});
 await assertReplayIntegrity({writes:[await sharedRenewal()],before,after});
 await assertReplayIntegrity({writes:[],before,after});
});
for(const change of [write=>write.body.action='pause',write=>write.path='/api/shell/games/g/apply',write=>write.path='/api/shell/games/g/decision-attempt',write=>write.path='/api/shell/games/other/computer-control',write=>write.body.identityId='other',write=>write.body.deviceId='other',write=>write.body.generation=3,write=>write.body.payload={action:{type:'pass'}}])test(`replay rejects mutated legacy write contract ${change}`,async()=>{
 const write=structuredClone(renewal);change(write);await assert.rejects(assertReplayIntegrity({writes:[write],before,after:structuredClone(before)}));
});
const sharedMutations=[
 ['method',write=>write.method='PUT'],['route',write=>write.path='/api/shell/games/g/apply'],['foreignroute',write=>write.path='/api/shell/games/other/shared'],
 ['operation',write=>write.body.payload.operation='decision-attempt'],['applyoperation',write=>write.body.payload.operation='apply'],['kind',write=>write.body.kind='action'],
 ...['acquire','switch','pause','resume','release','takeover','step'].map(action=>[action,write=>write.body.payload.values.action=action]),
 ['game',write=>write.body.gameId='other'],['owner',write=>write.body.identityId='other'],['innerowner',write=>write.body.payload.values.identityId='other'],
 ['device',write=>write.body.payload.values.deviceId='other'],['generation',write=>write.body.payload.values.generation=3],
 ['state',write=>write.body.expectedState.sideToMove='P2'],['revision',write=>write.body.expectedGameplayRevision++],
 ['gameplaypayload',write=>write.body.payload.action={type:'pass'}],['evidencevalues',write=>write.body.payload.values.computer={proof:'unexpected'}],
 ['extraouterfield',write=>write.body.unrelated=true],['legacyprotocolinsidevalues',write=>write.body.payload.values.protocolVersion=2],
 ['protocol',write=>write.body.protocolVersion=1],['commandid',write=>write.body.clientCommandId='invalid'],['submittedAt',write=>write.body.submittedAt='100'],
 ['unexpectedauth',write=>write.body.authContextId='b'.repeat(64)],['unexpectedtab',write=>write.body.payload.values.tabId='other'],
];
for(const [name,change] of sharedMutations)test(`replay rejects correctly fingerprinted malicious shared renewal: ${name}`,async()=>{
 const write=await sharedRenewal();change(write);await resign(write);
 await assert.rejects(assertReplayIntegrity({writes:[write],before,after:structuredClone(before)}));
});
test('replay rejects stale fingerprints even when all renewal semantics match',async()=>{
 const write=await sharedRenewal();write.body.fingerprint='0'.repeat(64);
 await assert.rejects(assertReplayIntegrity({writes:[write],before,after:structuredClone(before)}));
});
test('authenticated and tab-bound renewals require their existing exact lease scope',async()=>{
 const scoped=structuredClone(before);Object.assign(scoped.computer.lease,{authContextId:'a'.repeat(64),tabId:'tab-1'});
 const write=await sharedRenewal(scoped);await assertReplayIntegrity({writes:[write],before:scoped,after:structuredClone(scoped)});
 for(const change of [write=>delete write.body.authContextId,write=>write.body.authContextId='b'.repeat(64),write=>delete write.body.payload.values.tabId,write=>write.body.payload.values.tabId='tab-2']){
  const changed=structuredClone(write);change(changed);await resign(changed);
  await assert.rejects(assertReplayIntegrity({writes:[changed],before:scoped,after:structuredClone(scoped)}));
 }
 await assert.rejects(assertReplayIntegrity({writes:[renewal],before:scoped,after:structuredClone(scoped)}));
});
for(const change of [game=>game.id='other',game=>game.computer.modelId='other',game=>game.computer.singleStep=true,game=>game.computer.declinedModelId='other',game=>game.gameplayRevision++,game=>game.moves[0].undone=true,game=>game.board.state.sideToMove='P2',game=>game.computer.ownerId='other',game=>game.computer.generation++,game=>game.computer.seats.p1='horus',game=>game.computer.paused=true,game=>game.computer.manual=true,game=>game.computer.takeoverTurn=1,game=>game.computer.lease.deviceId='other',game=>game.computer.lease.authContextId='other',game=>game.computer.lease.tabId='other'])test(`replay rejects authoritative mutation ${change}`,async()=>{
 const after=structuredClone(before);change(after);await assert.rejects(assertReplayIntegrity({writes:[await sharedRenewal()],before,after}));
});
