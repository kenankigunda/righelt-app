import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installBrowsers,ubuntuArchiveMirrors} from '../install-browsers.mjs';
const original='http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n';
const hosted={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',PROJECT:'webkit'};

test('official fallback selection removes only the exact slow Azure mirror',()=>{
 const extra='# keep comments\nhttps://other.example/ubuntu/\tpriority:4\n';
 assert.equal(ubuntuArchiveMirrors(original+extra),original.split('\n').slice(1).join('\n')+extra);
 assert.equal(ubuntuArchiveMirrors('http://azureXarchiveXubuntuXcom/ubuntu/\n'),'http://azureXarchiveXubuntuXcom/ubuntu/\n');
 assert.throws(()=>ubuntuArchiveMirrors(original.replace('https://security.ubuntu.com','http://security.ubuntu.com')),/fallback mirror/);
 const selected=ubuntuArchiveMirrors(original);assert.equal(ubuntuArchiveMirrors(selected),selected);
});
test('hosted Linux selects mirrors before a single unchanged browser install',()=>{
 const calls=[];
 const status=installBrowsers({env:hosted,platform:'linux',read:(file,encoding)=>{assert.equal(file,'/etc/apt/apt-mirrors.txt');assert.equal(encoding,'utf8');return original;},spawn:(...args)=>{calls.push(args);return {status:0};}});
 assert.equal(status,0);assert.equal(calls.length,2);
 assert.deepEqual(calls[0],['sudo',['tee','/etc/apt/apt-mirrors.txt'],{input:ubuntuArchiveMirrors(original),stdio:['pipe','ignore','inherit']}]);
 assert.deepEqual(calls[1],['pnpm',['exec','playwright','install','--with-deps','webkit'],{stdio:'inherit'}]);
});
test('local, non-Linux and self-hosted installs never read or write system mirrors',()=>{
 for(const [env,platform] of [[{},'linux'],[hosted,'darwin'],[{...hosted,RUNNER_ENVIRONMENT:'self-hosted'},'linux']]){
  const calls=[];assert.equal(installBrowsers({env,platform,read:()=>{throw Error('unexpected system read');},spawn:(...args)=>{calls.push(args);return {status:0};}}),0);
  assert.equal(calls.length,1);assert.equal(calls[0][0],'pnpm');
 }
});
test('mirror write failure stops installation and browser failure is not retried',()=>{
 let count=0;assert.throws(()=>installBrowsers({env:hosted,platform:'linux',read:()=>original,spawn:()=>{count++;return {status:1};}}),/Could not select/);assert.equal(count,1);
 count=0;assert.equal(installBrowsers({env:{PROJECT:'firefox'},platform:'linux',spawn:()=>{count++;return {status:7};}}),7);assert.equal(count,1);
 assert.equal(installBrowsers({env:{},spawn:()=>({status:null})}),1);
});
test('unknown project fails before changing mirrors or installing',()=>{
 assert.throws(()=>installBrowsers({env:{...hosted,PROJECT:'unknown'},platform:'linux',read:()=>{throw Error('unexpected read');},spawn:()=>{throw Error('unexpected install');}}),/Unknown browser/);
});
test('hosted Firefox installs native audio dependencies only after the browser install succeeds',()=>{
 const env={...hosted,CI:'true',PROJECT:'firefox'},calls=[];
 assert.equal(installBrowsers({env,platform:'linux',read:()=>original,spawn:(...args)=>{calls.push(args);return {status:0};}}),0);
 assert.deepEqual(calls.at(-1),['sudo',['apt-get','install','--yes','--no-install-recommends','pulseaudio','pulseaudio-utils'],{stdio:'inherit'}]);
 assert.equal(calls.length,3);
 let count=0;
 assert.equal(installBrowsers({env,platform:'linux',read:()=>ubuntuArchiveMirrors(original),spawn:()=>{count++;return {status:8};}}),8);
 assert.equal(count,1);
});
