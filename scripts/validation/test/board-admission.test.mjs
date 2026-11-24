import test from 'node:test';
import assert from 'node:assert/strict';
import {readPlayableBoardAdmission} from '../board-admission.mjs';

function admission({phase='idle',reconnecting='false',loading='idle',busy=null,pending=false,missing}={}) {
  const element=attributes=>({getAttribute:name=>attributes[name]??null,hasAttribute:name=>Object.hasOwn(attributes,name)});
  const app=element({'data-shell-transition-phase':phase});
  const board=element({'data-reconnecting':reconnecting,'data-loading-state':loading,'aria-busy':busy,...(pending?{'data-board-pending':''}:{})});
  const previous=globalThis.document;
  globalThis.document={querySelector:selector=>selector==='#app'?(missing==='app'?null:app):(missing==='board'?null:board)};
  try{return readPlayableBoardAdmission();}
  finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
}

test('a settled board admits both supported idle accessibility representations',()=>{
  assert.equal(admission({busy:'false'}),true);
  assert.equal(admission({busy:null}),true);
});
test('active feedback or recovery blocks play even if the other markers are idle',()=>{
  for(const state of [{busy:'true'},{busy:'unknown'},{pending:true},{pending:true,busy:'false'},{reconnecting:'true'},{loading:'pending'}])assert.equal(admission(state),false);
});
test('entry transitions and missing affirmative recovery/loading markers block play',()=>{
  for(const state of [{phase:'entering'},{phase:null},{reconnecting:null},{loading:null},{missing:'app'},{missing:'board'}])assert.equal(admission(state),false);
});
