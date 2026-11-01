// Shares the existing sanitized, local issue reports; never emits UI updates.
export function createGuidanceIncidentSink({gameId,diagnostics}){
 let active=null,captured=false;
 const stages={request:'analysis_request_failed','result-validation':'analysis_result_invalid',presentation:'guidance_presentation_failed'};
 const key=episode=>`guidance:${gameId}:${episode}`;
 return event=>{
  if(event.phase==='started'){active=event.episode;captured=false;return;}
  if(event.episode!==active)return;
  if(event.phase==='failed'){
   if(captured)return;
   diagnostics.capture(key(active),{gameId,operation:'rush_guidance',stage:stages[event.stage]??stages.request,code:event.code,elapsedMs:event.elapsedMs,deadlineMs:event.deadlineMs});captured=true;
  }else if(event.phase==='resolved'||event.phase==='retired'){
   if(captured)diagnostics.resolve(key(active));active=null;captured=false;
  }
 };
}
