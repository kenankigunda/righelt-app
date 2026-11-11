import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationPaper,paperInformationEligible,paperFrame,paperPolygon,PAPER_TIMING} from '../shell/notification-paper.js';
import {patchNotificationTree} from '../shell/notification-dom.js';
import {PaperNode,paperCard,paperDocument} from './fixtures/paper-dom.mjs';
const fixture=()=>{
 const document=paperDocument(),frames=new Map(),sounds=[];let time=0,id=0,reduced=false,active=true,scope='account:g';
 const controller=createNotificationPaper({document,scope:()=>scope,reduced:()=>reduced,active:()=>active,now:()=>time,requestFrame:fn=>{frames.set(++id,fn);return id;},cancelFrame:key=>frames.delete(key),sound:{paper:(...args)=>sounds.push(args),cancelPaper:()=>sounds.push(['cancel'])}});
 const patch=cards=>{const next=new PaperNode('div',{id:'shell-game-alerts'});next.append(...cards);controller.captureBeforePatch?.();patchNotificationTree(document.region,next);controller.sync();};
 controller.sync();
 return{document,controller,frames,sounds,patch,tick:ms=>{time+=ms;const work=[...frames.values()];frames.clear();work.forEach(fn=>fn(time));},now:()=>time,setReduced:v=>reduced=v,setActive:v=>active=v,setScope:v=>scope=v};
};
test('information eligibility is independent of visual reduction and narrowly source-kind based',()=>{
 for(const kind of ['history-change','undo-outcome'])assert.equal(paperInformationEligible({kind}),true);
 for(const patch of [{kind:'arbitrary'},{kind:'board-context'},{priority:'urgent'},{tone:'danger'},{tone:'warn'},{activity:'processing'},{activity:'waiting'},{count:2},{active:false},{interactive:true},{focused:true}])assert.equal(paperInformationEligible({kind:'history-change',...patch}),false,JSON.stringify(patch));
});
test('actual keyed patch retains incident, content and finite phase through same-key updates',()=>{
 const f=fixture();f.patch([paperCard()]);const card=f.document.region.children[0],paper=card.querySelector('.shell-game-alert'),copy=paper.querySelector('.shell-game-alert-copy');
 assert.equal(f.sounds.filter(s=>s[0]==='enter').length,1);assert.notEqual(paper.style.clipPath,'none');f.tick(250);const midway=paper.style.clipPath;
 f.patch([paperCard({copy:'Updated same incident'})]);assert.equal(f.document.region.children[0],card);assert.equal(paper.querySelector('.shell-game-alert-copy'),copy);assert.equal(copy.textContent,'Updated same incident');assert.equal(paper.style.clipPath,midway);assert.equal(f.sounds.filter(s=>s[0]==='enter').length,1);
 f.tick(300);assert.equal(f.frames.size,0);assert.equal(paper.style.clipPath,undefined);
});
for(const patch of [{tone:'warn'},{tone:'danger'},{priority:'urgent'},{action:true},{details:true},{count:2},{activity:'processing'},{kind:'board-context'}])test(`real immediate card stays full-open and audio-ineligible ${JSON.stringify(patch)}`,()=>{
 const f=fixture();f.patch([paperCard(patch)]);const paper=f.document.region.children[0].querySelector('.shell-game-alert');assert.equal(paper.style.clipPath,undefined);assert.equal(f.frames.size,0);assert.equal(f.sounds.filter(s=>s[0]==='enter').length,0);
});
test('actual patch inserts actionable escalation fully open before its first input; original control survives next patch',()=>{
 const f=fixture();f.patch([paperCard()]);f.tick(180);f.patch([paperCard({priority:'urgent',action:true})]);
 const card=f.document.region.children[0],paper=card.querySelector('.shell-game-alert'),button=paper.querySelector('button');let actions=0;button.addEventListener('click',()=>actions++);
 assert.equal(paper.style.clipPath,undefined);assert.equal(button.hasAttribute('inert'),false);assert.equal(button.hasAttribute('aria-hidden'),false);button.click();assert.equal(actions,1);
 f.document.activeElement=button;f.patch([paperCard({priority:'urgent',action:true,copy:'Still current'})]);assert.equal(card.querySelector('button'),button);assert.equal(f.document.activeElement,button);button.click();assert.equal(actions,2);assert.ok(f.sounds.some(s=>s[0]==='cancel'));
});
test('reduced-motion eligible logical entry AND retirement cue independently without frames or exit paint',()=>{
 const f=fixture();f.setReduced(true);f.patch([paperCard({kind:'undo-outcome'})]);assert.deepEqual(f.sounds.filter(s=>s[0]!=='cancel').map(s=>s[0]),['enter']);assert.equal(f.frames.size,0);
 f.patch([]);assert.deepEqual(f.sounds.filter(s=>s[0]!=='cancel').map(s=>s[0]),['enter','retire']);assert.equal(f.document.body.children.length,1);assert.equal(f.frames.size,0);
});
test('retirement removes actual semantics immediately, retaining at most one inert metadata-free decorative exit',()=>{
 const f=fixture();f.patch([paperCard()]);f.tick(500);f.patch([]);assert.equal(f.document.region.children.length,0);assert.equal(f.document.body.children.length,2);
 const exit=f.document.body.children[1];assert.equal(exit.inert,true);assert.equal(exit.getAttribute('aria-hidden'),'true');assert.equal(exit.querySelector('[data-action]'),null);assert.equal(exit.querySelector('[data-notification-id]'),null);assert.equal(exit.querySelector('button'),null);assert.equal(exit.querySelector('[role]'),null);
 f.tick(PAPER_TIMING.departure);assert.equal(f.document.body.children.length,1);assert.equal(f.frames.size,0);
});
for(const boundary of ['hidden','scope','pagehide'])test(`retiring paint and sound are cancelled at ${boundary} without replay`,()=>{
 const f=fixture();f.patch([paperCard()]);f.tick(500);f.patch([]);
 if(boundary==='hidden'){f.setActive(false);f.controller.cancel();}else if(boundary==='scope'){f.setScope('new-account:g');f.controller.sync();}else f.controller.retire();
 assert.equal(f.document.body.children.length,1);assert.equal(f.frames.size,0);const before=f.sounds.length;f.tick(1000);assert.equal(f.sounds.length,before);assert.ok(f.sounds.some(s=>s[0]==='cancel'));
});
test('initial/restored information and same-key node replacement never invent another entry',()=>{
 const doc=paperDocument();doc.region.append(paperCard());const sounds=[];const paper=createNotificationPaper({document:doc,scope:()=> 'g',sound:{paper:(...a)=>sounds.push(a)},active:()=>true,reduced:()=>true});paper.sync();assert.equal(sounds.length,0);
 doc.region.children[0].remove();doc.region.append(paperCard({copy:'Restored same incident'}));paper.sync();assert.equal(sounds.length,0);
});
test('source-selected fold opens upper-left leaving lower-right curl last and reverses before lift',()=>{
 const first=paperFrame('enter',0),middle=paperFrame('enter',293),last=paperFrame('enter',486);assert.equal(first.progress,0);assert.ok(middle.progress>.4&&middle.progress<.6);assert.equal(last.progress,1);assert.equal(last.elevation,0);assert.match(paperPolygon(middle.progress),/0% 0%/);assert.doesNotMatch(paperPolygon(middle.progress),/100% 100%/);assert.equal(paperPolygon(1),'none');
 const roll=paperFrame('retire',185),lift=paperFrame('retire',470);assert.ok(roll.progress>0&&roll.progress<1);assert.equal(roll.elevation,0);assert.equal(lift.progress,0);assert.ok(lift.elevation>0);
});

test('ordinary copy is exposed as one visual group without suppressing its accessible text',()=>{
 const f=fixture();f.patch([paperCard({copy:'Complete information group'})]);const paper=f.document.region.children[0].querySelector('.shell-game-alert'),copy=paper.querySelector('.shell-game-alert-copy');
 assert.equal(copy.style.opacity,'0');assert.equal(copy.textContent,'Complete information group');assert.equal(copy.hasAttribute('aria-hidden'),false);assert.equal(copy.hasAttribute('inert'),false);
 f.tick(486);assert.equal(copy.style.opacity,undefined);assert.equal(copy.textContent,'Complete information group');
});
test('reduced-motion change settles only visuals and does not cancel an eligible logical cue',()=>{
 const f=fixture();f.patch([paperCard()]);const before=f.sounds.filter(s=>s[0]==='cancel').length;f.setReduced(true);f.controller.sync();assert.equal(f.sounds.filter(s=>s[0]==='cancel').length,before);f.patch([]);assert.deepEqual(f.sounds.filter(s=>s[0]!=='cancel').map(s=>s[0]),['enter','retire']);
});

test('native-modal and offscreen collaborators prevent paper audio/motion without changing notice semantics',()=>{
 const document=paperDocument(),sounds=[];let modal=true;
 document.querySelector=selector=>selector==='dialog:modal'&&modal?{}:null;
 const presentation=createNotificationPaper({document,scope:()=> 'g',reduced:()=>false,sound:{paper:(...a)=>sounds.push(a),cancelPaper(){}},requestFrame:()=>{throw Error('No animation may be scheduled');}});
 presentation.sync();document.region.append(paperCard());presentation.sync();assert.equal(sounds.length,0);assert.equal(document.region.children[0].querySelector('.shell-game-alert-copy').textContent,'History changed');
 document.region.children[0].remove();presentation.sync();modal=false;const next=paperCard({key:'offscreen'});next.querySelector('.shell-game-alert').getBoundingClientRect=()=>({left:0,top:-200,width:320,height:100,right:320,bottom:-100});document.region.append(next);presentation.sync();assert.equal(sounds.length,0);presentation.retire();
});

test('missing decorative CSS falls back to fully open source text without gating logical sound or action',()=>{
 const f=fixture();f.document.defaultView.getComputedStyle=()=>({position:'static'});f.patch([paperCard()]);const paper=f.document.region.children[0].querySelector('.shell-game-alert');
 assert.equal(f.frames.size,0);assert.equal(paper.style.clipPath,undefined);assert.equal(paper.style.animation,'none');assert.equal(f.sounds.filter(s=>s[0]==='enter').length,1);f.patch([]);assert.equal(f.sounds.filter(s=>s[0]==='retire').length,1);assert.equal(f.document.body.children.length,1);
 f.patch([paperCard({action:true})]);let actions=0;f.document.region.querySelector('button').addEventListener('click',()=>actions++);f.document.region.querySelector('button').click();assert.equal(actions,1);
});
test('a presentation collaborator failure cannot replace the actual keyed source patch or original first action',()=>{
 const f=fixture();f.document.defaultView.getComputedStyle=()=>{throw Error('unsupported style');};assert.doesNotThrow(()=>f.patch([paperCard({action:true})]));
 const button=f.document.region.querySelector('button');let n=0;button.addEventListener('click',()=>n++);button.click();assert.equal(n,1);assert.equal(f.frames.size,0);
});

test('an immediate error or CTA cancels old decorative retirement synchronously instead of covering the new real target',()=>{
 const f=fixture();f.patch([paperCard()]);f.tick(500);f.patch([]);assert.equal(f.document.body.children.length,2);const retires=f.sounds.filter(s=>s[0]==='retire').length;
 f.patch([paperCard({key:'error',tone:'danger',priority:'urgent',action:true})]);assert.equal(f.document.body.children.length,1);assert.equal(f.frames.size<=1,true,'at most an already pending final cleanup frame');assert.equal(f.sounds.filter(s=>s[0]==='retire').length,retires);assert.ok(f.document.region.querySelector('button'));
 f.controller.retire();assert.equal(f.frames.size,0);
});
test('direct informational-to-actionable replacement never creates a decorative exit or refurl cue over the new action',()=>{
 const f=fixture();f.patch([paperCard()]);f.tick(200);f.patch([paperCard({key:'error',tone:'warn',action:true})]);assert.equal(f.document.body.children.length,1);assert.equal(f.sounds.filter(s=>s[0]==='retire').length,0);assert.equal(f.document.region.querySelector('.shell-game-alert').style.clipPath,undefined);
});


test('prepatch captures current offscreen geometry before actual semantic removal, without a sync or scroll observer',()=>{
 const f=fixture();f.patch([paperCard()]);f.tick(500);const paper=f.document.region.querySelector('.shell-game-alert');
 paper.getBoundingClientRect=()=>({left:20,top:-200,width:320,height:100,right:340,bottom:-100});
 f.patch([]);assert.equal(f.sounds.filter(s=>s[0]==='retire').length,0);assert.equal(f.document.body.children.length,1);assert.equal(f.frames.size,0);
});
test('prepatch uses the moved visible rectangle for a fixed decorative exit after actual removal',()=>{
 const f=fixture();f.patch([paperCard()]);f.tick(500);const paper=f.document.region.querySelector('.shell-game-alert');
 paper.getBoundingClientRect=()=>({left:60,top:160,width:320,height:100,right:380,bottom:260});
 f.patch([]);assert.equal(f.sounds.filter(s=>s[0]==='retire').length,1);const exit=f.document.body.children[1];assert.ok(exit);assert.equal(exit.style.left,'60px');assert.equal(exit.style.top,'160px');f.controller.retire();
});
test('prepatch capture is one-shot and never reused for an unobserved later detach or same-key replacement',()=>{
 const f=fixture();f.patch([paperCard()]);f.tick(500);f.controller.captureBeforePatch?.();f.controller.sync();
 f.document.region.children[0].remove();f.controller.sync();assert.equal(f.sounds.filter(s=>s[0]==='retire').length,0);assert.equal(f.document.body.children.length,1);
 f.patch([paperCard()]);f.tick(500);f.document.region.children[0].remove();f.controller.sync();assert.equal(f.sounds.filter(s=>s[0]==='retire').length,0);assert.equal(f.document.body.children.length,1);
});
for(const boundary of ['scope','hidden'])test(`prepatch capture cannot survive ${boundary} before semantic detach`,()=>{
 const f=fixture();f.patch([paperCard()]);f.tick(500);f.controller.captureBeforePatch?.();
 if(boundary==='scope')f.setScope('retired-account:g');else f.setActive(false);
 f.document.region.children[0].remove();f.controller.sync();assert.equal(f.sounds.filter(s=>s[0]==='retire').length,0);assert.equal(f.document.body.children.length,1);assert.equal(f.frames.size,0);
});
test('a native-modal boundary invalidates captured retirement without changing the source semantic removal',()=>{
 const document=paperDocument(),sounds=[];let modal=false;
 document.querySelector=selector=>selector==='dialog:modal'&&modal?{}:null;
 const controller=createNotificationPaper({document,scope:()=> 'g',reduced:()=>true,sound:{paper:(...a)=>sounds.push(a),cancelPaper(){}}});controller.sync();document.region.append(paperCard());controller.sync();
 controller.captureBeforePatch?.();modal=true;document.region.children[0].remove();controller.sync();assert.equal(sounds.filter(s=>s[0]==='retire').length,0);assert.equal(document.body.children.length,1);
});


test('cancelling at180ms clears the actual partial polygon and hidden visual copy without consuming later input',()=>{
 const f=fixture();f.patch([paperCard()]);f.tick(180);const paper=f.document.region.querySelector('.shell-game-alert'),copy=paper.querySelector('.shell-game-alert-copy');
 assert.match(paper.style.clipPath,/^polygon\(/);assert.equal(copy.style.opacity,'0');f.controller.cancel();
 assert.equal(paper.style.clipPath,undefined);assert.equal(copy.style.opacity,undefined);assert.equal(f.frames.size,0);assert.equal(copy.textContent,'History changed');
 f.patch([paperCard({action:true})]);const button=f.document.region.querySelector('button');let calls=0;button.addEventListener('click',()=>calls++);button.click();assert.equal(calls,1);
});
