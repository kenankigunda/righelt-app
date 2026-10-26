import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installPassiveAudioObservations} from '../../../e2e/support/audio-observations.mjs';

const fixture=({inheritedResume=false,throwsResume=false}={})=>{
 const failure=new Error('native constructor failure'),nodeReturn={},startReturn={},resumePromise=Promise.resolve();
 class Events{listeners=new Map();addEventListener(type,listener){const list=this.listeners.get(type)??[];list.push(listener);this.listeners.set(type,list);}emit(type,event={}){for(const listener of this.listeners.get(type)??[])listener(event);}}
 class Base extends Events{createBufferSource(){return nodeReturn;}createOscillator(){return nodeReturn;}}
 class Native extends Base{
  static marker={native:true};
  constructor(options){super();if(options?.fail)throw failure;this.newTarget=new.target;this.state='running';this.sampleRate=44100;}
  resume(){return resumePromise;}
 }
 if(throwsResume)Native.prototype.resume=function(){throw failure;};
 if(inheritedResume){Base.prototype.resume=Native.prototype.resume;delete Native.prototype.resume;}
 class Source{constructor(context){this.context=context;this.buffer=null;}start(){return startReturn;}}
 class Socket extends Events{static OPEN=1;constructor(url){super();this.url=url;}}
 const ui={label:'Mute sound',pressed:'true',preference:null,replay:false,selected:null};
 const document=new Events();document.hidden=false;document.hasFocus=()=>true;
 document.querySelector=selector=>selector.includes('toggle-sound')?{getAttribute:name=>name==='aria-label'?ui.label:ui.pressed}:selector==='.computer-replay'?(ui.replay?{}:null):ui.selected?{getAttribute:()=>ui.selected}:null;
 const window=new Events();Object.assign(window,{document,AudioContext:Native,webkitAudioContext:Native,BaseAudioContext:Base,AudioBufferSourceNode:Source,WebSocket:Socket,performance:{now:()=>1},location:{hash:'#/game/g',href:'https://example.test/#/game/g'},localStorage:{getItem:()=>ui.preference},URL});window.window=window;
 vm.runInNewContext(`(${installPassiveAudioObservations.toString()})()`,window);
 return {window,document,ui,Native,Base,Source,Socket,failure,nodeReturn,startReturn,resumePromise};
};

test('passive constructor aliases preserve native instances, prototypes, statics, subclass newTarget and exact errors',()=>{
 const f=fixture(),Constructor=f.window.AudioContext;
 assert.equal(Constructor,f.window.webkitAudioContext);assert.equal(Constructor.prototype,f.Native.prototype);assert.equal(Constructor.marker,f.Native.marker);
 const audio=new Constructor();assert(audio instanceof f.Native);assert.equal(Object.getPrototypeOf(audio),f.Native.prototype);assert.equal(audio.newTarget,Constructor);
 class Child extends Constructor{}const child=new Child();assert(child instanceof Child);assert.equal(child.newTarget,Child);
 assert.throws(()=>new Constructor({fail:true}),error=>error===f.failure);
 const records=f.window.passiveAudioObservations;
 assert.equal(records.filter(record=>record.kind==='audio-constructed').length,2,'aliased constructors must not wrap construction twice');
 assert.equal(records.filter(record=>record.kind==='audio-constructor-error').length,1);
 assert.equal(records.find(record=>record.kind==='audio-constructed').state,'running');
});

test('passive node, resume and source wrappers preserve original returns and state events',async()=>{
 const f=fixture(),audio=new f.window.AudioContext();
 assert.equal(audio.createOscillator(),f.nodeReturn);assert.equal(audio.createBufferSource(),f.nodeReturn);
 assert.equal(audio.resume(),f.resumePromise);await f.resumePromise;
 assert.equal(new f.window.AudioBufferSourceNode(audio).start(),f.startReturn);
 audio.state='suspended';audio.emit('statechange');
 const records=f.window.passiveAudioObservations;
 assert.deepEqual(Array.from(records.filter(record=>record.kind==='audio-node-request'),record=>record.method),['createOscillator','createBufferSource']);
 assert.equal(records.filter(record=>record.kind==='resume-request').length,1,'aliased prototypes must not wrap resume twice');
 assert.equal(records.find(record=>record.kind==='audio-state').state,'suspended');
});

test('gesture and native socket observations capture actual UI preferences without changing native events',()=>{
 const f=fixture();f.ui.preference='false';f.ui.label='Enable sound';f.ui.pressed='false';f.ui.replay=true;f.ui.selected='m1';
 f.document.emit('pointerdown',{isTrusted:true,pointerType:'mouse'});
 const socket=new f.window.WebSocket('https://example.test/api/shell/games/g/ws');assert(socket instanceof f.Socket);assert.equal(f.window.WebSocket.OPEN,f.Socket.OPEN);
 let received;socket.addEventListener('message',event=>{received=event;});const event={data:JSON.stringify({type:'event_appended',reason:'turn_ended',eventSeq:5,game:{gameplayRevision:2,moves:[{destroyedPieces:[{},{}]}]}})};socket.emit('message',event);assert.equal(received,event);
 const records=f.window.passiveAudioObservations,gesture=records.find(record=>record.kind==='gesture'),message=records.find(record=>record.kind==='socket-message');
 assert.equal(gesture.trusted,true);assert.equal(gesture.ui.soundPreference,'false');assert.equal(gesture.ui.soundControl.label,'Enable sound');assert.equal(gesture.ui.replayMounted,true);assert.equal(gesture.ui.selectedHistoryMove,'m1');
 assert.equal(message.eventSeq,5);assert.equal(message.destructionCount,2);assert.equal(message.ui.soundPreference,'false');
});


test('passive inherited resume observes the actual method owner once and preserves native errors',async()=>{
 const f=fixture({inheritedResume:true}),audio=new f.window.AudioContext();
 assert.equal(audio.resume(),f.resumePromise);await f.resumePromise;
 assert.equal(f.window.passiveAudioObservations.filter(record=>record.kind==='resume-request').length,1);
 assert.equal(f.window.passiveAudioObservations.filter(record=>record.kind==='resume-resolved').length,1);
 const broken=fixture({inheritedResume:true,throwsResume:true}),badAudio=new broken.window.AudioContext();
 assert.throws(()=>badAudio.resume(),error=>error===broken.failure);
 assert.equal(broken.window.passiveAudioObservations.filter(record=>record.kind==='resume-threw').length,1);
});
