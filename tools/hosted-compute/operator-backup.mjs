// Node-only operator adapter. Never import this module into a Worker or Pod.
import {createHash, createHmac, randomUUID} from 'node:crypto';
import {BackupVault} from './backup.mjs';
import {assert, canonical, encode, POLICY} from './policy.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hmac = (key, text) => createHmac('sha256',key).update(text).digest();
const escape = s => encodeURIComponent(s).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const text = bytes => new TextDecoder().decode(bytes);
const unxml = s => s.replace(/&(amp|lt|gt|quot|apos);/g,(_,x)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[x])).replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,x)=>String.fromCodePoint(x[0].toLowerCase()==='x'?parseInt(x.slice(1),16):Number(x)));

export class OperatorS3Bucket {
  constructor({endpoint,bucket,accessKeyId,secretAccessKey,fetcher=fetch,now=()=>new Date()}) {
    const url=new URL(endpoint);
    assert(url.protocol==='https:' && /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(url.hostname) && !url.username && !url.password && !url.port && url.pathname==='/' && !url.search && !url.hash,'exact private R2 account endpoint required');
    assert(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) && accessKeyId && secretAccessKey,'bucket-scoped backup credentials required');
    Object.assign(this,{endpoint:url.origin,bucket,accessKeyId,secretAccessKey,fetcher,now});
    this.prefix='hosted-backup/v1/';
  }
  async request(method,key='',body,query={},conditions={}) {
    assert(key==='' || key.split('/').every(p=>/^[a-zA-Z0-9_.-]+$/.test(p)&&p!=='.'&&p!=='..'),'unsafe backup object key');
    const pathname=`/${this.bucket}/${this.prefix.split('/').map(escape).join('/')}${key.split('/').map(escape).join('/')}`;
    // Listing is bucket-level, with an exact private namespace prefix.
    const path=key===''&&query['list-type']?`/${this.bucket}`:pathname;
    const search=Object.entries(query).map(([k,v])=>[escape(k),escape(String(v))]).sort(([a,av],[b,bv])=>a<b?-1:a>b?1:av<bv?-1:av>bv?1:0).map(([k,v])=>`${k}=${v}`).join('&');
    const date=this.now().toISOString().replace(/[:-]|\.\d{3}/g,''), day=date.slice(0,8), payload=body??new Uint8Array();
    const headers={'host':new URL(this.endpoint).host,'x-amz-content-sha256':digest(payload),'x-amz-date':date,...conditions};
    const names=Object.keys(headers).sort(), signed=names.join(';'), headerText=names.map(n=>`${n}:${String(headers[n]).trim()}\n`).join('');
    const request=[method,path,search,headerText,signed,digest(payload)].join('\n');
    const scope=`${day}/auto/s3/aws4_request`, toSign=`AWS4-HMAC-SHA256\n${date}\n${scope}\n${digest(request)}`;
    const keyDate=hmac(`AWS4${this.secretAccessKey}`,day), keyRegion=hmac(keyDate,'auto'), keyService=hmac(keyRegion,'s3');
    headers.authorization=`AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${hmac(hmac(keyService,'aws4_request'),toSign).toString('hex')}`;
    const response=await this.fetcher(`${this.endpoint}${path}${search?'?'+search:''}`,{method,headers,body:method==='PUT'?payload:undefined,redirect:'error',signal:AbortSignal.timeout(POLICY.requestMs)});
    if(response.status===404&&method==='GET')return null;
    assert(response.ok, response.status===412?'backup state changed or operator lock held':'backup S3 operation failed');
    return response;
  }
  async get(key) { const r=await this.request('GET',key);if(!r)return null;assert(Number(r.headers.get('content-length')??0)<=POLICY.maxObjectBytes,'backup response exceeds object limit');const bytes=new Uint8Array(await r.arrayBuffer());assert(bytes.length<=POLICY.maxObjectBytes,'backup response exceeds object limit');return {etag:r.headers.get('etag'),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}; }
  async put(key,bytes,{ifMatch,ifNoneMatch}={}) {const headers={};if(ifMatch)headers['if-match']=ifMatch;if(ifNoneMatch)headers['if-none-match']=ifNoneMatch;const r=await this.request('PUT',key,bytes,{},headers);return {etag:r.headers.get('etag')};}
  async delete(key) {await this.request('DELETE',key);}
  async list({cursor}={}) {
    const query={'list-type':2,prefix:this.prefix,'max-keys':1000};if(cursor)query['continuation-token']=cursor;
    const response=await this.request('GET','',undefined,query),xml=await response.text();
    assert(xml.length<4*1024*1024 && !/<!DOCTYPE|<!ENTITY/i.test(xml),'invalid backup inventory');
    const objects=[...xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map(m=>{const key=unxml(m[1]);assert(key.startsWith(this.prefix),'backup inventory escaped namespace');return {key:key.slice(this.prefix.length)};});
    const flag=xml.match(/<IsTruncated>(true|false)<\/IsTruncated>/)?.[1];assert(flag,'backup pagination missing');
    const next=xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1];assert(flag==='false'||next,'backup pagination incomplete');
    return {objects,truncated:flag==='true',cursor:next?unxml(next):undefined};
  }
}

class BucketStorage {
  constructor(bucket){this.bucket=bucket;this.etags=new Map();}
  async get(key){const object=await this.bucket.get(`state/${key}.json`);this.etags.set(key,object?.etag??null);return object?JSON.parse(text(await object.arrayBuffer())):undefined;}
  async put(key,value){assert(this.etags.has(key),'read backup state before modifying it');const etag=this.etags.get(key);const result=await this.bucket.put(`state/${key}.json`,encode(canonical(value)),etag?{ifMatch:etag}:{ifNoneMatch:'*'});assert(result.etag,'backup state ETag missing');this.etags.set(key,result.etag);}
}

export function operatorVaultFromCredentials(credentials,options={}) {
  const bucket=new OperatorS3Bucket({...credentials,...options});
  const vault=new BackupVault({bucket,storage:new BucketStorage(bucket)});
  vault.exclusive=async fn=>{
    const owner=encode(randomUUID());await bucket.put('operator-lock',owner,{ifNoneMatch:'*'});
    try{return await fn();}finally{const object=await bucket.get('operator-lock');assert(object&&digest(new Uint8Array(await object.arrayBuffer()))===digest(owner),'operator lock ownership changed');await bucket.delete('operator-lock');}
  };
  return vault;
}

// Compatibility for isolated/test environments. Production CLI should obtain
// the dedicated credentials in-process from the operator credential provider.
export function operatorVaultFromEnv(env=process.env,options={}) {
  return operatorVaultFromCredentials({endpoint:env.COMPUTE_BACKUP_ENDPOINT,bucket:env.COMPUTE_BACKUP_BUCKET,accessKeyId:env.COMPUTE_BACKUP_ACCESS_KEY_ID,secretAccessKey:env.COMPUTE_BACKUP_SECRET_ACCESS_KEY},options);
}
