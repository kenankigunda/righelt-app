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
  const status = {dataset:{},textContent:''},result={hidden:true},results=[];
  const element = new EventTarget();
  element.dataset = {}; element.open = false;
  element.querySelector = selector => selector === '[data-story-readiness]' ? status : selector === '[data-story-result]' ? result : null;
  element.querySelectorAll = () => [];
  let resolver, trigger;
  const story = createOpponentStoryDialog({document,
    createModal:({onClose}) => ({element,open(_html,source,resolve) {element.open=true;trigger=source;resolver=resolve;},close(){element.open=false;onClose('dismiss');},destroy(){element.open=false;onClose('dismiss');}}),
    getReadiness:() => ({state:'ready'}),onViewResult:id=>results.push(id),onPlay:() => assert.fail('Opening a story must not start a game')});
  return {story,friend,babs,nodes,element,status,result,results,get resolver(){return resolver;},get trigger(){return trigger;}};
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

test('revisit refresh retains current match status and its result action uses the captured game',()=>{
 const f=fixture();
 try {
  f.story.open('babs',{mode:'revisit',gameId:'current-match'});
  f.story.setMatchStatus('Making their move');f.story.refresh();
  assert.equal(f.status.textContent,'Making their move');assert.equal(f.result.hidden,true);
  f.story.setMatchStatus('Game finished',true);f.story.refresh();
  assert.equal(f.status.textContent,'Game finished');assert.equal(f.result.hidden,false);
  const event=new Event('click');Object.defineProperty(event,'target',{value:{closest:selector=>selector==='[data-story-result]'?{}:null}});
  f.element.dispatchEvent(event);assert.deepEqual(f.results,['current-match']);assert.equal(f.element.open,false);
 } finally {f.story.destroy();}
});

test('retired revisit scope closes without publishing stale status or a result action',()=>{
 const f=fixture();let current=true;
 try {
  f.story.open('babs',{mode:'revisit',gameId:'old-match',isCurrent:()=>current});
  f.story.setMatchStatus('Waiting for a turn');current=false;
  f.story.setMatchStatus('Game finished',true);assert.equal(f.status.textContent,'Waiting for a turn');
  f.story.refresh();assert.equal(f.element.open,false);
  const event=new Event('click');Object.defineProperty(event,'target',{value:{closest:()=>({})}});
  f.element.dispatchEvent(event);assert.deepEqual(f.results,[]);
 } finally {f.story.destroy();}
});
