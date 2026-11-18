import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpponentStoryDialog} from '../shell/opponent-stories.js';

// The modal owns native focus. This boundary checks which live Home control
// the actual story controller supplies when the original trigger is gone.
function fixture() {
  const friend = {name:'current Friend'}, babs = {name:'current Babs'};
  const nodes = new Map([
    ['button[data-action="create-game"]',friend],
    ['button[data-opponent="babs"]',babs],
  ]);
  const document = new EventTarget();
  document.querySelector = selector => nodes.get(selector) ?? null;
  const status = {dataset:{},textContent:''};
  const element = new EventTarget();
  element.dataset = {}; element.open = false;
  element.querySelector = selector => selector === '[data-story-readiness]' ? status : null;
  element.querySelectorAll = () => [];
  let resolver, trigger;
  const story = createOpponentStoryDialog({document,
    createModal:({onClose}) => ({element,open(_html,source,resolve) {trigger=source;resolver=resolve;},close(){onClose('dismiss');},destroy(){onClose('dismiss');}}),
    getReadiness:() => ({state:'ready'}),onPlay:() => assert.fail('Opening a story must not start a game')});
  return {story,friend,babs,nodes,get resolver(){return resolver;},get trigger(){return trigger;}};
}

test('Friend introduction resolves the available replacement Home opener',()=>{
  const f=fixture(),old={isConnected:false};
  try {f.story.open('friend',{trigger:old});assert.equal(f.trigger,old);assert.equal(f.resolver(),f.friend);
    f.nodes.clear();assert.equal(f.resolver(),null,'Absent Friend control leaves fallback to the modal');
  } finally {f.story.destroy();}
});
test('computer introduction retains its own replacement opener',()=>{
  const f=fixture();try {f.story.open('babs');assert.equal(f.resolver(),f.babs);}finally {f.story.destroy();}
});
test('revisited stories do not redirect focus to a Home opener',()=>{
  const f=fixture();try {f.story.open('friend',{mode:'revisit'});assert.equal(f.resolver,null);}finally {f.story.destroy();}
});
