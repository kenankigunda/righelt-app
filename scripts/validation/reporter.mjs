import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {hash} from './model.mjs';
export default class EvidenceReporter {
 constructor(){this.items=[];}
 onTestEnd(test,result){
 const behaviors=[];for(const a of result.attachments??[])if(a.contentType==='application/json'&&a.name==='behavior'&&a.body){try{const value=JSON.parse(a.body.toString());if(typeof value.label==='string'&&typeof value.checkpoint==='string')behaviors.push({label:value.label,checkpoint:value.checkpoint});}catch{}}
 const project=test.parent.project();const use=project?.use??{};const client={browser:use.browserName??'chromium',viewport:project?.name,width:use.viewport?.width,height:use.viewport?.height,hasTouch:use.hasTouch===true};
 const images=[];for(const a of result.attachments??[])if(a.contentType==='application/json'&&a.name==='proof'&&a.body){try{images.push(...JSON.parse(a.body.toString()));}catch{}}
 this.items.push({id:hash(test.titlePath()).slice(0,18),title:test.titlePath().slice(1).join(' / '),viewport:project?.name,client,behaviors,status:result.status==='passed'?'passed':result.status==='skipped'?'skipped':'failed',assertions:result.status==='passed'?[...behaviors.map(b=>`Reached: ${b.label}.`),'All assertions in this workflow passed.']:result.status==='skipped'?['Workflow was skipped; no pass or failure was recorded.']:['Workflow did not pass; inspect private test logs.'],images,revision:hash({title:test.titlePath(),status:result.status,behaviors,client,images:images.map(i=>i.digest)})});
 }
 async onEnd(){const dest=process.env.RIGHELT_EVIDENCE_JSON;if(dest){await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,JSON.stringify(this.items,null,2));}}
}
