import {mkdir,readdir,lstat,cp,access,realpath,chmod} from 'node:fs/promises';
import path from 'node:path';
import {readJSON,saveJSON} from './io.mjs';
import {evidenceKey,fileDigest} from './reuse.mjs';

async function stopped(assertStopped){if(typeof assertStopped!=='function'||await assertStopped()!==true)throw Error('Checkpoint requires verified stopped services');}
async function inventory(root){
 if(await realpath(root)!==path.resolve(root)||!(await lstat(root)).isDirectory())throw Error('State root must be a real directory');
 const files={};
 async function walk(dir){for(const item of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const absolute=path.join(dir,item.name);if(item.isSymbolicLink())throw Error('Checkpoint symlinks are forbidden');
  if(item.isDirectory())await walk(absolute);else if(item.isFile())files[path.relative(root,absolute)]=await fileDigest(absolute);else throw Error('Unsupported checkpoint entry');
 }}
 await walk(root);return files;
}
// Storage state carries cookie deadlines, not the server's authoritative session expiry.
// Keep every continuity cookie: session cookies (-1) survive storage-state restoration.
async function cookieDeadline(root,files,now){
 let earliest=Infinity;
 function storage(value){
  if(!value||typeof value!=='object')return;
  if(Object.hasOwn(value,'cookies')){
   if(!Array.isArray(value.cookies))throw Error('Malformed checkpoint storage cookies');
   for(const cookie of value.cookies){
    const expires=cookie?.expires;
    if(expires===-1)continue;
    if(typeof expires!=='number'||!Number.isFinite(expires)||expires<0)throw Error('Malformed checkpoint cookie expiry');
    if(expires*1000<=now)throw Error('Checkpoint cookie already expired');
    earliest=Math.min(earliest,expires*1000);
   }
  }
 }
 for(const name of Object.keys(files)){
  // Retained fixtures use names such as continuity.json.account-mobile.
  if(!/\.json(?:\.[^/]*)?$/.test(name))continue;
  const value=await readJSON(path.join(root,name));
  storage(value);storage(value?.storage);
 }
 return earliest;
}
async function newDestination(destination){
 try{await access(destination);throw Error('Destination already exists');}catch(error){if(error.code!=='ENOENT')throw error;}
 await mkdir(path.dirname(destination),{recursive:true});
 if(await realpath(path.dirname(destination))!==path.resolve(path.dirname(destination)))throw Error('Destination parent must not contain symlinks');
}
export async function createCheckpoint({root,destination,provenance,expiresAt,assertStopped}){
 root=path.resolve(root);destination=path.resolve(destination);
 if(root===destination||destination.startsWith(root+path.sep)||root.startsWith(destination+path.sep))throw Error('Checkpoint and live roots must be separate');
 if(!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=Date.now())throw Error('A future checkpoint expiry is required');
 const createdAt=new Date().toISOString();
 await stopped(assertStopped);const files=await inventory(root);
 expiresAt=new Date(Math.min(Date.parse(expiresAt),Date.parse(createdAt)+86400000,await cookieDeadline(root,files,Date.now()))).toISOString();
 await newDestination(destination);await mkdir(destination,{mode:0o700});
 await cp(root,path.join(destination,'state'),{recursive:true,errorOnExist:true,force:false});await chmod(path.join(destination,'state'),0o700);
 await stopped(assertStopped);
 if(evidenceKey({files:await inventory(root)})!==evidenceKey({files})||evidenceKey({files:await inventory(path.join(destination,'state'))})!==evidenceKey({files}))throw Error('State changed while copying');
 await cookieDeadline(path.join(destination,'state'),files,Date.now());
 const manifest={version:1,createdAt,key:evidenceKey(provenance),provenance,expiresAt,files};manifest.integrity=evidenceKey(manifest);await saveJSON(path.join(destination,'manifest.json'),manifest);return manifest;
}
export async function restoreCheckpoint({checkpoint,destination,provenance,now=Date.now(),assertStopped}){
 if(!Number.isFinite(now))throw Error('Invalid checkpoint verification time');
 checkpoint=path.resolve(checkpoint);destination=path.resolve(destination);await stopped(assertStopped);
 const manifest=await readJSON(path.join(checkpoint,'manifest.json'));const {integrity,...body}=manifest;
 if(manifest.version!==1||manifest.key!==evidenceKey(provenance)||integrity!==evidenceKey(body)||!Number.isFinite(Date.parse(manifest.expiresAt))||Date.parse(manifest.expiresAt)<=now||!Number.isFinite(Date.parse(manifest.createdAt))||Date.parse(manifest.createdAt)>now||Date.parse(manifest.expiresAt)-Date.parse(manifest.createdAt)>86400000)throw Error('Checkpoint provenance, integrity or expiry mismatch');
 const state=path.join(checkpoint,'state');if(destination===checkpoint||destination.startsWith(checkpoint+path.sep)||checkpoint.startsWith(destination+path.sep))throw Error('Restore destination must be separate');
 if(evidenceKey({files:await inventory(state)})!==evidenceKey({files:manifest.files}))throw Error('Checkpoint file integrity mismatch');
 if(Date.parse(manifest.expiresAt)>await cookieDeadline(state,manifest.files,now))throw Error('Checkpoint expiry exceeds cookie deadline');
 await newDestination(destination);await mkdir(destination,{mode:0o700});
 for(const entry of await readdir(state))await cp(path.join(state,entry),path.join(destination,entry),{recursive:true,errorOnExist:true,force:false});
 await stopped(assertStopped);
 if(evidenceKey({files:await inventory(destination)})!==evidenceKey({files:manifest.files})||evidenceKey({files:await inventory(state)})!==evidenceKey({files:manifest.files}))throw Error('Checkpoint changed during restore');
 await cookieDeadline(destination,manifest.files,now);
 return manifest;
}
