import test from 'node:test';
import assert from 'node:assert/strict';
import { ghCliFetch,GhCliControlWriter } from '../gh-cli-control.mjs';
import { buildPrearm } from '../external-control.mjs';
import { syntheticGithubUsage } from './github-usage-fixture.mjs';

test('operator transport invokes existing gh login with structured stdin, no shell or credential environment',async()=>{
  const calls=[];
  const exec=(file,args,options,callback)=>{
    const call={file,args,options};calls.push(call);
    return {stdin:{end(body){call.body=body;queueMicrotask(()=>callback(null,'HTTP/2.0 201 Created\r\nContent-Type: application/json\r\n\r\n{"ok":true}'));}}};
  };
  const fetcher=ghCliFetch(exec),body=JSON.stringify({private:'sensitive payload',newlines:'one\ntwo'});
  const response=await fetcher('https://api.github.com/repos/owner/control/contents/control/prearms/aa.json',{method:'PUT',body});
  assert.deepEqual(await response.json(),{ok:true});
  assert.equal(calls[0].file,'gh');assert.equal(calls[0].body,body);
  assert.deepEqual(calls[0].args,['api','--hostname','github.com','--method','PUT','--include','repos/owner/control/contents/control/prearms/aa.json','--input','-']);
  assert(!calls[0].args.some(x=>x.includes('sensitive payload') || x.includes('auth token')));
  for(const key of ['GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN']) assert.equal(calls[0].options.env[key],undefined);
  assert.equal(calls[0].options.shell,undefined);
  await assert.rejects(fetcher('https://attacker.test/repos/owner/control'),/fixed GitHub/);
  assert.equal(calls.length,1);
});
test('CLI writer completes immutable prearm commit/readback without a token export',async()=>{
  const repository='owner/private-control',files=new Map(),commits=new Map(),calls=[];let sequence=0;
  const exec=(file,args,options,callback)=>({stdin:{end:body=>{
    calls.push({file,args,body});
    const path=args[args.indexOf('--include')+1],url=new URL(`https://api.github.com/${path}`),method=args[args.indexOf('--method')+1];
    let code=200,result;
    if(url.pathname===`/repos/${repository}`) result={private:true,full_name:repository,default_branch:'main'};
    else {
      const key=url.pathname.slice(`/repos/${repository}/contents/`.length);
      if(method==='PUT') {
        const input=JSON.parse(body),sha=(++sequence).toString(16).padStart(40,'0');
        assert.equal(input.sha,undefined);files.set(key,Buffer.from(input.content,'base64').toString());commits.set(sha,new Map(files));result={commit:{sha}};code=201;
      } else {
        const ref=url.searchParams.get('ref'),raw=(ref==='main'?files:commits.get(ref))?.get(key);
        if(raw===undefined) {code=404;result={message:'Not Found'};}
        else result={type:'file',size:Buffer.byteLength(raw),encoding:'base64',content:Buffer.from(raw).toString('base64')};
      }
    }
    queueMicrotask(()=>callback(code>=400?Error('HTTP status'):null,`HTTP/2.0 ${code} status\nContent-Type: application/json\n\n${JSON.stringify(result)}`));
  }}});
  const writer=new GhCliControlWriter({repository,execFile:exec});
  const now=Date.UTC(2026,10,14),record=await buildPrearm({id:'pilot',deadline:now+3600000,phases:[{id:'training',host:{image:`image@sha256:${'b'.repeat(64)}`}}]},
    {accountId:'account',accountEvidenceReference:'operator-key-scope',createdAt:now,fundedCutoff:now+3000000,workflowRevision:'a'.repeat(40),controlRepository:repository,githubUsage:syntheticGithubUsage(now,now+3000000,{repository})});
  const reference=await writer.prearm(record);
  assert.equal(reference.commit,'1'.padStart(40,'0'));assert.equal((await writer.readPrearm(reference)).nonce,record.nonce);
  assert.equal(calls.filter(x=>x.args.includes('PUT')).length,1);
  assert(calls.every(x=>!x.args.includes('auth') && !x.args.includes('--header')));
});
test('CLI failures and private API response bodies remain redacted',async()=>{
  const failed=ghCliFetch((_file,_args,_options,callback)=>({stdin:{end(){queueMicrotask(()=>callback(Error('private credential text'),'unexpected secret body'));}}}));
  await assert.rejects(failed('https://api.github.com/repos/owner/control'),e=>e.message==='GitHub CLI request unavailable');
  const forbidden=ghCliFetch((_file,_args,_options,callback)=>({stdin:{end(){queueMicrotask(()=>callback(Error('403'),'HTTP/2.0 403 Forbidden\n\nprivate body'));}}}));
  const response=await forbidden('https://api.github.com/repos/owner/control');assert.equal(response.status,403);
});
