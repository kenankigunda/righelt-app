import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
export const configPath=()=>process.env.RIGHELT_VALIDATION_CONFIG || path.join(os.homedir(),'.config','righelt','validation.json');
export async function readJSON(file,fallback) {try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT' && fallback!==undefined)return fallback;throw e;}}
export async function saveJSON(file,value) {await mkdir(path.dirname(file),{recursive:true});const tmp=`${file}.${process.pid}.tmp`;await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(tmp,file);}
export async function command(argv,{cwd=process.cwd(),env={},log,allowFailure=false}={}) {
  const start=Date.now();let output='';
  const result=await new Promise((resolve,reject)=>{const child=spawn(argv[0],argv.slice(1),{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
    child.on('error',reject);for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output+=chunk;});child.on('exit',(code,signal)=>resolve({code:code??1,signal}));});
  if(log){await mkdir(path.dirname(log),{recursive:true});await writeFile(log,output);}
  if(result.code && !allowFailure)throw new Error(`${argv[0]} ${argv.slice(1,3).join(' ')} failed (${result.code}): ${output.slice(-2500)}`);
  return {...result,output:output.trim(),duration:Date.now()-start};
}
export async function git(args,cwd){return (await command(['git',...args],{cwd})).output;}
export async function withRunLock(file,fn){
 const lock=`${file}.lock`;await mkdir(path.dirname(file),{recursive:true});
 try{await mkdir(lock);}catch(e){if(e.code==='EEXIST')throw Error('Run is busy; retry after the active operation. Never remove a live run lock.');throw e;}
 try{await saveJSON(path.join(lock,'owner.json'),{pid:process.pid,startedAt:new Date().toISOString()});return await fn();}finally{await import('node:fs/promises').then(fs=>fs.rm(lock,{recursive:true}));}
}
