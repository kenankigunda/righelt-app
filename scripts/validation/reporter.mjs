import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {hash} from './model.mjs';
export default class EvidenceReporter {
 constructor(){this.items=[];}
 onTestEnd(test,result){
 const images=[];for(const a of result.attachments??[])if(a.contentType==='application/json'&&a.name==='proof'&&a.body){try{images.push(...JSON.parse(a.body.toString()));}catch{}}
 this.items.push({id:hash(test.titlePath()).slice(0,18),title:test.titlePath().slice(1).join(' / '),viewport:test.parent.project()?.name,status:result.status==='passed'?'passed':result.status==='skipped'?'skipped':'failed',assertions:result.status==='passed'?['All assertions in this workflow passed.']:['Workflow did not pass; inspect private test logs.'],images,revision:hash({title:test.titlePath(),status:result.status,images:images.map(i=>i.digest)})});
 }
 async onEnd(){const dest=process.env.RIGHELT_EVIDENCE_JSON;if(dest){await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,JSON.stringify(this.items,null,2));}}
}
