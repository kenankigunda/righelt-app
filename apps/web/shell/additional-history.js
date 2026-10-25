const sameScope=(a,b)=>Boolean(a&&b&&a.gameId===b.gameId&&a.owner===b.owner&&a.generation===b.generation&&a.revision===b.revision);

// Ordinary history never fetches private notes or preloads unbounded archive pages.
export function createAdditionalHistory({getScope,load,onChange=()=>{}}) {
 const records=new Map();
 const current=gameId=>{
  const scope=getScope(gameId);
  if(!scope||!Number.isSafeInteger(scope.revision))return null;
  let state=records.get(gameId);
  if(!sameScope(state?.scope,scope)){
   state={scope,items:[],available:false,loaded:false,cursor:null,metadata:false,loading:false,error:null,promise:null};
   records.set(gameId,state);
  }
  return state;
 };
 const request=(gameId,metadataOnly)=>{
  const state=current(gameId);if(!state)return Promise.resolve();
  if(state.promise)return state.promise;
  if(!metadataOnly&&state.loaded&&!state.cursor)return Promise.resolve();
  const scope=state.scope,cursor=metadataOnly?null:state.cursor;
  state.loading=true;state.error=null;state.retryMetadata=metadataOnly;
  state.promise=Promise.resolve().then(()=>load(scope,{metadataOnly,cursor,historyRevision:scope.revision})).then(page=>{
   if(records.get(gameId)!==state||!sameScope(scope,getScope(gameId)))return;
   if(page.gameplayRevision!==scope.revision)throw Error('history_changed');
   state.metadata=true;state.available=page.available;state.partial=page.partial;
   if(!metadataOnly){
    state.items=[...new Map([...state.items,...page.items].map(item=>[item.id,item])).values()];
    state.loaded=true;state.cursor=page.nextCursor;
   }
  }).catch(error=>{
   if(records.get(gameId)===state&&sameScope(scope,getScope(gameId)))state.error=error;
  }).finally(()=>{
   if(records.get(gameId)===state){state.promise=null;state.loading=false;if(sameScope(scope,getScope(gameId)))onChange(gameId);}
  });
  return state.promise;
 };
 return {
  snapshot:gameId=>current(gameId),
  ensure(gameId){const state=current(gameId);return state&&!state.metadata&&!state.error?request(gameId,true):state?.promise??Promise.resolve();},
  more:gameId=>request(gameId,false),
  retry(gameId){const state=current(gameId);return state?.error?request(gameId,state.retryMetadata):Promise.resolve();},
  clear(){records.clear();},
 };
}
