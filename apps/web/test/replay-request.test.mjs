import test from 'node:test';
import assert from 'node:assert/strict';
import {createReplayRequest} from '../shell/replay-request.js';
const context = () => ({owner:{},scope:'account',gameId:'game',revision:2,lineageHead:'move',visible:true});

test('deferred archive reads cannot resurrect playback or errors after cancellation', async () => {
  for(const change of ['selection','navigation','background','revision','scope','owner','lineageHead']) {
    const state=createReplayRequest(), before=context(),token=state.begin(before);
    let finish;const archived=new Promise(resolve=>{finish=resolve;});
    let now={...before},played=0;
    const pending=archived.then(()=>{if(state.ready(token,now))played++;},()=>state.fail(token,now));
    if(change==='selection'||change==='navigation')state.cancel();
    else {now={...now,[change==='background'?'visible':change]:change==='background'?false:'new'};state.reconcile(now);}
    finish();await pending;
    assert.equal(played,0,change);assert.equal(state.snapshot(),null,change);
    assert.equal(state.fail(token,now),false,change);
  }
});
test('error feedback clears on a live move and replacements own their result', () => {
  const state=createReplayRequest(),before=context(),first=state.begin(before);
  assert.equal(state.fail(first,before),true);assert.equal(state.snapshot().phase,'error');
  state.reconcile({...before,revision:3});assert.equal(state.snapshot(),null);
  const second=state.begin(before);assert.equal(state.fail(first,before),false);
  assert.equal(state.ready(second,before),true);assert.equal(state.snapshot(),null);
});
test('a rejected deferred archive read stays quiet after the user moves on', async () => {
  const state=createReplayRequest(),before=context(),token=state.begin(before);
  let reject;const pending=new Promise((_,no)=>{reject=no;}).catch(()=>state.fail(token,before));
  state.cancel();reject(Error('offline'));assert.equal(await pending,false);assert.equal(state.snapshot(),null);
});
