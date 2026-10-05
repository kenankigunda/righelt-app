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
test('settled hover produces one cue; leaving or hiding cancels it',()=>{const f=fixture();f.sound.gesture();f.sound.interaction({kind:'preview-hover',key:'1:1'});assert.equal(f.starts(),0);f.sound.interaction({kind:'preview-leave'});assert.equal(f.timers.size,0);f.sound.interaction({kind:'preview-hover',key:'1:2'});[...f.timers.values()][0]();assert.ok(f.starts()>0);const before=f.starts();f.sound.interaction({kind:'preview-hover',key:'1:2'});assert.equal(f.starts(),before);f.hide();assert.equal(f.sound.play('move'),false);});
test('authoritative events sound once, while snapshots, rejected and replayed events stay silent',()=>{const f=fixture();f.sound.gesture();const event={game:{id:'a',board:{state:{outcome:{status:'ongoing'}}}},eventSeq:2,type:'snapshot',reason:'move_recorded'};assert.equal(f.sound.observe(event),false);assert.equal(f.sound.observe({...event,type:'event_appended',eventSeq:3}),true);assert.equal(f.sound.observe({...event,type:'event_appended',eventSeq:3}),false);assert.equal(f.sound.observe({...event,type:'event_appended',eventSeq:4,reason:'action_rejected'}),false);});
