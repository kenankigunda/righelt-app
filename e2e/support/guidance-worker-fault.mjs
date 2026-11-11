// Serialized before the app loads. The only substituted boundary is one
// external hint-worker response. Product runtime, sink and legality stay real.
export function installGuidanceWorkerFault() {
  const NativeWorker=globalThis.Worker;
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'Worker');
  const records=[],issues=[];let injected=0,disposed=false;
  const record=value=>{if(records.length<32)records.push(value);else if(!issues.includes('record-cap'))issues.push('record-cap');};
  const issue=value=>{if(issues.length<8)issues.push(value);};
  if(typeof NativeWorker!=='function'||!descriptor||(!descriptor.writable&&!descriptor.configurable))throw Error('Native Worker boundary unavailable');
  class GuidanceFaultWorker extends NativeWorker {
    constructor(url,options) {
      super(url,options);
      let eligible=false;
      try {
        const target=new URL(url,location.href);
        eligible=target.origin===location.origin&&target.pathname==='/generated/rules-worker.js'&&!target.search&&!target.hash;
        if(eligible&&options?.type!=='module'){issue('worker-options');eligible=false;}
      } catch {issue('worker-url');}
      const worker=this,post=this.postMessage,terminate=this.terminate;
      let terminated=false;
      this.postMessage=function(...args) {
        const request=args[0];
        if(!disposed&&this===worker&&eligible&&request?.type==='rush-guidance') {
          if(request.scope!=='rush-guidance'||!Number.isSafeInteger(request.id)||request.id<=0||args.length!==1) {
            issue('guidance-protocol');
          } else if(injected===0) {
            injected++;
            const {id,scope,type}=request;
            record({kind:'injected',id,scope,type});
            queueMicrotask(()=>{
              if(disposed||terminated){issue('fault-retired-before-response');return;}
              record({kind:'response',id,scope,type});
              worker.dispatchEvent(new MessageEvent('message',{data:{id,scope,type,error:{
                code:'rules_budget_exceeded',message:'private-guidance-worker-marker raw-state-marker',
              }}}));
            });
            return;
          } else record({kind:'delegated-guidance',id:request.id,scope:request.scope,type:request.type});
        }
        return Reflect.apply(post,this,args);
      };
      this.terminate=function(...args) {
        terminated=true;
        return Reflect.apply(terminate,this,args);
      };
    }
  }
  Object.defineProperty(globalThis,'Worker',{...descriptor,value:GuidanceFaultWorker});
  Object.defineProperty(globalThis,'__guidanceWorkerFault',{value:Object.freeze({
    snapshot:()=>({injected,records:records.map(row=>({...row})),issues:[...issues],disposed}),
    restore(){
      if(disposed)return;
      disposed=true;
      if(globalThis.Worker!==GuidanceFaultWorker)issue('worker-constructor-replaced');
      else Object.defineProperty(globalThis,'Worker',descriptor);
      // The real runtime owns worker termination. Context close retires any
      // remaining instance. This fixture never invokes terminate itself.
    },
  }),configurable:true});
}
