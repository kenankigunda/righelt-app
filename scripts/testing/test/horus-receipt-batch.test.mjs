import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../../e2e/workflows/game-loading-follow.spec.mjs', import.meta.url), 'utf8');
const start = source.indexOf('const acceptedReceipt = '), end = source.indexOf('const resumeHere = ', start);
assert(start >= 0 && end > start);
const command = { gameId:'g', identityId:'i', clientCommandId:'new', fingerprint:'new-fp' };
const old = { ...command, clientCommandId:'old', fingerprint:'old-fp' };
const receipt = (c, outcome='accepted', reason=null) => ({ ...c, outcome, reason });
const response = outcomes => ({ gameId:'g', game:{ id:'g' }, commandOutcomes:outcomes });
function harness(responses) {
  const requests=[]; let callbacks=0, policy;
  const expect = value => ({
    toBe: expected => assert.equal(value,expected),
    toHaveLength: expected => assert.equal(value.length,expected),
    toMatchObject: expected => { for (const [k,v] of Object.entries(expected)) assert.deepEqual(value[k],v); },
  });
  expect.poll = (callback, options) => { policy=options; return { async toBe(expected) {
    for (const value of responses) { current=value; callbacks++; if (await callback() === expected) return; }
    assert.fail('bounded controlled responses never accepted');
  } }; };
  let current;
  const guestRequest = async (_page, route, body) => { requests.push({route,body}); return current; };
  const invoke = new Function('expect','guestRequest',source.slice(start,end)+'; return acceptedReceipt;')(expect,guestRequest);
  return { invoke, requests, get callbacks(){return callbacks;}, get policy(){return policy;} };
}
test('actual helper retains original single-command request and30000 policy', async()=>{
 const h=harness([response([receipt(command)])]); await h.invoke({},command);
 assert.deepEqual(h.requests[0].body,{knownSnapshotEventSeq:0,commands:[command]}); assert.equal(h.policy.timeout,30000);
});
test('actual batch helper accepts reversed exact outcomes using one request',async()=>{
 const value=response([receipt(old),receipt(command)]),h=harness([value]);
 assert.equal(await h.invoke({},command,old),value); assert.equal(h.requests.length,1);
 assert.deepEqual(h.requests[0].body.commands,[command,old]);
});
for (const [label,outcomes] of [
 ['missing',[receipt(command)]],['duplicate',[receipt(command),receipt(command)]],
 ['foreign identity',[receipt(command),{...receipt(old),identityId:'foreign'}]],
 ['wrong fingerprint',[receipt(command),{...receipt(old),fingerprint:'wrong'}]],
 ['extra',[receipt(command),receipt(old),receipt({...old,clientCommandId:'extra'})]],
]) test('actual batch helper rejects '+label,async()=>{
 const h=harness([response(outcomes)]); await assert.rejects(h.invoke({},command,old));
});
test('actual helper polls unknown new receipt but returns accepted batch snapshot',async()=>{
 const first=response([receipt(command,'unknown','not_recorded'),receipt(old)]),last=response([receipt(old),receipt(command)]);
 const h=harness([first,last]); assert.equal(await h.invoke({},command,old),last); assert.equal(h.callbacks,2);
});
test('actual helper retains rejected and malformed outcome failures',async()=>{
 for(const [outcome,reason] of [['rejected','conflict'],['strange',null],['unknown','bad_reason']]){
 const h=harness([response([receipt(command,outcome,reason),receipt(old)])]);await assert.rejects(h.invoke({},command,old)); }
});
test('phase2 retains old receipt and move checks after accepted batch and final old journal poll',()=>{
 const begin=source.indexOf('  const laterCommand = '),end=source.indexOf('// Required continuation',begin),body=source.slice(begin,end);
 assert(body.includes('acceptedReceipt(page, laterCommand, command)'));
 assert(body.includes('expect(later.commandOutcomes.filter(outcome => outcome.clientCommandId === command.clientCommandId)).toEqual([originalReceipt])'));
 assert(body.includes('expect(later.game.moves.filter(move => move.clientCommandId === command.clientCommandId)).toHaveLength(1)'));
 assert(body.includes('await expect.poll(() => journalEntry(page, command)).toBeNull()'));
 assert(!body.includes('await guestRequest('));
});
