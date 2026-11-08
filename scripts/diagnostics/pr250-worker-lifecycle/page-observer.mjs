// Serialized by the public BrowserContext.addInitScript API. No worker bootstrap
// or application module is rewritten. The returned object is the native Worker.
export function installWorkerLifecycle({prefix,contextId,maxRows=4096,maxText=65536}) {
  if (!['http:','https:'].includes(location.protocol)) return;
  const output=console.debug.bind(console), now=()=>performance.now(),ObserverError=Error;
  let sequence=0,ordinal=0,dropped=0,documentNonce=null;
  try { documentNonce=crypto.randomUUID(); } catch {}
  const emit=(kind,fields={})=>{
    try {
      if(sequence>=maxRows){dropped++;if(dropped===1)output(prefix+JSON.stringify({version:1,contextId,documentNonce,kind:'cap-loss',sequence:sequence+1,dropped:1}));return;}
      output(prefix+JSON.stringify({version:1,contextId,documentNonce,sequence:++sequence,pageNow:now(),timeOrigin:performance.timeOrigin,kind,...fields}));
    } catch { /* Observer failure cannot become an application exception. */ }
  };
  const text=value=>typeof value==='string'?{value:value.slice(0,maxText),truncated:value.length>maxText}:{value:null,unavailable:true};
  // Do not invoke application getters or coerce payloads, URLs or transfer lists.
  const own=(object,key)=>{
    if(object===null||typeof object!=='object')return undefined;
    try {const d=Object.getOwnPropertyDescriptor(object,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;}catch{return undefined;}
  };
  const scalar=(object,key)=>{
    const value=own(object,key);
    return value===null||['boolean','number'].includes(typeof value)?value:typeof value==='string'?text(value):undefined;
  };
  const exception=error=>({name:scalar(error,'name'),message:scalar(error,'message'),stack:scalar(error,'stack')});
  const summary=data=>{
    const result={};
    for(const key of ['id','scope','type','generation','phase','work','completed','total','message']){
      const value=scalar(data,key);if(value!==undefined)result[key]=value;
    }
    const metadata=own(data,'metadata');
    if(metadata&&typeof metadata==='object'){
      result.metadata={};
      for(const key of ['generation','gameplayRevision','controlGeneration','modelVersion','profileVersion','seed','fingerprint']){
        const value=scalar(metadata,key);if(value!==undefined)result.metadata[key]=value;
      }
    }
    const error=own(data,'error');
    if(error&&typeof error==='object')result.error={code:scalar(error,'code'),message:scalar(error,'message')};
    return result;
  };
  emit('document-install',{nonceAvailable:documentNonce!==null,readyState:document.readyState});
  const NativeWorker=globalThis.Worker;
  if(typeof NativeWorker!=='function'){emit('worker-unavailable');return;}
  const instances=new WeakMap(),post=NativeWorker.prototype.postMessage,terminate=NativeWorker.prototype.terminate;
  const workerDescriptor=Object.getOwnPropertyDescriptor(globalThis,'Worker');
  const postDescriptor=Object.getOwnPropertyDescriptor(NativeWorker.prototype,'postMessage');
  const terminateDescriptor=Object.getOwnPropertyDescriptor(NativeWorker.prototype,'terminate');
  if(!workerDescriptor||!postDescriptor||!terminateDescriptor){emit('installation-incomplete');return;}
  let ObservedWorker;
  ObservedWorker=new Proxy(NativeWorker,{
    construct(target,args,newTarget){
      let worker;
      try {worker=Reflect.construct(target,args,newTarget===ObservedWorker?target:newTarget);}
      catch(error){emit('constructor-threw',{error:exception(error)});throw error;}
      const workerOrdinal=++ordinal;
      instances.set(worker,{workerOrdinal});
      emit('worker-created',{workerOrdinal,url:typeof args[0]==='string'?text(args[0]):{unavailable:true,reason:'non-string-not-coerced'},argumentCount:args.length});
      const observe=(kind,event)=>{
        try {
          if(kind==='message')emit(kind,{workerOrdinal,data:summary(event.data)});
          else if(kind==='messageerror')emit(kind,{workerOrdinal});
          else {
            const error=event.error;
            emit('native-error',{workerOrdinal,message:text(event.message),filename:text(event.filename),lineno:event.lineno,colno:event.colno,error:exception(error),observerStack:text(new ObserverError().stack),defaultPrevented:event.defaultPrevented});
          }
        }catch{emit('event-read-incomplete',{workerOrdinal,eventKind:kind});}
      };
      // Added before application onmessage/onerror assignments. No preventDefault,
      // stopPropagation, handler replacement, payload changes or worker evaluate.
      try{
        worker.addEventListener('message',event=>observe('message',event));
        worker.addEventListener('messageerror',event=>observe('messageerror',event));
        worker.addEventListener('error',event=>observe('error',event));
      }catch{emit('installation-incomplete',{workerOrdinal});}
      return worker;
    }
  });
  const observedPost=function(...args){
    const instance=instances.get(this);
    if(instance)emit('post-called',{...instance,data:summary(args[0]),argumentCount:args.length});
    try {const result=Reflect.apply(post,this,args);if(instance)emit('post-returned',instance);return result;}
    catch(error){if(instance)emit('post-threw',{...instance,error:exception(error)});throw error;}
  };
  const observedTerminate=function(...args){
    const instance=instances.get(this);if(instance)emit('terminate-called',{...instance,callerStack:text(new ObserverError().stack)});
    try {const result=Reflect.apply(terminate,this,args);if(instance)emit('terminate-returned',instance);return result;}
    catch(error){if(instance)emit('terminate-threw',{...instance,error:exception(error)});throw error;}
  };
  try {
    Object.defineProperty(NativeWorker.prototype,'postMessage',{...postDescriptor,value:observedPost});
    Object.defineProperty(NativeWorker.prototype,'terminate',{...terminateDescriptor,value:observedTerminate});
    Object.defineProperty(globalThis,'Worker',{...workerDescriptor,value:ObservedWorker});
    emit('installed');
  }catch{
    try{Object.defineProperty(NativeWorker.prototype,'postMessage',postDescriptor);}catch{}
    try{Object.defineProperty(NativeWorker.prototype,'terminate',terminateDescriptor);}catch{}
    try{Object.defineProperty(globalThis,'Worker',workerDescriptor);}catch{}
    emit('installation-incomplete');
  }
}
