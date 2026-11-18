import test from 'node:test';
import assert from 'node:assert/strict';
import {createBoardRuntime} from '../board/runtime/board-runtime.js';
import {renderBoardMessageHtml} from '../board/message-presentation.js';

test('prepared action grammar starts directly with the capitalized action',()=>{
 const runtime=createBoardRuntime({boardAdapter:{},host:{}});
 const cases=[['rush',{type:'rush'},'Continue rush on'],['follow',{type:'push'},'Continue push on'],['move',null,'Move commander to'],['project',null,'Project new piece to'],['rush',null,'Rush piece to'],['push',null,'Push piece onto'],['follow',null,'Follow piece to'],['retreat',null,'Retreat piece to'],['unknown',null,'Move to']];
 for(const [type,continuation,expected] of cases){
  assert.equal(runtime.actionPreviewLabel(type,{continuation},{row:4,col:3}),expected+' (4,3)');
  assert.equal(runtime.actionPreviewLabel(type,{continuation},null),expected);
 }
});

test('structured prepared action has no implicit Confirm prefix and retains chips and explanation',()=>{
 const message={confirmation:{text:'Project new piece to',point:{row:4,col:3}},after:'More rushes are needed to restore supply.',detail:{text:'Choose another rush.'}},before=structuredClone(message);
 const html=renderBoardMessageHtml(message);
 assert.match(html,/^<strong>Project new piece to /);
 assert.match(html,/>4, 3<\/span><\/strong> More rushes are needed to restore supply\./);
 assert.match(html,/data-board-message-action="toggle-board-explanation"/);
 assert.doesNotMatch(html,/Confirm/);assert.deepEqual(message,before);
});
