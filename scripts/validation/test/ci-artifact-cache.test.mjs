import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, readdir, rm, mkdir, symlink, realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {cachedArtifact, artifactCacheKey} from '../ci-artifact-cache.mjs';
const bytes = Buffer.from('exact archive bytes\n');
const hash = b => createHash('sha256').update(b).digest('hex');
const get = options => cachedArtifact(options, async ({verify}) => {await verify();return path.join(options.root,`${artifactCacheKey(options)}.zip`);});
async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(),'ci-cache-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const options = {root, repository:'owner/repo', run:{id:17,run_attempt:2,head_sha:'a'.repeat(40)}, artifact:{id:23,name:'suite-unit-2',size_in_bytes:bytes.length,digest:`sha256:${hash(bytes)}`,expired:false,workflow_run:{id:17,head_sha:'a'.repeat(40)}}};
  let calls=0;
  options.download=async file=>{calls++;await writeFile(file,bytes);return {code:0};};
  return {options,calls:()=>calls};
}
test('cold archive promotes once; a hit rehashes bytes without download',async t=>{
  const {options,calls}=await fixture(t);
  const file=await get(options);assert.deepEqual(await readFile(file),bytes);
  assert.equal(await get(options),file);assert.equal(calls(),1);
  assert.deepEqual((await readdir(options.root)).filter(n=>n.endsWith('.zip')),[`${artifactCacheKey(options)}.zip`]);
  await writeFile(file,Buffer.alloc(bytes.length,1));
  await assert.rejects(get(options),/cache_digest_mismatch/);assert.equal(calls(),1);
});
test('failure preserves categorical incomplete part, no retry or successful archive',async t=>{
  const {options}=await fixture(t);let calls=0;
  options.download=async file=>{calls++;await writeFile(file,'partial');throw Error('TLS signed-url-secret');};
  await assert.rejects(get(options),/cache_incomplete_archive/);assert.equal(calls,1);
  const names=await readdir(options.root);assert.equal(names.length,1);assert.match(names[0],/\.part$/);
  const status=await readFile(path.join(options.root,names[0],'status.json'),'utf8');assert.equal(JSON.parse(status).status,'incomplete');assert.ok(!status.includes('secret'));
});
test('size mismatch, nonzero download and missing digest fail closed',async t=>{
  for (const change of ['short','long','exit','digest']) {
    const {options}=await fixture(t);
    if(change==='digest')options.artifact.digest=null;
    else options.download=async file=>{await writeFile(file,change==='short'?bytes.subarray(1):change==='long'?Buffer.concat([bytes,bytes]):bytes);return {code:change==='exit'?1:0};};
    await assert.rejects(get(options),/cache_(incomplete_archive|metadata_invalid)/);
    assert.ok(!(await readdir(options.root)).some(n=>n.endsWith('.zip')));
  }
});
test('key binds repository, run, selected attempt, ID and fresh GH digest',async t=>{
  const {options}=await fixture(t),key=artifactCacheKey(options);
  for(const mutate of [o=>o.repository='other/repo',o=>{o.run.id=18;o.artifact.workflow_run.id=18;},o=>o.artifact.name='suite-unit-1',o=>o.artifact.id=24,o=>o.artifact.digest='sha256:'+'b'.repeat(64)]) {
    const o=structuredClone({...options,download:undefined});mutate(o);assert.notEqual(artifactCacheKey(o),key);
  }
  for(const mutate of [o=>o.repository='../repo',o=>o.run.run_attempt=0,o=>o.artifact.name='suite-unit-3',o=>o.artifact.id='23',o=>o.artifact.expired=true,o=>o.artifact.digest='sha256:no',o=>o.artifact.size_in_bytes=0,o=>o.artifact.workflow_run.head_sha='b'.repeat(40),o=>o.artifact.expires_at='2000-01-01']) {
    const o=structuredClone({...options,download:undefined});mutate(o);assert.throws(()=>artifactCacheKey(o),/cache_metadata_invalid/);
  }
});
test('final symlink and symlink ancestor are rejected without fallback',async t=>{
  const {options,calls}=await fixture(t),external=path.join(options.root,'external');await writeFile(external,bytes);
  await symlink(external,path.join(options.root,`${artifactCacheKey(options)}.zip`));
  await assert.rejects(get(options));assert.equal(calls(),0);
  const dir=path.join(options.root,'actual');await mkdir(dir);await symlink(dir,path.join(options.root,'alias'));
  await assert.rejects(get({...options,root:path.join(options.root,'alias','nested')}),/cache_unsafe_ancestor/);
  assert.deepEqual(await readdir(dir),[]);
});
test('same-key concurrent writer fails immediately; foreign lock stays intact',async t=>{
  const {options}=await fixture(t);let release,entered;
  const started=new Promise(r=>{entered=r;});const gate=new Promise(r=>{release=r;});
  const first=get({...options,download:async file=>{entered();await gate;await writeFile(file,bytes);return {code:0};}});
  await started;
  try {await assert.rejects(get(options),/cache_writer_busy/);assert.ok((await readdir(options.root)).some(n=>n.endsWith('.lock')));}
  finally {release();await first;}
});
test('promotion never overwrites a completed entry introduced while downloading',async t=>{
  const {options}=await fixture(t);const final=path.join(options.root,`${artifactCacheKey(options)}.zip`);
  options.download=async file=>{await writeFile(file,bytes);await writeFile(final,'foreign');return {code:0};};
  await assert.rejects(get(options),/cache_incomplete_archive/);
  assert.equal(await readFile(final,'utf8'),'foreign');
});

test('nonregular completed entry and public writable cache root fail before download',async t=>{
  const {options,calls}=await fixture(t);
  await mkdir(path.join(options.root,`${artifactCacheKey(options)}.zip`));
  await assert.rejects(get(options),/cache_private_regular_file_required/);assert.equal(calls(),0);
  const {chmod}=await import('node:fs/promises');await chmod(options.root,0o777);
  await assert.rejects(get(options),/cache_private_owner_directory_required/);assert.equal(calls(),0);
  await chmod(options.root,0o700);
});

test('0755 and0750 roots and0644/0640 completed files are rejected without chmod or download',async t=>{
  const {chmod,stat}=await import('node:fs/promises');
  for(const mode of [0o755,0o750]) {
    const {options,calls}=await fixture(t);await chmod(options.root,mode);
    await assert.rejects(get(options),/cache_private_owner_directory_required/);
    assert.equal((await stat(options.root)).mode&0o777,mode);assert.equal(calls(),0);
    await chmod(options.root,0o700);
  }
  for(const mode of [0o644,0o640]) {
    const {options,calls}=await fixture(t);const file=await get(options);await chmod(file,mode);
    await assert.rejects(get(options),/cache_private_regular_file_required/);
    assert.equal((await stat(file)).mode&0o777,mode);assert.equal(calls(),1);
  }
});

test('replacement after verified copy and before consumption fails closed under the held lease',async t=>{
  const {unlink}=await import('node:fs/promises');const {options}=await fixture(t);
  await get(options);const final=path.join(options.root,`${artifactCacheKey(options)}.zip`);
  let verifiedCopy;
  await assert.rejects(cachedArtifact(options,async({archive,verify})=>{
    await verify();verifiedCopy=archive;
    assert.notEqual(archive,final);assert.deepEqual(await readFile(archive),bytes);
    await unlink(final);await writeFile(final,bytes,{mode:0o600});
    // Same bytes and size still cannot substitute a different inode silently.
    await verify();
  }),/cache_archive_changed/);
  assert.deepEqual(await readFile(verifiedCopy),bytes);
});

test('part substitution between descriptor verification and atomic promotion is never consumed',async t=>{
  const fs=(await import('node:fs/promises')).default;
  const {options}=await fixture(t);const originalLink=fs.link;let consumed=false,swapped=false;
  t.mock.method(fs,'link',async(from,to)=>{
    assert.match(from,/archive\.part$/);swapped=true;
    await fs.unlink(from);await fs.writeFile(from,Buffer.alloc(bytes.length,0),{mode:0o600});
    return originalLink(from,to);
  });
  try {
    await assert.rejects(cachedArtifact(options,async()=>{consumed=true;}),/cache_incomplete_archive/);
    assert.equal(swapped,true);assert.equal(consumed,false);
  } finally {t.mock.restoreAll();}
});

test('consumption copy mutation or replacement is rejected before credit',async t=>{
  const {unlink}=await import('node:fs/promises');
  for(const replace of [false,true]) {
    const {options}=await fixture(t);
    await assert.rejects(cachedArtifact(options,async({archive,verify})=>{
      if(replace)await unlink(archive);
      await writeFile(archive,Buffer.alloc(bytes.length,0),{mode:0o600});await verify();
    }),/cache_archive_changed/);
  }
});

test('streaming v1 seal is exactly producer digest(Buffer) for empty, all bytes and boundaries',async t=>{
  const {sealedLogDigest}=await import('../suite-ci-evidence.mjs');
  const {digest}=await import('../../testing/receipts.mjs');
  const {fileDigest}=await import('../reuse.mjs');
  const {options}=await fixture(t);const file=path.join(options.root,'log');
  for(const length of [0,256,65535,65536,65537,3*1024*1024+257]) {
    const raw=Buffer.alloc(length);for(let i=0;i<length;i++)raw[i]=i%256;
    await writeFile(file,raw,{mode:0o600});const expected=digest(raw);
    assert.equal(await sealedLogDigest(file),expected,`producer parity at ${length}`);
    assert.equal(await fileDigest(file),hash(raw),'raw evidence hash is a separate contract');
    if(length) {
      const changed=Buffer.from(raw);changed[Math.min(65536,length-1)]^=1;
      await writeFile(file,changed);assert.notEqual(await sealedLogDigest(file),expected,`mutated byte rejected at ${length}`);
    }
  }
});


test('temporary parent swap and restore cannot redirect inherited unlinked archive consumption',async t=>{
  const childProcess=(await import('node:child_process')).default;
  const sync=await import('node:fs');const {execFileSync}=await import('node:child_process');
  const {options,calls}=await fixture(t);
  const zipRoot=path.join(options.root,'zip-fixture');await mkdir(zipRoot,{mode:0o700});
  await writeFile(path.join(zipRoot,'payload'),'trusted');
  const trustedZip=path.join(options.root,'trusted.zip');execFileSync('zip',['-q',trustedZip,'payload'],{cwd:zipRoot});
  await writeFile(path.join(zipRoot,'payload'),'substituted');
  const substitutedZip=path.join(options.root,'substituted.zip');execFileSync('zip',['-q',substitutedZip,'payload'],{cwd:zipRoot});
  const trusted=await readFile(trustedZip);options.artifact={...options.artifact,size_in_bytes:trusted.length,digest:`sha256:${hash(trusted)}`};
  let downloads=0;options.download=async file=>{downloads++;await writeFile(file,trusted);return {code:0};};
  const originalSpawn=childProcess.spawn;let swapped=false,restored=false;
  await cachedArtifact(options,async({archive,executeArchive})=>{
    const parent=path.dirname(archive),saved=parent+'.saved';
    t.mock.method(childProcess,'spawn',(command,args,spawnOptions)=>{
      assert.equal(args[1],'/dev/fd/3');const fd=spawnOptions.stdio[3];
      assert.equal(sync.fstatSync(fd).nlink,0);assert.throws(()=>sync.writeSync(fd,Buffer.from('x')),/EBADF/);
      sync.renameSync(parent,saved);sync.mkdirSync(parent,{mode:0o700});sync.copyFileSync(substitutedZip,archive);sync.chmodSync(archive,0o600);swapped=true;
      const child=originalSpawn(command,args,spawnOptions);
      child.prependOnceListener('close',()=>{sync.rmSync(parent,{recursive:true});sync.renameSync(saved,parent);restored=true;});
      return child;
    });
    try {const result=await executeArchive(['unzip','-p',archive,'payload'],{cwd:options.root});assert.equal(result.output,'trusted');}
    finally {t.mock.restoreAll();}
  });
  assert.equal(swapped,true);assert.equal(restored,true);assert.equal(downloads,1);assert.equal(calls(),0);
});

test('part parent swap restored after link cannot promote different bytes',async t=>{
  const fs=(await import('node:fs/promises')).default;
  const {options}=await fixture(t);const originalLink=fs.link;let consumed=false,swapped=false;
  t.mock.method(fs,'link',async(from,to)=>{
    const parent=path.dirname(from),saved=parent+'.saved';
    await fs.rename(parent,saved);await fs.mkdir(parent,{mode:0o700});
    await fs.writeFile(from,Buffer.alloc(bytes.length,0),{mode:0o600});swapped=true;
    try{return await originalLink(from,to);}
    finally{await fs.rm(parent,{recursive:true});await fs.rename(saved,parent);}
  });
  try{await assert.rejects(cachedArtifact(options,async()=>{consumed=true;}),/cache_incomplete_archive/);assert.equal(swapped,true);assert.equal(consumed,false);}
  finally{t.mock.restoreAll();}
});


test('recorded archive digest remains bound to trusted bytes across restored namespace substitution',async t=>{
  const fs=(await import('node:fs/promises')).default;const {options}=await fixture(t);
  await cachedArtifact(options,async({archive,archiveHash,verify})=>{
    const parent=path.dirname(archive),saved=parent+'.saved';
    await verify();await fs.rename(parent,saved);await fs.mkdir(parent,{mode:0o700});
    try {
      const substituted=Buffer.alloc(bytes.length,1);await fs.writeFile(archive,substituted,{mode:0o600});
      assert.notEqual(hash(await fs.readFile(archive)),archiveHash);
      assert.equal(archiveHash,options.artifact.digest.slice(7));
    } finally {await fs.rm(parent,{recursive:true});await fs.rename(saved,parent);}
    await verify();
  });
});


test('repository identity rejects path components and invalid slugs while retaining normal names',async t=>{
  const {options}=await fixture(t);
  for(const repository of ['kenankigunda/righelt-app','octo-cat/.github','A1/repo.name_1-2','a/a','a'.repeat(39)+'/'+'r'.repeat(100)])assert.match(artifactCacheKey({...options,repository}),/^[a-f0-9]{64}$/);
  for(const repository of ['../repo','./repo','owner/.','owner/..','-owner/repo','owner-/repo','own--er/repo','owner.name/repo','owner/repo/extra','owner/repo%2fother','owner/repo name','owner/repo.git','owner/repo.wiki','a'.repeat(40)+'/r','a/'+'r'.repeat(101)])assert.throws(()=>artifactCacheKey({...options,repository}),/cache_metadata_invalid/);
});

test('repeated descriptor verification uses positioned reads without accumulating stream listeners',async t=>{
  const fs=(await import('node:fs/promises')).default;const {options}=await fixture(t);
  const sample=await fs.open(path.join(options.root,'sample'),'wx',0o600);const prototype=Object.getPrototypeOf(sample);await sample.close();
  const originalRead=prototype.read,seen=new Map();let reads=0;
  t.mock.method(prototype,'createReadStream',()=>{throw Error('held descriptor must not create a read stream');});
  t.mock.method(prototype,'read',async function(...args){
    if(!seen.has(this))seen.set(this,this.listenerCount('close'));
    assert.equal(typeof args[3],'number');reads++;
    const result=await originalRead.apply(this,args);
    assert.equal(this.listenerCount('close'),seen.get(this));return result;
  });
  try {
    await cachedArtifact(options,async({verify})=>{for(let i=0;i<40;i++)await verify();});
    assert.ok(reads>40);for(const [handle,count]of seen)assert.equal(handle.listenerCount('close'),count);
  }finally{t.mock.restoreAll();}
});
