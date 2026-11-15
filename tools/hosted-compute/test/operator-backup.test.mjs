import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {OperatorS3Bucket,operatorVaultFromEnv} from '../operator-backup.mjs';
import {encode} from '../policy.mjs';

const endpoint=`https://${'a'.repeat(32)}.r2.cloudflarestorage.com`,bucket='operator-backup-private';
const env={COMPUTE_BACKUP_ENDPOINT:endpoint,COMPUTE_BACKUP_BUCKET:bucket,COMPUTE_BACKUP_ACCESS_KEY_ID:'EXAMPLEACCESS',COMPUTE_BACKUP_SECRET_ACCESS_KEY:'example-secret-never-log'};
function service(){
 const objects=new Map(),calls=[];
 return {objects,calls,fetcher:async(url,options)=>{
  const u=new URL(url),key=decodeURIComponent(u.pathname.slice(`/${bucket}/hosted-backup/v1/`.length));calls.push({url,options});
  assert.equal(u.origin,endpoint);assert.equal(options.redirect,'error');assert.match(options.headers.authorization,/Credential=EXAMPLEACCESS\/[0-9]{8}\/auto\/s3\/aws4_request/);
  const bytes=options.body??new Uint8Array();assert.equal(options.headers['x-amz-content-sha256'],createHash('sha256').update(bytes).digest('hex'));
  const prior=objects.get(key);
  if(options.method==='PUT'){
   if(options.headers['if-none-match']==='*'&&prior||options.headers['if-match']&&options.headers['if-match']!==prior?.etag)return new Response('<secret>do not log</secret>',{status:412});
   const etag=`"${createHash('sha256').update(bytes).digest('hex')}"`;objects.set(key,{bytes:new Uint8Array(bytes),etag});return new Response('',{headers:{etag}});
  }
  if(options.method==='DELETE'){objects.delete(key);return new Response(null,{status:204});}
  if(u.searchParams.has('list-type'))return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated>${[...objects.keys()].map(k=>`<Contents><Key>hosted-backup/v1/${k}</Key></Contents>`).join('')}</ListBucketResult>`);
  return prior?new Response(prior.bytes,{headers:{etag:prior.etag}}):new Response('missing',{status:404});
 }};
}

test('operator S3 uses fixed R2 namespace, signed conditional writes and complete pagination',async()=>{
 const s=service(),b=new OperatorS3Bucket({endpoint,bucket,accessKeyId:env.COMPUTE_BACKUP_ACCESS_KEY_ID,secretAccessKey:env.COMPUTE_BACKUP_SECRET_ACCESS_KEY,fetcher:s.fetcher,now:()=>new Date('2026-11-14T12:00:00Z')});
 await b.put('objects/abc',encode('proof'),{ifNoneMatch:'*'});
 // Fixed protocol answer generated independently with Python hashlib/hmac.
 assert.equal(s.calls[0].options.headers.authorization,'AWS4-HMAC-SHA256 Credential=EXAMPLEACCESS/20261114/auto/s3/aws4_request, SignedHeaders=host;if-none-match;x-amz-content-sha256;x-amz-date, Signature=d693eb19a1a764497f1c6d5b29787858421d57c1ccdac64eb8f8703a677ab8ee');
 assert.equal(new TextDecoder().decode(await (await b.get('objects/abc')).arrayBuffer()),'proof');
 await assert.rejects(b.put('objects/abc',encode('other'),{ifNoneMatch:'*'}),e=>/state changed/.test(e.message)&&!e.message.includes('secret'));
 assert.deepEqual((await b.list()).objects,[{key:'objects/abc'}]);
 await assert.rejects(b.get('../escape'),/unsafe/);
 for(const bad of ['https://attacker.example','http://'+new URL(endpoint).host,endpoint+'/other',endpoint+'?token=secret'])assert.throws(()=>new OperatorS3Bucket({endpoint:bad,bucket,accessKeyId:'x',secretAccessKey:'y'}),/endpoint/);
});

test('operator state survives a new client and competing operators cannot overwrite it',async()=>{
 const s=service(),first=operatorVaultFromEnv(env,{fetcher:s.fetcher}),second=operatorVaultFromEnv(env,{fetcher:s.fetcher});
 await first.exclusive(async()=>{
  const state=await first.state();state.marker='retained-proof';await first.save(state);
  await assert.rejects(second.exclusive(async()=>{throw Error('must not execute');}),/lock held/);
 });
 assert.equal((await second.state()).marker,'retained-proof');
 const stale=await first.state(),fresh=await second.state();fresh.marker='newer';await second.save(fresh);
 stale.marker='stale';await assert.rejects(first.save(stale),/state changed/);assert.equal((await second.state()).marker,'newer');
 await second.exclusive(async()=>{await second.prune();});
 assert.equal((await operatorVaultFromEnv(env,{fetcher:s.fetcher}).state()).marker,'newer');assert(!s.objects.has('operator-lock'));
});

test('pagination rejects missing cursors and escapes opaque continuation tokens',async()=>{
 let count=0;const b=new OperatorS3Bucket({endpoint,bucket,accessKeyId:'x',secretAccessKey:'y',fetcher:async url=>{
  count++;if(count===1)return new Response('<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>a/+&amp;b</NextContinuationToken><Contents><Key>hosted-backup/v1/roots/a</Key></Contents></ListBucketResult>');
  assert.equal(new URL(url).searchParams.get('continuation-token'),'a/+&b');return new Response('<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>');
 }});
 const first=await b.list();assert.equal(first.cursor,'a/+&b');await assert.rejects(b.list({cursor:first.cursor}),/pagination/);
});
