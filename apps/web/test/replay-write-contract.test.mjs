import test from 'node:test';
import assert from 'node:assert/strict';
import {assertReplayIntegrity} from '../../../e2e/support/replay-write-contract.mjs';
const before={id:'g',gameplayRevision:3,moves:[{moveId:'m',undone:false}],board:{state:{sideToMove:'P1'}},computer:{ownerId:'owner',generation:2,seats:{p1:null,p2:'babs'},paused:false,manual:false,takeoverTurn:null,lease:{deviceId:'device',expiresAt:0}}};
const renewal={method:'POST',path:'/api/shell/games/g/computer-control',body:{action:'renew',identityId:'owner',deviceId:'device',generation:2,protocolVersion:2}};
test('replay permits only an existing owner lease renewal while preserving gameplay and control',()=>{
 const after=structuredClone(before);after.computer.lease.expiresAt=30000;
 assertReplayIntegrity({writes:[renewal],before,after});
 assertReplayIntegrity({writes:[],before,after});
});
for(const change of [write=>write.body.action='pause',write=>write.path='/api/shell/games/g/apply',write=>write.path='/api/shell/games/g/decision-attempt',write=>write.path='/api/shell/games/other/computer-control',write=>write.body.identityId='other',write=>write.body.deviceId='other',write=>write.body.generation=3,write=>write.body.payload={action:{type:'pass'}}])test(`replay rejects mutated write contract ${change}`,()=>{
 const write=structuredClone(renewal);change(write);assert.throws(()=>assertReplayIntegrity({writes:[write],before,after:structuredClone(before)}));
});
for(const change of [game=>game.gameplayRevision++,game=>game.moves[0].undone=true,game=>game.board.state.sideToMove='P2',game=>game.computer.paused=true,game=>game.computer.lease.deviceId='other'])test(`replay rejects authoritative mutation ${change}`,()=>{
 const after=structuredClone(before);change(after);assert.throws(()=>assertReplayIntegrity({writes:[renewal],before,after}));
});
