import assert from 'node:assert/strict';

// An existing computer owner renews its lease independently every few seconds.
// Replay may overlap that timer, but must never submit gameplay, evidence or
// any acquire/switch/pause/resume/control operation of its own.
export function assertReplayIntegrity({writes,before,after}) {
  for(const write of writes){
    assert.equal(write.method,'POST');
    assert.equal(write.path,`/api/shell/games/${before.id}/computer-control`);
    assert.deepEqual(Object.keys(write.body??{}).sort(),['action','deviceId','generation','identityId','protocolVersion']);
    assert.equal(write.body.action,'renew');
    assert.equal(write.body.identityId,before.computer.ownerId);
    assert.ok(before.computer.ownerId && before.computer.lease?.deviceId);
    assert.equal(write.body.deviceId,before.computer.lease.deviceId);
    assert.equal(write.body.generation,before.computer.generation);
    assert.equal(write.body.protocolVersion,2);
  }
  assert.equal(after.gameplayRevision,before.gameplayRevision);
  assert.deepEqual(after.moves.map(move=>({moveId:move.moveId,undone:move.undone})),before.moves.map(move=>({moveId:move.moveId,undone:move.undone})));
  assert.deepEqual(after.board.state,before.board.state);
  for(const key of ['ownerId','generation','seats','paused','manual','takeoverTurn'])assert.deepEqual(after.computer[key],before.computer[key]);
  assert.equal(after.computer.lease?.deviceId,before.computer.lease?.deviceId);
}
