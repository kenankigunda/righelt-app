// Test-only native lifecycle observation. Preserve each native return value,
// exception, transaction and request handler. Never read command contents.
export function installJournalObservations() {
 const records=[],ids=new WeakMap();let sequence=0,dropped=0;
 const id=value=>{if(!ids.has(value))ids.set(value,++sequence);return ids.get(value);};
 const record=(event,details)=>{try{if(records.length<1024)records.push({at:Date.now(),elapsed:performance.now(),event,...details});else dropped++;}catch{}};
 let eventLoopTicks=0,lastTick=performance.now();
 // Distinguish delayed browser-task delivery from an IndexedDB backend stall.
 // This observes scheduling only. Context teardown retires the owned timer.
 setInterval(()=>{
  const now=performance.now(),gapMs=now-lastTick;lastTick=now;eventLoopTicks++;
  if(gapMs>500)record('event-loop-gap',{gapMs});
 },100);
 window.retreatJournalObservations={records,get dropped(){return dropped;},get eventLoopTicks(){return eventLoopTicks;}};
 const relevant=name=>typeof name==='string'&&name.startsWith('righelt.online-commands');
 const errorName=value=>{try{return value.error?.name;}catch{return undefined;}};
 const open=IDBFactory.prototype.open;
 IDBFactory.prototype.open=function(...args){
  const request=Reflect.apply(open,this,args);
  if(relevant(args[0])){
   const requestId=id(request);record('open',{requestId});
   for(const event of ['upgradeneeded','blocked','error','success'])request.addEventListener(event,()=>{
    const connectionId=event==='success'?id(request.result):undefined;
    record('open-'+event,{requestId,connectionId,error:errorName(request)});
    if(event==='success')request.result.addEventListener('versionchange',()=>record('versionchange',{connectionId}));
   });
  }
  return request;
 };
 const transaction=IDBDatabase.prototype.transaction;
 IDBDatabase.prototype.transaction=function(...args){
  const tx=Reflect.apply(transaction,this,args);
  if(relevant(this.name)){
   const transactionId=id(tx);record('transaction',{transactionId,connectionId:id(this),mode:tx.mode,stores:Array.from(tx.objectStoreNames)});
   for(const event of ['complete','abort','error'])tx.addEventListener(event,()=>record('transaction-'+event,{transactionId,error:errorName(tx)}));
  }
  return tx;
 };
 const close=IDBDatabase.prototype.close;
 IDBDatabase.prototype.close=function(...args){
  const result=Reflect.apply(close,this,args);
  if(relevant(this.name))record('close',{connectionId:id(this)});
  return result;
 };
 for(const method of ['get','getAll','add','put','delete']){
  const native=IDBObjectStore.prototype[method];
  IDBObjectStore.prototype[method]=function(...args){
   const request=Reflect.apply(native,this,args);
   if(this.name==='commands'&&relevant(this.transaction.db.name)){
    const transactionId=id(this.transaction),requestId=id(request);record('request',{transactionId,requestId,method});
    for(const event of ['success','error'])request.addEventListener(event,()=>record('request-'+event,{transactionId,requestId,method,error:errorName(request)}));
   }
   return request;
  };
 }
}
