// Cosmetic paper cues share the existing sound engine's context/preference.
// No function in this module creates or resumes an AudioContext.
export const PAPER_CLIPS=Object.freeze({
  enter:new URL('../assets/sounds/paper-unfurl.wav',import.meta.url).href,
  retire:new URL('../assets/sounds/paper-refurl.wav',import.meta.url).href,
});
export const isTrustedPaperInput=(event,activation=globalThis.navigator?.userActivation)=>
  typeof Event!=='undefined' && event instanceof Event && ['pointerdown','keydown','click'].includes(event.type) && event.isTrusted===true && activation?.isActive===true;

export const createPaperAudio=({getAudio,enabled,active,incomingPending,
  trustedInput=isTrustedPaperInput,load=(url,options)=>fetch(url,options),now=()=>performance.now()}={})=>{
  let generation=0,trusted=false,preparing=null,context=null,voice=null,abort=null;
  const buffers=new Map(),seen=new Set();
  const interrupt=()=>{
    const old=voice;voice=null;
    if(old){try{old.source.stop();}catch{}try{old.source.disconnect();}catch{}try{old.gain.disconnect();}catch{}}
  };
  const cancel=()=>{generation++;abort?.abort();interrupt();};
  const prepare=event=>{
    if(!trustedInput(event)||!enabled()||!active())return false;
    trusted=true;
    const audio=getAudio();if(!audio)return false;
    if(context!==audio){cancel();buffers.clear();preparing=null;context=audio;}
    if(preparing||buffers.size===2)return true;
    const epoch=generation,own=context,controller=new AbortController();abort=controller;
    const pending=Promise.all(Object.entries(PAPER_CLIPS).map(async([kind,url])=>{
      const response=await load(url,{signal:controller.signal});if(!response.ok)throw Error('Paper audio unavailable');
      if(epoch!==generation||context!==own||controller.signal.aborted)throw Error('Paper preparation cancelled');
      const bytes=await response.arrayBuffer();
      if(epoch!==generation||context!==own||controller.signal.aborted)throw Error('Paper preparation cancelled');
      const buffer=await own.decodeAudioData(bytes);return[kind,buffer];
    }));
    preparing=pending;
    void pending.then(values=>{
      if(epoch!==generation||context!==own||getAudio()!==own||!enabled()||!active())return;
      for(const [kind,buffer]of values)buffers.set(kind,buffer);
    }).catch(()=>{}).finally(()=>{if(preparing===pending){preparing=null;abort=null;}});
    return true;
  };
  const play=(kind,{key,eventAt,delayMs=0}={})=>{
    const age=now()-eventAt,audio=getAudio(),buffer=buffers.get(kind),token=`${key}:${kind}`;
    // Ready-buffer-only: a cold/late decode never queues a future sound.
    if(!Object.hasOwn(PAPER_CLIPS,kind)||!key||!Number.isFinite(age)||age<0||age>100||seen.has(token))return false;
    seen.add(token);if(seen.size>256)seen.delete(seen.values().next().value);
    if(!trusted||!enabled()||!active()||incomingPending()||audio!==context||audio?.state!=='running'||!buffer)return false;
    interrupt();
    let source,gain;
    try{
      source=audio.createBufferSource();gain=audio.createGain();const own={source,gain};voice=own;
      source.buffer=buffer;gain.gain.value=.7;source.connect(gain);gain.connect(audio.destination);
      source.onended=()=>{try{source.disconnect();}catch{}try{gain.disconnect();}catch{}if(voice===own)voice=null;};
      source.start(audio.currentTime+Math.max(0,Math.min(100,delayMs))/1000);return true;
    }catch{if(voice?.source===source)cancel();else{try{source?.stop();}catch{}try{source?.disconnect();}catch{}try{gain?.disconnect();}catch{}}return false;}
  };
  return{prepare,play,cancel,interrupt,
    dispose(){cancel();trusted=false;preparing=null;buffers.clear();seen.clear();context=null;},
  };
};
