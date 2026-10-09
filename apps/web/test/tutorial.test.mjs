import test from 'node:test';
import assert from 'node:assert/strict';
import {createTutorialController,TUTORIAL_TIMING} from '../shell/tutorial.js';
import {TUTORIAL_CHAPTERS} from '../shell/tutorial-lessons.js';
import {needsTutorial,readTutorialProgress} from '../shell/tutorial-progress.js';
import {createTutorialBoardHost} from '../board/hosts/tutorial-host.js';
import {validateAction} from '../generated/packages/game-engine/src/legal.js';
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)};};
const clock=()=>{let now=0,id=0;const tasks=new Map();return {setTimeout(fn,ms){tasks.set(++id,{fn,at:now+ms});return id;},clearTimeout(id){tasks.delete(id);},tick(ms){const end=now+ms;while(true){const next=[...tasks].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;tasks.delete(next[0]);next[1].fn();}now=end;},size:()=>tasks.size};};
const solve=c=>{const e=c.current().exercise;if(e.action)return c.handleAction(e.action);if(e.endTurn)return c.handleEndTurn();return c.inspect({selectedPieceId:e.inspect,overlay:{phase:'supplyCommand'}});};
test('unrelated actions and stale boards are rejected without modifying state',async()=>{
 const c=createTutorialController({timers:clock()});c.start();c.next();const host=createTutorialBoardHost(c),before=structuredClone(c.current().state);
 assert.equal((await host.applyAction(before,{type:'pass'})).accepted,false);assert.deepEqual(c.current().state,before);
 assert.equal((await host.applyAction({...before,turnIndex:99},{type:'pass'})).accepted,false);c.destroy();
});
test('hint and skip timers reset on interaction, pause while hidden, and retire on destroy',()=>{
 const timers=clock(),c=createTutorialController({timers});c.start();timers.tick(3999);assert.equal(c.current().hint,false);timers.tick(1);assert.equal(c.current().hint,true);
 c.activity();timers.tick(3000);assert.equal(c.current().hint,false);c.pause();timers.tick(10000);assert.equal(c.current().skipAvailable,false);c.resume();timers.tick(7000);assert.equal(c.current().skipAvailable,true);c.skip();assert.equal(c.current().phase,'success');c.destroy();assert.equal(timers.size(),0);
});
test('automatic progress pauses at meaningful outcomes and chapter boundaries',()=>{
 const timers=clock(),c=createTutorialController({timers});c.start();solve(c);timers.tick(TUTORIAL_TIMING.advance);assert.equal(c.current().exercise.id,'move');solve(c);timers.tick(TUTORIAL_TIMING.advance);solve(c);timers.tick(10000);assert.equal(c.current().exercise.id,'project');assert.equal(c.current().phase,'success');c.next();assert.equal(c.current().chapter,1);assert.equal(c.selectChapter(0),true);assert.equal(c.selectChapter(1),true);assert.equal(c.selectChapter(2),false);c.destroy();
});
test('chapter resume, replay and host choice preserve guided navigation',()=>{
 const store=storage(),c=createTutorialController({storage:store,timers:clock()});c.start();assert.equal(c.current().host,'horus');assert.equal(c.selectChapter(3),false);
 for(let i=0;i<3;i++){solve(c);c.next();}assert.equal(c.current().chapter,1);c.destroy();
 const resumed=createTutorialController({storage:store,timers:clock()});resumed.start();assert.equal(resumed.current().chapter,1);assert.equal(resumed.current().index,0);resumed.start({replay:true,host:'tau'});assert.equal(resumed.selectChapter(4),true);assert.equal(resumed.current().host,'tau');resumed.destroy();
});
test('completion is not granted prematurely; skip survives denied storage',()=>{
 const c=createTutorialController({storage:{getItem(){throw Error();},setItem(){throw Error();}},timers:clock()});c.start();assert.equal(c.finish(),false);assert.equal(c.finish('skipped'),true);assert.equal(c.current().progress.result,'skipped');c.destroy();
});
test('account state owns automatic entry and device state owns signed-out entry',()=>{
 assert.equal(needsTutorial({account:{preferences:{tutorial:'new'}},progress:{result:'completed'}}),true);
 assert.equal(needsTutorial({account:{preferences:{tutorial:'completed'}},progress:{result:null}}),false);
 assert.equal(needsTutorial({progress:{result:'skipped'}}),false);
 assert.deepEqual(readTutorialProgress({getItem:()=>'{bad'}),{completed:[],result:null});
});
