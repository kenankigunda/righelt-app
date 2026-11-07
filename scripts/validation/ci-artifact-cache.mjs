import path from 'node:path';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import childProcess from 'node:child_process';
import {writeSync} from 'node:fs';
const {lstat,mkdir,open,unlink,rmdir,writeFile} = fs;
const fail = code => Object.assign(new Error(code), {code});
const positive = value => Number.isSafeInteger(value) && value > 0;
const same = (a,b) => a.dev === b.dev && a.ino === b.ino;
const privateMode = (s,mode) => (s.mode & 0o7777) === mode && (!process.getuid || s.uid === process.getuid());
function repositoryIdentity(value) {
  if(typeof value!=='string')return false;
  const parts=value.split('/');if(parts.length!==2)return false;
  const [owner,repo]=parts;
  // Canonical GitHub.com owner and repository slugs, not URL/path components.
  return owner.length<=39&&/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(owner)&&
    repo.length<=100&&/^[A-Za-z0-9._-]+$/.test(repo)&&repo!=='.'&&repo!=='..'&&
    !/\.(?:git|wiki)$/i.test(repo);
}
async function* readOwned(owned) {
  const buffer=Buffer.allocUnsafe(64*1024);let position=0;
  for(;;) {
    const {bytesRead}=await owned.handle.read(buffer,0,buffer.length,position);
    if(!bytesRead)return;
    position+=bytesRead;yield buffer.subarray(0,bytesRead);
  }
}
export function artifactCacheKey({repository, run, artifact}) {
  const attemptText = /^suite-.+-(\d+)$/.exec(artifact.name ?? '')?.[1];
  const attempt = Number(attemptText);
  if (!repositoryIdentity(repository) || !positive(run.id) ||
      !positive(run.run_attempt) || !/^[a-f0-9]{40}$/.test(run.head_sha ?? '') ||
      !positive(attempt) || String(attempt) !== attemptText || attempt > run.run_attempt ||
      !positive(artifact.id) || artifact.workflow_run?.id !== run.id ||
      artifact.workflow_run?.head_sha !== run.head_sha || artifact.expired ||
      !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? '') ||
      !positive(artifact.size_in_bytes) ||
      (artifact.expires_at != null && (!Number.isFinite(Date.parse(artifact.expires_at)) || Date.parse(artifact.expires_at) <= Date.now())))
    throw fail('cache_metadata_invalid');
  return createHash('sha256').update(JSON.stringify([
    repository, run.id, attempt, artifact.id, artifact.digest,
  ])).digest('hex');
}
async function directoryChain(root, create = false) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.normalize(root) !== root || root === path.parse(root).root)
    throw fail('cache_absolute_canonical_directory_required');
  const result = [];
  let current = path.parse(root).root;
  for (const segment of root.slice(current.length).split(path.sep)) {
    current = path.join(current, segment);
    let info;
    try { info = await lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      try { await mkdir(current, {mode:0o700}); }
      catch (e) { if (e.code !== 'EEXIST') throw e; }
      info = await lstat(current);
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw fail('cache_unsafe_ancestor');
    result.push({path:current, info});
  }
  if (!privateMode(result.at(-1).info,0o700)) throw fail('cache_private_owner_directory_required');
  return result;
}
async function assertChain(root, chain) {
  const next = await directoryChain(root);
  if (next.length !== chain.length || next.some((entry,i) => !same(entry.info,chain[i].info)))
    throw fail('cache_ancestor_changed');
}
async function openArchive(file) {
  const entry = await lstat(file);
  if (!entry.isFile() || entry.isSymbolicLink() || !privateMode(entry,0o600)) throw fail('cache_private_regular_file_required');
  const handle = await open(file,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info=await handle.stat();
    if (!same(entry,info) || !info.isFile() || !privateMode(info,0o600)) throw fail('cache_archive_changed');
    return {handle,info};
  } catch(error) {await handle.close();throw error;}
}
async function assertFile(file, owned) {
  const now=await owned.handle.stat(),entry=await lstat(file);
  if (!same(owned.info,now) || !same(now,entry) || !entry.isFile() || entry.isSymbolicLink() ||
      !privateMode(now,0o600) || !privateMode(entry,0o600) || now.size!==owned.info.size ||
      now.mtimeMs!==owned.info.mtimeMs || now.ctimeMs!==owned.info.ctimeMs)
    throw fail('cache_archive_changed');
}
async function verifyFD(owned,artifact) {
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of readOwned(owned)) {
    bytes+=chunk.length;hash.update(chunk);
    if(bytes>artifact.size_in_bytes)throw fail('cache_size_mismatch');
  }
  if(bytes!==artifact.size_in_bytes)throw fail('cache_size_mismatch');
  if(`sha256:${hash.digest('hex')}`!==artifact.digest)throw fail('cache_digest_mismatch');
}
async function assertUnlinked(owned,artifact) {
  const info=await owned.handle.stat();
  if(!same(info,owned.info)||!info.isFile()||!privateMode(info,0o600)||info.nlink!==0||
     info.size!==owned.info.size||info.mtimeMs!==owned.info.mtimeMs||info.ctimeMs!==owned.info.ctimeMs)
    throw fail('cache_unlinked_reader_changed');
  await verifyFD(owned,artifact);
}
// Only this runner can consume the unlinked, read-only verified descriptor.
// The child's /dev/fd/3 is an inherited object, never a cache namespace lookup.
async function consumeDescriptor(reader,argv,{cwd,log,maxOutputBytes,logStdoutOnly=false}={}) {
  if(argv[0]!=='unzip'||!['-Z1','-p'].includes(argv[1])||argv.length>4)
    throw fail('cache_consumer_command_invalid');
  let output='',tail=Buffer.alloc(0),outputBytes=0,writer,writeError;
  const limit=maxOutputBytes??8*1024*1024;
  if(!Number.isSafeInteger(limit)||limit<1)throw fail('cache_consumer_output_limit_invalid');
  if(log)writer=await open(log,'w',0o600);
  try {
    const result=await new Promise((resolve,reject)=>{
      const child=childProcess.spawn('unzip',[argv[1],'/dev/fd/3',...argv.slice(3)],{
        cwd,stdio:['ignore','pipe','pipe',reader.handle.fd],
      });
      child.once('error',reject);
      for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{
        try {
          if(writeError)return;
          outputBytes+=chunk.length;
          if(writer&&(!logStdoutOnly||stream===child.stdout)){let offset=0;while(offset<chunk.length){const n=writeSync(writer.fd,chunk,offset,chunk.length-offset);if(!n)throw fail('cache_consumer_log_write_failed');offset+=n;}}
          if(maxOutputBytes===undefined){if(Buffer.byteLength(output)+chunk.length>limit)throw fail('cache_consumer_output_limit');output+=chunk;}
          else tail=chunk.length>=limit?Buffer.from(chunk.subarray(-limit)):Buffer.concat([tail,chunk]).subarray(-limit);
        } catch(error){writeError=error;child.kill('SIGTERM');}
      });
      child.once('close',(code,signal)=>writeError?reject(writeError):resolve({code:code??1,signal}));
    });
    if(result.code)throw fail('cache_archive_consumer_failed');
    return {...result,output:(maxOutputBytes===undefined?output:tail.toString('utf8')).trim(),outputBytes};
  } finally {await writer?.close();}
}
// consume runs while descriptors, ownership and the same-key lock are held.
// It receives only a verified owner-private copy, never a writable cache path as
// the archive consumed by unzip. The copy survives as primary receipt evidence.
export async function cachedArtifact({root,repository,run,artifact,download,consumptionDir},consume) {
  if(typeof consume!=='function')throw fail('cache_consumption_callback_required');
  const key=artifactCacheKey({repository,run,artifact}),chain=await directoryChain(root,true);
  const targetRoot=consumptionDir??root,targetChain=await directoryChain(targetRoot);
  const final=path.join(root,`${key}.zip`),lock=path.join(root,`${key}.lock`);
  let lockHandle;
  try {lockHandle=await open(lock,'wx',0o600);}
  catch(error){if(error.code==='EEXIST')throw fail('cache_writer_busy');throw error;}
  const lockInfo=await lockHandle.stat();let source,copy,reader;
  const checkRoots=async()=>{await assertChain(root,chain);await assertChain(targetRoot,targetChain);};
  try {
    await checkRoots();let exists=false;
    try {await lstat(final);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!exists) {
      const work=path.join(root,`${key}.${randomUUID()}.part`);await mkdir(work,{mode:0o700});
      const part=path.join(work,'archive.part');const created=await open(part,'wx',0o600);await created.close();
      try {
        const result=await download(part);
        if(result?.code!=null&&result.code!==0)throw fail('cache_download_failed');
        source=await openArchive(part);await verifyFD(source,artifact);await assertFile(part,source);await checkRoots();
        await source.handle.sync();
        await fs.link(part,final); // atomic no-replace; detect a swapped source below
        const finalInfo=await lstat(final);
        if(!same(source.info,finalInfo))throw fail('cache_promotion_inode_changed');
        // Linking changes ctime/nlink; rebind only after proving the same inode,
        // then rehash that held descriptor before admitting the promoted name.
        await unlink(part);await rmdir(work);source.info=await source.handle.stat();
        await assertFile(final,source);await verifyFD(source,artifact);await assertFile(final,source);
      } catch(error) {
        await writeFile(path.join(work,'status.json'),JSON.stringify({status:'incomplete',key})+'\n',{flag:'wx',mode:0o600}).catch(()=>{});
        throw fail('cache_incomplete_archive');
      }
    } else source=await openArchive(final);
    await verifyFD(source,artifact);await assertFile(final,source);await checkRoots();
    const privateDir=path.join(targetRoot,`ci-consume-${randomUUID()}`);await mkdir(privateDir,{mode:0o700});
    const privateChain=await directoryChain(privateDir),archive=path.join(privateDir,'archive.zip');
    const writer=await open(archive,'wx',0o600);
    try {
      // Copy from the verified open descriptor, never reopen the cache pathname.
      for await(const chunk of readOwned(source)) {
        let offset=0;while(offset<chunk.length){const result=await writer.write(chunk,offset,chunk.length-offset);if(!result.bytesWritten)throw fail('cache_copy_write_failed');offset+=result.bytesWritten;}
      }
      await writer.sync();
    } finally {await writer.close();}
    await assertFile(final,source);copy=await openArchive(archive);await verifyFD(copy,artifact);await assertFile(archive,copy);
    // Keep the ordinary named copy as receipt evidence only. Its pathname is
    // never opened by unzip. A separate read-only snapshot is unlinked first.
    const readerPath=path.join(privateDir,'reader.part');
    const readerWriter=await open(readerPath,'wx',0o600);
    try {
      for await(const chunk of readOwned(copy)) {
        let offset=0;while(offset<chunk.length){const result=await readerWriter.write(chunk,offset,chunk.length-offset);if(!result.bytesWritten)throw fail('cache_copy_write_failed');offset+=result.bytesWritten;}
      }
      await readerWriter.sync();
    } finally {await readerWriter.close();}
    reader=await openArchive(readerPath);await verifyFD(reader,artifact);await assertFile(readerPath,reader);
    await unlink(readerPath);reader.info=await reader.handle.stat();await assertUnlinked(reader,artifact);
    const verify=async()=>{await checkRoots();await assertChain(privateDir,privateChain);await assertFile(final,source);await verifyFD(source,artifact);await assertFile(final,source);await assertFile(archive,copy);await verifyFD(copy,artifact);await assertFile(archive,copy);await assertUnlinked(reader,artifact);};
    const executeArchive=async(argv,options={})=>{
      if(argv[2]!==archive)throw fail('cache_consumer_archive_identity');
      await verify();const result=await consumeDescriptor(reader,argv,options);await verify();return result;
    };
    await verify();const result=await consume({archive,verify,executeArchive,archiveHash:artifact.digest.slice(7)});await verify();return result;
  } finally {
    await reader?.handle.close();await copy?.handle.close();await source?.handle.close();await lockHandle.close();
    await checkRoots();
    if(!same(lockInfo,await lstat(lock)))throw fail('cache_lock_owner_changed');
    await unlink(lock);
  }
}
