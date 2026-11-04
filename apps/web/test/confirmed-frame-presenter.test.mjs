import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfirmedFramePresenter} from '../shell/confirmed-frame-presenter.js';
import {createConfirmedComputerPlayback} from '../shell/confirmed-computer-playback.js';
const frame={moveId:'m',computerProof:{},action:{type:'move'},selectionSnapshot:{pieces:[]},snapshot:{pieces:[]}};
test('replay error finish cannot resolve a failed confirmed frame before play rejects',async()=>{
 let tries=0;const presenter=createConfirmedFramePresenter({getRoot:()=>({}),getGameId:()=> 'g',createReplay:({onFinish})=>({destroy(){},stop(){},async play(){if(!tries++){onFinish({reason:'error'});throw Error('render_failed');}onFinish({reason:'completed'});}})});
 const queue=createConfirmedComputerPlayback({present:presenter.present});const game={id:'g',board:{state:{pieces:[]}},moves:[]};queue.observe(game,{scope:'owner'});queue.observe({...game,moves:[frame]},{scope:'owner'});await new Promise(resolve=>setImmediate(resolve));
 assert.match(queue.snapshot().error.message,/confirmed_presentation_error/);assert.equal(queue.snapshot().current.move.moveId,'m');assert.equal(queue.snapshot().displayed.moves.length,0);queue.retry();await new Promise(resolve=>setImmediate(resolve));assert.equal(queue.snapshot().error,null);assert.equal(queue.snapshot().displayed.moves[0].moveId,'m');
});
