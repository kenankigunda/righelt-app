import {deflateSync,inflateSync} from 'node:zlib';
export function compactStatus(run,{afterCursor}={}){
 const states={};
 for(const stage of run.stages??[]){states[`stage:${stage.id}`]=stage.status??null;for(const check of stage.checks??[])states[`check:${stage.id}:${check.name}`]=check.status??null;}
 for(const pr of run.prs??[])for(const key of ['head','checks','review','preview','merged'])states[`pr:${pr.number}:${key}`]=pr[key]??null;
 for(const pr of run.prs??[])states[`pr:${pr.number}:authorization`]=pr.authorization?.state??null;
 states.complete=run.complete===true;
 const active=(run.stages??[]).flatMap(s=>(s.activeChecks??[]).map(name=>({stage:s.id,name})));
 const snapshot={id:run.id??null,states,active,risks:run.risks??[]};
 const cursor='v1.'+deflateSync(JSON.stringify(snapshot)).toString('base64url');
 if(cursor===afterCursor)return {cursor,changed:false};
 let previous;try{if(afterCursor?.startsWith('v1.')&&afterCursor.length<16384)previous=JSON.parse(inflateSync(Buffer.from(afterCursor.slice(3),'base64url'),{maxOutputLength:65536}));}catch{}
 const sameRun=previous?.id===snapshot.id;
 const changes=Object.entries(states).filter(([key,value])=>!sameRun||previous.states?.[key]!==value).map(([key,value])=>({key,status:value}));
 if(sameRun)for(const key of Object.keys(previous.states??{}))if(!(key in states))changes.push({key,status:'removed'});
 const failures=Object.entries(states).filter(([,value])=>value==='failed').map(([key])=>key);
 const blockers=Object.entries(states).filter(([,value])=>['blocked','stale','unknown'].includes(value)).map(([key])=>key);
 const status=failures.length?'failed':run.complete?'complete':'in-progress';
 return {cursor,changed:true,id:snapshot.id,status,complete:snapshot.states.complete,changes,failures,blockers,active,risks:snapshot.risks,nextAction:active.length?'Wait for active checks':failures.length?'Inspect the named failed check and its private log':blockers.length?'Resolve the named blocked or stale evidence':run.complete?'Review final evidence and refresh merge gates':'Continue the next required check'};
}
