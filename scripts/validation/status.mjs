import {evidenceKey} from './reuse.mjs';
export function compactStatus(run,{afterCursor}={}){
 const snapshot={id:run.id??null,complete:run.complete===true,status:run.stages?.some(stage=>stage.status==='failed')?'failed':run.complete?'complete':'in-progress',stages:(run.stages??[]).map(stage=>({id:stage.id??null,status:stage.status??null,checks:(stage.checks??[]).map(check=>({name:check.name??null,status:check.status??null}))})),waiting:(run.prs??[]).map(pr=>({number:pr.number??null,head:pr.head??null,checks:pr.checks??null,review:pr.review??null,preview:pr.preview??null,merged:pr.merged===true,authorization:pr.authorization?.state??null})),risks:run.risks??[]};
 const cursor=evidenceKey(snapshot);return cursor===afterCursor?{cursor,changed:false}:{cursor,changed:true,...snapshot};
}
