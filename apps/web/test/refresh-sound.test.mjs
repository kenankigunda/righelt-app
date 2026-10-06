import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameSound} from '../shell/sound.js';
const fixture=()=>{
 const timers=new Map();let id=0,hidden=false,starts=0;
 const node=()=>({connect(){},disconnect(){},frequency:{},Q:{},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},start(){starts++;},stop(){}});
 const audio={state:'running',currentTime:0,sampleRate:8000,createBuffer:(_,n)=>({getChannelData:()=>new Float32Array(n)}),createBufferSource:node,createBiquadFilter:node,createGain:node,createOscillator:node,resume(){this.state='running';return Promise.resolve();},suspend(){this.state='suspended';return Promise.resolve();}};
 const data=new Map();const sound=createGameSound({storage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)},createAudio:()=>audio,hidden:()=>hidden,setTimer:fn=>{timers.set(++id,fn);return id;},clearTimer:i=>timers.delete(i)});
 return {sound,timers,data,starts:()=>starts,hide:()=>{hidden=true;sound.hide();}};
};
test('default sound is on; explicit mute survives without accounts',()=>{const f=fixture();assert.equal(f.sound.enabled(),true);f.sound.toggle();assert.equal(f.sound.enabled(),false);assert.equal(createGameSound({storage:{getItem:()=> 'false'}}).enabled(),false);});
test('hover and pointer leave never sound or schedule audio',()=>{const f=fixture();f.sound.gesture();for(const kind of ['preview-hover','preview-leave']){f.sound.interaction({kind,key:'1:1'});assert.equal(f.sound.play(kind),false);}assert.equal(f.starts(),0);assert.equal(f.timers.size,0);f.sound.interaction({kind:'preview'});assert.ok(f.starts()>0);});
test('authoritative events sound once, while snapshots, rejected and replayed events stay silent',()=>{const f=fixture();f.sound.gesture();const event={game:{id:'a',board:{state:{outcome:{status:'ongoing'}}}},eventSeq:2,type:'snapshot',reason:'move_recorded'};assert.equal(f.sound.observe(event),false);assert.equal(f.sound.observe({...event,type:'event_appended',eventSeq:3}),true);assert.equal(f.sound.observe({...event,type:'event_appended',eventSeq:3}),false);assert.equal(f.sound.observe({...event,type:'event_appended',eventSeq:4,reason:'action_rejected'}),false);});
test('local placement sounds immediately and its acknowledgement never repeats it',()=>{
 const f=fixture();f.sound.gesture();const state={pieces:[{},{}],sideToMove:'P1',turnIndex:0,outcome:{status:'ongoing'}};
 f.sound.local({gameId:'a',type:'authoritative_update'},{currentSnapshot:state});
 const change={gameId:'a',type:'optimistic_enqueue',clientCommandId:'move-1'};
 assert.equal(f.sound.local(change,{currentSnapshot:state}),true);const starts=f.starts();
 assert.equal(f.sound.local(change,{currentSnapshot:state}),false);
 assert.equal(f.sound.observe({game:{id:'a',board:{state}},type:'event_appended',reason:'move_recorded',eventSeq:1,clientCommandId:'move-1'}),false);
 assert.equal(f.starts(),starts);
});
test('restored local commands and background actions are silent and never replay on acknowledgement',()=>{
 const f=fixture();f.sound.gesture();const game={currentSnapshot:{pieces:[]}};
 assert.equal(f.sound.local({gameId:'a',type:'journal_restored',clientCommandId:'old'},game),false);
 assert.equal(f.sound.local({gameId:'a',type:'optimistic_enqueue',clientCommandId:'new'},game,{silent:true}),false);
 assert.equal(f.sound.observe({game:{id:'a',board:{state:game.currentSnapshot}},type:'event_appended',reason:'move_recorded',eventSeq:2,clientCommandId:'new'}),false);
 assert.equal(f.starts(),0);
});
test('inactive opponent moves create exactly one 30-second reminder until focus returns',()=>{
 let focused=true,hidden=false;const timers=new Map();let n=0,starts=0;
 const node=()=>({connect(){},disconnect(){},frequency:{},Q:{},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},start(){starts++},stop(){}});
 const audio={state:'running',currentTime:0,sampleRate:8000,createBuffer:(_,n)=>({getChannelData:()=>new Float32Array(n)}),createBufferSource:node,createBiquadFilter:node,createGain:node,createOscillator:node};
 const sound=createGameSound({createAudio:()=>audio,focused:()=>focused,hidden:()=>hidden,setTimer:(fn,ms)=>{timers.set(++n,{fn,ms});return n;},clearTimer:id=>timers.delete(id)});
 sound.gesture();focused=false;sound.activityChanged();assert.equal(sound.play('move'),false);assert.equal(sound.play('intro'),false);
 const event=seq=>({game:{id:'a',myRoles:['Player 1'],moves:[{actorSide:'P2',clientCommandId:`other-${seq}`}],board:{state:{pieces:[],outcome:{status:'ongoing'}}}},eventSeq:seq,clientCommandId:`other-${seq}`,type:'event_appended',reason:'move_recorded'});
 assert.equal(sound.observe(event(1)),true);const first=starts;assert.equal(timers.size,1);assert.equal([...timers.values()][0].ms,30000);
 assert.equal(sound.observe(event(2)),false);assert.equal(starts,first);assert.equal(timers.size,1);
 hidden=true;const [id,timer]=[...timers][0];timers.delete(id);timer.fn();assert.equal(starts,first*2);assert.equal(timers.size,1);
 focused=true;hidden=false;sound.activityChanged();assert.equal(timers.size,0);assert.equal(starts,first*2);
});
test('own moves from another tab, viewers and initial replay never create background reminders',()=>{
 let focused=true;const timers=[];const sound=createGameSound({focused:()=>focused,setTimer:fn=>timers.push(fn),createAudio:()=>({state:'running'})});sound.gesture();focused=false;
 for(const role of ['Player 1','Viewer'])assert.equal(sound.observe({game:{id:role,myRoles:[role],moves:[{actorSide:'P1'}]},eventSeq:1,type:'event_appended',reason:'move_recorded'}),false);
 assert.equal(sound.observe({game:{id:'initial',myRoles:['Player 1'],moves:[{actorSide:'P2'}]},eventSeq:1,type:'event_appended',reason:'move_recorded'},{silent:true}),false);assert.equal(timers.length,0);
});
test('mute and leaving a game cancel outstanding incoming reminders without replay',()=>{
 let focused=true;const timers=new Map();let id=0;
 const sound=createGameSound({focused:()=>focused,setTimer:fn=>(timers.set(++id,fn),id),clearTimer:id=>timers.delete(id),createAudio:()=>({state:'suspended',resume:()=>Promise.resolve(),suspend:()=>Promise.resolve()})});
 sound.gesture();focused=false;
 const event=seq=>({game:{id:'a',myRoles:['Player 1'],moves:[{actorSide:'P2'}]},eventSeq:seq,type:'event_appended',reason:'move_recorded'});
 sound.observe(event(1));assert.equal(timers.size,1);sound.toggle();assert.equal(timers.size,0);
 sound.observe(event(2));assert.equal(timers.size,0);sound.toggle();assert.equal(timers.size,0);
 sound.observe(event(3));assert.equal(timers.size,1);sound.leaveGame();assert.equal(timers.size,0);
});

test('page and flyout cues have forward and reverse feedback without pitched notes',()=>{
 let oscillators=0,buffers=0;
 const node=()=>({connect(){},disconnect(){},frequency:{},Q:{},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},start(){},stop(){}});
 const audio={state:'running',currentTime:0,sampleRate:8000,createBuffer:(_,n)=>({getChannelData:()=>new Float32Array(n)}),createBufferSource:()=>{buffers++;return node();},createBiquadFilter:node,createGain:node,createOscillator:()=>{oscillators++;return node();}};
 audio.suspend=()=>Promise.resolve();
 const sound=createGameSound({createAudio:()=>audio});sound.gesture();
 for(const kind of ['page','page-back','flyout','flyout-back'])assert.equal(sound.play(kind),true);
 assert.equal(buffers,4);assert.equal(oscillators,0);sound.toggle();assert.equal(sound.play('page'),false);
});

test('navigation cues finish with the requested reveal duration',()=>{
 const stops=[];
 const node=()=>({connect(){},disconnect(){},frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},Q:{},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},start(){},stop(at){stops.push(at)}});
 const audio={state:'running',currentTime:10,sampleRate:8000,createBuffer:(_,n)=>({getChannelData:()=>new Float32Array(n)}),createBufferSource:node,createBiquadFilter:node,createGain:node,createOscillator:node};
 const sound=createGameSound({createAudio:()=>audio,hidden:()=>false,focused:()=>true});sound.gesture();
 sound.play('enter',{duration:.2});sound.play('leave',{duration:.2});
 assert.deepEqual(stops,[10.2,10.2]);
});
