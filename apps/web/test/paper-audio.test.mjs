import test from 'node:test';
import assert from 'node:assert/strict';
import {createPaperAudio,isTrustedPaperInput,PAPER_CLIPS} from '../shell/paper-audio.js';
import {createGameSound,INCOMING_REMINDER_MS} from '../shell/sound.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const fixture=()=>{
 let enabled=true,active=true,incoming=false,time=0,resumes=0,contexts=0;const sources=[],loads=[],gains=[];
 const audio={state:'running',currentTime:0,destination:{},sampleRate:8000,
  decodeAudioData:async()=>({duration:.38}),resume(){resumes++;return Promise.resolve();},suspend:async()=>{},
  createBufferSource(){const node={buffer:null,start(){node.started=true;},stop(){node.stopped=true;},connect(){},disconnect(){node.disconnected=true;}};sources.push(node);return node;},
  createGain(){const node={gain:{value:0,setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){node.disconnected=true;}};gains.push(node);return node;},
  createBuffer:(_,n)=>({getChannelData:()=>new Float32Array(n)}),createBiquadFilter:()=>({frequency:{},Q:{},connect(){},disconnect(){}}),createOscillator:()=>({frequency:{},connect(){},disconnect(){},start(){},stop(){}})};
 const options={getAudio:()=>audio,enabled:()=>enabled,active:()=>active,incomingPending:()=>incoming,now:()=>time,trustedInput:e=>e===trusted,
  load:async(url,{signal})=>{loads.push({url,signal});return{ok:true,arrayBuffer:async()=>new ArrayBuffer(1)};}};
 const trusted={},paper=createPaperAudio(options);
 return{paper,audio,options,trusted,sources,gains,loads,now:()=>time,tick:ms=>time+=ms,setEnabled:v=>enabled=v,setActive:v=>active=v,setIncoming:v=>incoming=v,resumes:()=>resumes,
  createAudio:()=>{contexts++;return audio;},contexts:()=>contexts};
};
test('default paper trust rejects synthetic or forged input even with active user activation',()=>{
 assert.equal(isTrustedPaperInput(new Event('pointerdown'),{isActive:true}),false);
 assert.equal(isTrustedPaperInput({isTrusted:true},{isActive:true}),false);
 assert.equal(isTrustedPaperInput(new Event('keydown'),{isActive:false}),false);
});
test('paper prepares only from the injected trusted boundary, never resumes, and skips cold events without late replay',async()=>{
 const f=fixture();assert.equal(f.paper.prepare({}),false);assert.equal(f.loads.length,0);
 assert.equal(f.paper.play('enter',{key:'cold',eventAt:0}),false);
 f.paper.prepare(f.trusted);await flush();assert.equal(f.loads.length,2);assert.equal(f.resumes(),0);assert.equal(f.sources.length,0);
 assert.equal(f.paper.play('enter',{key:'cold',eventAt:0}),false,'same skipped event never resurrects');
 assert.equal(f.paper.play('enter',{key:'fresh',eventAt:0}),true);assert.equal(f.sources.length,1);
 assert.equal(f.paper.play('enter',{key:'fresh',eventAt:0}),false);assert.equal(f.paper.play('retire',{key:'fresh',eventAt:0}),true);assert.ok(f.sources[0].stopped&&f.sources[0].disconnected);
 f.sources[1].onended();assert.ok(f.sources[1].disconnected&&f.gains[1].disconnected);
});
for(const boundary of ['mute','hidden','dispose','cancel'])test(`held decode cannot publish or sound across ${boundary}`,async()=>{
 const f=fixture(),held=deferred();f.audio.decodeAudioData=()=>held.promise;f.paper.prepare(f.trusted);await flush();
 if(boundary==='mute'){f.setEnabled(false);f.paper.cancel();f.setEnabled(true);}
 if(boundary==='hidden'){f.setActive(false);f.paper.cancel();f.setActive(true);}
 if(boundary==='dispose')f.paper.dispose();if(boundary==='cancel')f.paper.cancel();
 held.resolve({duration:.38});await flush();assert.equal(f.sources.length,0);assert.equal(f.paper.play('enter',{key:'after',eventAt:0}),false);assert.equal(f.resumes(),0);
 assert.ok(f.loads.every(row=>row.signal.aborted));
});
test('failed decode and suspended context do not gate content or start/resume audio',async()=>{
 const f=fixture();f.audio.decodeAudioData=async()=>{throw Error('decode');};f.paper.prepare(f.trusted);await flush();assert.equal(f.paper.play('enter',{key:'failure',eventAt:0}),false);
 const g=fixture();g.paper.prepare(g.trusted);await flush();g.audio.state='suspended';assert.equal(g.paper.play('enter',{key:'suspended',eventAt:0}),false);assert.equal(g.resumes(),0);
});
test('ready cues obey foreground, shared preference, unseen priority and bounded freshness without queues',async()=>{
 const f=fixture();f.paper.prepare(f.trusted);await flush();
 f.setIncoming(true);assert.equal(f.paper.play('enter',{key:'pending',eventAt:0}),false);f.setIncoming(false);assert.equal(f.paper.play('enter',{key:'pending',eventAt:0}),false);
 f.setEnabled(false);assert.equal(f.paper.play('retire',{key:'mute',eventAt:0}),false);f.setEnabled(true);
 f.setActive(false);assert.equal(f.paper.play('enter',{key:'background',eventAt:0}),false);f.setActive(true);
 f.tick(101);assert.equal(f.paper.play('enter',{key:'late',eventAt:0}),false);assert.equal(f.sources.length,0);
 assert.equal(f.paper.play('retire',{key:'current',eventAt:f.now()}),true);f.paper.cancel();assert.ok(f.sources[0].stopped&&f.sources[0].disconnected);
});
test('higher-priority interruption cancels voice without discarding valid preparation or creating another context',async()=>{
 const f=fixture();f.paper.prepare(f.trusted);f.paper.interrupt();await flush();assert.equal(f.paper.play('enter',{key:'current',eventAt:0}),true);f.paper.interrupt();assert.ok(f.sources[0].stopped);assert.equal(f.resumes(),0);
});
test('actual shared sound engine keeps incoming reminders ahead of paper until visible live playback completion',async()=>{
 const f=fixture(),timers=new Map();let next=0;
 const sound=createGameSound({storage:{getItem:()=>null,setItem(){}},createAudio:f.createAudio,hidden:()=>false,focused:()=>true,setTimer:fn=>{timers.set(++next,fn);return next;},clearTimer:id=>timers.delete(id),paperOptions:{...f.options}});
 sound.gesture();sound.preparePaper(f.trusted);await flush();assert.equal(f.contexts(),1);
 assert.equal(sound.paper('enter',{key:'first',eventAt:0}),true);
 const baseline={id:'g',gameplayRevision:1,myRoles:['Player 1'],moves:[],board:{state:{outcome:{status:'ongoing'}}}};
 sound.authoritative(baseline,{sequence:1,scope:'g',unseen:true});
 sound.authoritative({...baseline,gameplayRevision:2,moves:[{moveId:'m',actorSide:'P2'}]},{sequence:2,scope:'g',unseen:true});
 assert.equal(timers.size,1);assert.ok(f.sources[0].stopped,'actual unseen cue interrupts paper');
 assert.equal(sound.paper('enter',{key:'blocked',eventAt:0}),false);
 sound.viewing({gameId:'g',live:true,playbackFinished:false});assert.equal(timers.size,1);assert.equal(sound.paper('retire',{key:'still-blocked',eventAt:0}),false);
 sound.viewing({gameId:'g',live:true,playbackFinished:true});assert.equal(timers.size,0);f.audio.currentTime=1;assert.equal(sound.paper('enter',{key:'after-completion',eventAt:0}),true);
 assert.equal(INCOMING_REMINDER_MS,30000);sound.disposePaper();assert.equal(f.contexts(),1);
});
test('only the two exact approved clip URLs are requested',async()=>{
 const f=fixture();f.paper.prepare(f.trusted);await flush();f.paper.prepare(f.trusted);await flush();assert.deepEqual(f.loads.map(row=>row.url).sort(),Object.values(PAPER_CLIPS).sort());
});


test('default boundary requires an input Event, trusted state AND active native-activation collaborator',()=>{
 class ControlledTrustedEvent extends Event {get isTrusted(){return true;}}
 const event=new ControlledTrustedEvent('pointerdown');
 assert.equal(isTrustedPaperInput(event,{isActive:true}),true,'controlled DOM positive, not native browser proof');
 assert.equal(isTrustedPaperInput(event,{isActive:false}),false);
 assert.equal(isTrustedPaperInput(new ControlledTrustedEvent('abort'),{isActive:true}),false);
});

test('held fetch is aborted and cannot begin a stale decode after paper disposal',async()=>{
 const f=fixture(),held=deferred();let decodes=0;
 const p=createPaperAudio({...f.options,load:()=>held.promise});f.audio.decodeAudioData=async()=>{decodes++;return{};};p.prepare(f.trusted);p.dispose();held.resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)});await flush();assert.equal(decodes,0);assert.equal(f.sources.length,0);
});
test('held existing-context resume cannot resurrect a skipped paper event',async()=>{
 const f=fixture(),held=deferred();f.audio.state='suspended';f.audio.resume=()=>held.promise;
 const sound=createGameSound({createAudio:f.createAudio,hidden:()=>false,focused:()=>true,paperOptions:f.options});
 sound.gesture();sound.preparePaper(f.trusted);await flush();assert.equal(sound.paper('enter',{key:'held',eventAt:0}),false);
 sound.disposePaper();held.resolve();f.audio.state='running';await flush();assert.equal(f.sources.length,0);assert.equal(sound.paper('enter',{key:'held',eventAt:0}),false);assert.equal(f.contexts(),1);
});

test('deferred unseen computer batch blocks paper even before an incoming reminder loop exists',async()=>{
 const f=fixture();const sound=createGameSound({createAudio:f.createAudio,hidden:()=>false,focused:()=>true,paperOptions:f.options});sound.gesture();sound.preparePaper(f.trusted);await flush();
 const game={id:'g',gameplayRevision:1,myRoles:['Player 1','Player 2'],computer:{},moves:[],board:{state:{outcome:{status:'ongoing'}}}};
 sound.authoritative(game,{sequence:1,scope:'g',deferComputer:true});
 sound.authoritative({...game,gameplayRevision:2,moves:[{moveId:'computer',actorSide:'P2',computerProof:{profile:'babs'}}]},{sequence:2,scope:'g',deferComputer:true,unseen:true});
 assert.equal(sound.paper('enter',{key:'deferred',eventAt:0}),false,'unseen set itself owns suppression');assert.equal(f.sources.length,0);
 sound.viewing({gameId:'g',live:true,playbackFinished:false});assert.equal(sound.paper('retire',{key:'pending-display',eventAt:0}),false);
 sound.viewing({gameId:'g',live:true,playbackFinished:true});assert.equal(sound.paper('enter',{key:'displayed',eventAt:0}),true);
 sound.disposePaper();
});

test('paper gain cleanup survives source-disconnect failure and failed connection never escapes',async()=>{
 const f=fixture();f.paper.prepare(f.trusted);await flush();assert.equal(f.paper.play('enter',{key:'voice',eventAt:0}),true);
 f.sources[0].disconnect=()=>{throw Error('disconnect');};assert.doesNotThrow(()=>f.paper.cancel());assert.equal(f.gains[0].disconnected,true);
 const g=fixture();g.paper.prepare(g.trusted);await flush();g.audio.createGain=()=>({gain:{},connect(){throw Error('connect');},disconnect(){this.disconnected=true;}});
 assert.equal(g.paper.play('retire',{key:'failed',eventAt:0}),false);assert.ok(g.sources[0].stopped&&g.sources[0].disconnected);assert.equal(g.resumes(),0);
});


test('default fetch carries the owned abort signal and disposal aborts actual preparation',async()=>{
 const f=fixture(),held=deferred(),requests=[],original=globalThis.fetch;
 globalThis.fetch=(url,options)=>{requests.push({url,signal:options?.signal});return held.promise;};
 try{
  const {load,...options}=f.options,paper=createPaperAudio(options);paper.prepare(f.trusted);
  assert.equal(requests.length,2);assert.ok(requests.every(r=>r.signal instanceof AbortSignal));paper.dispose();
  assert.ok(requests.every(r=>r.signal.aborted));held.resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)});await flush();assert.equal(f.sources.length,0);
 }finally{globalThis.fetch=original;}
});
