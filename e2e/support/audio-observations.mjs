// Observes native APIs without replacing audio policy, timing, return values or events.
export function installPassiveAudioObservations() {
 const records=[];window.passiveAudioObservations=records;
 const uiState=()=>{
  let preference;try{preference=localStorage.getItem('righelt.device.sound-enabled');}catch(error){preference={readError:String(error)};}
  const sound=document.querySelector('[data-action="toggle-sound"]'),selected=document.querySelector('[data-testid="history-move-item"].is-selected');
  return {soundPreference:preference,soundControl:sound?{label:sound.getAttribute('aria-label'),pressed:sound.getAttribute('aria-pressed')}:null,replayMounted:Boolean(document.querySelector('.computer-replay')),selectedHistoryMove:selected?.getAttribute('data-move-id')??null};
 };
 window.passiveAudioUiState=uiState;
 const note=(kind,details={})=>{if(records.length<1500)records.push({at:performance.now(),kind,focused:document.hasFocus(),hidden:document.hidden,route:location.hash,ui:uiState(),...details});};
 const observed=new WeakSet();
 const context=audio=>{
  if(observed.has(audio))return;observed.add(audio);
  note('audio-observed',{state:audio.state,sampleRate:audio.sampleRate});
  audio.addEventListener('statechange',()=>note('audio-state',{state:audio.state}));
 };
 const constructors=new WeakMap();
 for(const name of ['AudioContext','webkitAudioContext']){
  const Native=window[name];if(typeof Native!=='function')continue;
  let proxy=constructors.get(Native);
  if(!proxy){proxy=new Proxy(Native,{construct(target,args,newTarget){
   let audio;
   try{audio=Reflect.construct(target,args,newTarget);}catch(error){note('audio-constructor-error',{constructor:name,error:String(error)});throw error;}
   context(audio);note('audio-constructed',{constructor:name,state:audio.state,sampleRate:audio.sampleRate});return audio;
  }});constructors.set(Native,proxy);}
  window[name]=proxy;
 }
 const prototypes=new WeakSet();
 for(const name of ['AudioContext','webkitAudioContext']){
  const prototype=window[name]?.prototype;if(!prototype||prototypes.has(prototype)||!Object.hasOwn(prototype,'resume'))continue;
  prototypes.add(prototype);
  const resume=prototype.resume;
  prototype.resume=function(...args){context(this);note('resume-request',{state:this.state});const result=Reflect.apply(resume,this,args);result.then(()=>note('resume-resolved',{state:this.state}),error=>note('resume-rejected',{state:this.state,error:String(error)}));return result;};
 }
 const base=window.BaseAudioContext?.prototype;
 if(base)for(const method of ['createBufferSource','createOscillator']){
  const create=base[method];if(typeof create!=='function')continue;
  base[method]=function(...args){context(this);note('audio-node-request',{method,state:this.state});return Reflect.apply(create,this,args);};
 }
 const start=AudioBufferSourceNode.prototype.start;
 AudioBufferSourceNode.prototype.start=function(...args){context(this.context);note('source-start',{state:this.context.state,channels:this.buffer?.numberOfChannels,duration:this.buffer?.duration,sampleRate:this.buffer?.sampleRate,firstSample:this.buffer?.getChannelData(0)?.[0]});return Reflect.apply(start,this,args);};
 for(const type of ['focus','blur'])window.addEventListener(type,()=>note(type));
 for(const type of ['pointerdown','keydown'])document.addEventListener(type,event=>note('gesture',{type,trusted:event.isTrusted,pointerType:event.pointerType??null,key:event.key??null}),{capture:true,passive:true});
 document.addEventListener('visibilitychange',()=>note('visibility'));
 // The proxy constructs and returns the original native socket. No messages,
 // listeners, sends or lifecycle events are suppressed, delayed or rewritten.
 const NativeSocket=window.WebSocket;
 window.WebSocket=new Proxy(NativeSocket,{construct(target,args,newTarget){
  const socket=Reflect.construct(target,args,newTarget);const url=new URL(String(args[0]),location.href);
  if(url.pathname.includes('/api/shell/games/')){
   socket.addEventListener('open',()=>note('socket-open',{path:url.pathname}));
   socket.addEventListener('close',event=>note('socket-close',{path:url.pathname,code:event.code}));
   socket.addEventListener('message',event=>{try{const data=JSON.parse(event.data);note('socket-message',{path:url.pathname,type:data.type,reason:data.reason,eventSeq:data.eventSeq,clientCommandId:data.clientCommandId,gameplayRevision:data.game?.gameplayRevision,destructionCount:data.game?.moves?.reduce((n,move)=>n+(move.destroyedPieces?.length??0),0)});}catch{note('socket-non-json',{path:url.pathname});}});
  }
  return socket;
 }});
 note('installed');
}
