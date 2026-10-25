import assert from 'node:assert/strict';
import {isSyncCommand,commandFingerprint} from '../../apps/web/generated/packages/shared-types/src/sync-protocol.js';

const authScope = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const assertRenewalValues = (values,before,{legacy=false}={}) => {
  const tabBound=Object.hasOwn(before.computer.lease,'tabId');
  assert.deepEqual(Object.keys(values??{}).sort(),['action','deviceId','generation','identityId',...(legacy?['protocolVersion']:[]),...(tabBound?['tabId']:[])].sort());
  assert.equal(values.action,'renew');
  assert.equal(values.identityId,before.computer.ownerId);
  assert.equal(values.deviceId,before.computer.lease.deviceId);
  assert.equal(values.generation,before.computer.generation);
  if(legacy)assert.equal(values.protocolVersion,2);
  if(tabBound)assert.equal(values.tabId,before.computer.lease.tabId);
};

// An existing computer owner renews its lease independently every few seconds.
// Replay may overlap that timer, but must never submit gameplay, evidence or
// any acquire/switch/pause/resume/control operation of its own.
export async function assertReplayIntegrity({writes,before,after}) {
  for(const write of writes){
    assert.equal(write.method,'POST');
    assert.ok(before.computer.ownerId && before.computer.lease?.deviceId);
    if(write.path===`/api/shell/games/${before.id}/computer-control`){
      // Legacy guest renewals have no durable auth-context field. A bound
      // authenticated lease must prove that context through its envelope.
      assert.ok(!authScope(before.computer.lease.authContextId));
      assertRenewalValues(write.body,before,{legacy:true});
      continue;
    }
    assert.equal(write.path,`/api/shell/games/${before.id}/shared`);
    const envelope=write.body;
    assert.equal(isSyncCommand(envelope),true);
    assert.deepEqual(Object.keys(envelope).sort(),['protocolVersion','gameId','identityId','clientCommandId','submittedAt','kind','payload','expectedState','expectedGameplayRevision','fingerprint',...(Object.hasOwn(envelope,'authContextId')?['authContextId']:[])].sort());
    assert.equal(Number.isFinite(envelope.submittedAt),true);
    assert.equal(envelope.kind,'shared');
    assert.equal(envelope.gameId,before.id);
    assert.equal(envelope.identityId,before.computer.ownerId);
    assert.deepEqual(Object.keys(envelope.payload).sort(),['operation','values']);
    assert.equal(envelope.payload.operation,'computer-control');
    assertRenewalValues(envelope.payload.values,before);
    assert.deepEqual(envelope.expectedState,before.board.state);
    assert.equal(envelope.expectedGameplayRevision,before.gameplayRevision);
    if(Object.hasOwn(envelope,'authContextId')||authScope(before.computer.lease.authContextId))assert.equal(envelope.authContextId,before.computer.lease.authContextId);
    assert.equal(envelope.fingerprint,await commandFingerprint(envelope));
  }
  assert.equal(after.id,before.id);
  assert.equal(after.gameplayRevision,before.gameplayRevision);
  assert.deepEqual(after.moves.map(move=>({moveId:move.moveId,undone:move.undone})),before.moves.map(move=>({moveId:move.moveId,undone:move.undone})));
  assert.deepEqual(after.board.state,before.board.state);
  for(const key of ['ownerId','generation','seats','paused','manual','takeoverTurn'])assert.deepEqual(after.computer[key],before.computer[key]);
  for(const key of ['deviceId','authContextId','tabId'])assert.equal(after.computer.lease?.[key],before.computer.lease?.[key]);
  const withoutExpiry=computer=>{const copy=structuredClone(computer);if(copy.lease)delete copy.lease.expiresAt;return copy;};
  assert.deepEqual(withoutExpiry(after.computer),withoutExpiry(before.computer));
}
