// Synthetic preparation proof only. No operator backup or final-delivery claim.
import {promises as fs,constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,fileSha256} from './preparation.mjs';

const digest=value=>fileSha256(Buffer.from(canonical(value)));
const check=(condition,reason)=>{if(!condition)throw Error(reason);};
const privateFile=async name=>{
 const handle=await fs.open(name,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await handle.stat();check(stat.isFile()&&(stat.mode&0o077)===0&&stat.size<=16777216,'private-custody-invalid');return await handle.readFile();}finally{await handle.close();}
};
async function syncDirectory(name){const handle=await fs.open(name,constants.O_RDONLY);try{await handle.sync();}finally{await handle.close();}}
async function createFile(name,bytes){const handle=await fs.open(name,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}}
export const custodyCodeSha256=fileSha256(await fs.readFile(fileURLToPath(import.meta.url)));

export async function openFileCustody(root,{create=false,policySha256,recoverySha256}={}){
 check([policySha256,recoverySha256].every(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)),'private-custody-identity-required');
 const identity=Object.freeze({identitySha256:custodyCodeSha256,policySha256,recoverySha256});
 if(create){await fs.mkdir(root,{mode:0o700});await fs.mkdir(path.join(root,'journal'),{mode:0o700});await fs.mkdir(path.join(root,'raw'),{mode:0o700});await createFile(path.join(root,'identity.json'),Buffer.from(canonical(identity)));await syncDirectory(root);await syncDirectory(path.dirname(root));}
 for(const dir of [root,path.join(root,'journal'),path.join(root,'raw')]){const stat=await fs.lstat(dir);check(stat.isDirectory()&&!stat.isSymbolicLink()&&(stat.mode&0o077)===0,'private-custody-directory-required');}
 check((await privateFile(path.join(root,'identity.json'))).equals(Buffer.from(canonical(identity))),'private-custody-identity-mismatch');
 const journalDir=path.join(root,'journal');
 async function readJournal(){
  const names=(await fs.readdir(journalDir)).sort();check(names.every(n=>/^\d{8}\.json$/.test(n)),'private-custody-incomplete');
  const events=[];let previousSha256=null;
  for(const [index,name]of names.entries()){
   check(name===String(index+1).padStart(8,'0')+'.json','private-custody-chain-invalid');
   let record;try{record=JSON.parse(await privateFile(path.join(journalDir,name)));}catch{throw Error('private-custody-chain-invalid');}
   const {sha256,...body}=record;
   check(body.schema===1&&body.revision===index+1&&body.previousSha256===previousSha256&&sha256===digest(body),'private-custody-chain-invalid');
   events.push(body.event);previousSha256=sha256;
  }
  return {revision:events.length,events,sha256:previousSha256};
 }
 async function append(expected,event){
  const lock=path.join(root,'append.lock');let handle;
  try{handle=await fs.open(lock,'wx',0o600);}catch{throw Error('private-custody-writer-conflict');}
  try{
   const prior=await readJournal();check(prior.revision===expected,'private-custody-revision-conflict');
   const body={schema:1,revision:expected+1,previousSha256:prior.sha256,event};const bytes=Buffer.from(canonical({...body,sha256:digest(body)}));
   check(bytes.length<=16777216,'private-custody-record-too-large');
   const name=path.join(journalDir,String(expected+1).padStart(8,'0')+'.json');
   await createFile(name+'.pending',bytes);await fs.link(name+'.pending',name);await fs.unlink(name+'.pending');await syncDirectory(journalDir);
   return await readJournal();
  }finally{await handle.close();await fs.unlink(lock);await syncDirectory(root);}
 }
 async function putRaw(key,bytes){
  check(typeof key==='string'&&/^[a-f0-9]{64}$/.test(key)&&bytes instanceof Uint8Array&&bytes.byteLength<=16777216,'private-capture-invalid');
  const name=path.join(root,'raw',key+'.bin');
  try{await createFile(name,bytes);await syncDirectory(path.dirname(name));}catch(error){if(error.code!=='EEXIST')throw Error('private-capture-incomplete');const old=await privateFile(name);check(old.equals(Buffer.from(bytes)),'private-capture-already-bound');}
  return {domain:'sha256-file-bytes',sha256:fileSha256(bytes),bytes:bytes.byteLength};
 }
 return {identity,readJournal,append,putRaw};
}
