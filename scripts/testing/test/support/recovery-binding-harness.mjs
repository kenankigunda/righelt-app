import {EventEmitter} from 'node:events';
import vm from 'node:vm';
// Controlled public-API leaves only: actual source installer, DTO, receiver and
// source callback execute unchanged. Native qualification remains separate.
export function recoveryBindingHarness({namespace='namespace',gameId='game',beforeSignal,configGate,publisherGate,onRead=()=>{},breakProducer=false}={}){
 const page=new EventEmitter(),frame={},context={},bindings=new Map(),scripts=[],events=[];let realm;
 page.mainFrame=()=>frame;page.context=()=>context;page.isClosed=()=>false;
 const createRealm=()=>{
  realm=vm.createContext({document:{},crypto:{randomUUID:()=> 'physical-arm-'+events.length},performance:{timeOrigin:123,getEntriesByName(){if(breakProducer)throw Error('original read failed');return[];}},location:{hash:'#/game/'+gameId},TextEncoder,
   console:{debug:text=>page.emit('console',{text:()=>text,page:()=>page,worker:()=>null,type:()=> 'debug'})}});
  vm.runInContext('globalThis.top=globalThis;globalThis.window=globalThis;globalThis.retreatJournalObservations={records:[{event:"same-original"}],dropped:0,eventLoopTicks:1};',realm);
  realm.__boardAdmissionRecoveryDocument='document';realm.__boardAdmissionObservation={version:1,timeOrigin:123,documentNonce:'document',recoveryNamespace:namespace,first:[],tail:[],activation:[],incomplete:false,rulesTimeouts:{version:1,timeOrigin:123,rows:[],dropped:0,incomplete:false}};
  realm.__righeltReadinessFreeze=()=>{onRead();return{incomplete:false};};
  for(const[name,callback]of bindings)realm[name]=(...args)=>callback({page,frame,context},...args);
  for(const[fn,arg]of scripts)vm.runInContext('('+fn.toString()+')(settings)',Object.assign(realm,{settings:arg}));
 };createRealm();
 page.exposeBinding=async(name,callback)=>{
  const signal=name.startsWith('__righeltFinalSignal_');events.push(signal?'signal-install':'publisher-install');
  if(signal)await beforeSignal?.(page,realm);
  const installed=(...args)=>{const handler=bindings.get(name);if(!handler)throw Error('client registration race');return Promise.resolve(publisherGate?.(args)).then(()=>handler({page,frame,context},...args));};
  realm[name]=installed;if(signal)await configGate;
  bindings.set(name,callback);return{async dispose(){events.push(signal?'signal-dispose':'publisher-dispose');bindings.delete(name);delete realm[name];}};
 };
 page.addInitScript=async(fn,arg)=>{scripts.push([fn,arg]);vm.runInContext('('+fn.toString()+')(settings)',Object.assign(realm,{settings:arg}));return{async dispose(){events.push('init-dispose');const i=scripts.findIndex(x=>x[0]===fn);if(i>=0)scripts.splice(i,1);}};};
 return{page,frame,context,bindings,events,realm:()=>realm,navigate(){page.emit('framenavigated',frame);createRealm();},emit(raw,overrides={}){page.emit('console',{text:()=>raw,page:()=>page,worker:()=>null,type:()=> 'debug',...overrides});}};
}
