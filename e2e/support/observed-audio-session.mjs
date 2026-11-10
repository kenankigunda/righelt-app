import {installPassiveAudioObservations} from './audio-observations.mjs';
import {installBoardAdmissionDiagnostics} from './board-admission-diagnostics.mjs';
import {writeFile} from 'node:fs/promises';

export const createObservedAudioSession=async({ownerContext,viewerContext},info,{instrument,installAdmission=installBoardAdmissionDiagnostics,writeObservation=writeFile}={})=>{
 await ownerContext.addInitScript(installPassiveAudioObservations);await viewerContext.addInitScript(installPassiveAudioObservations);
 await ownerContext.addInitScript(instrument);await viewerContext.addInitScript(instrument);
 const owner=await ownerContext.newPage(),viewer=await viewerContext.newPage();
 const admission=info?.title==='real audio remote finalization deduplicates its durable receipt while its owner stays muted'
  ? await installAdmission(owner,info,{baseURL:info.project.use.baseURL,armAction:'end-turn'}) : null;
 const observations={owner:[],viewer:[]};
 const retain=async(label,page,phase)=>{observations[label].push({phase,...await page.evaluate(()=>({timeline:window.passiveAudioObservations,probe:window.destructionAudioProbe,ui:window.passiveAudioUiState?.()})).catch(error=>({readError:String(error)}))});};
 return {owner,viewer,retain,async attach(info){
  try{for(const [label,page]of[['owner',owner],['viewer',viewer]]){
   await retain(label,page,'final');
   const path=info.outputPath(`audio-observations-${label}.json`);await writeObservation(path,JSON.stringify(observations[label],null,2));await info.attach(`Passive native audio ${label}`,{path,contentType:'application/json'});
  }}finally{await admission?.persist();}
 }};
};
