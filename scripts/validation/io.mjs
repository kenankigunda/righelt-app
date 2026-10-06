import { supervisedArgv } from '../resources/supervisor.mjs';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {open} from 'node:fs/promises';
import {writeSync} from 'node:fs';
export const configPath=()=>process.env.RIGHELT_VALIDATION_CONFIG || path.join(os.homedir(),'.config','righelt','validation.json');
export async function readJSON(file,fallback) {try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT' && fallback!==undefined)return fallback;throw e;}}
export async function saveJSON(file,value) {await mkdir(path.dirname(file),{recursive:true});const tmp=`${file}.${process.pid}.tmp`;await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(tmp,file);}
export async function command(argv,{cwd=process.cwd(),env={},log,allowFailure=false,maxOutputBytes,logStdoutOnly=false,supervised=false}={}) {
  if(logStdoutOnly&&!log)throw Error('stdout-only logging requires a log');
  if(maxOutputBytes!==undefined && (!log || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes<1))throw Error('Bounded output requires a log and a positive byte limit');
  const start=Date.now();let output='',tail=Buffer.alloc(0),outputBytes=0,handle,writeError;
  if(log){await mkdir(path.dirname(log),{recursive:true});handle=await open(log,'w',0o600);}
  let result;
  try {
    result=await new Promise((resolve,reject)=>{
      const mergedEnv={...process.env,pnpm_config_verify_deps_before_run:'false',...env};
      const launch=supervised?supervisedArgv(argv,mergedEnv):argv;
      const child=spawn(launch[0],launch.slice(1),{cwd,env:mergedEnv,stdio:['ignore','pipe','pipe']});
      child.on('error',reject);
      for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{
        try {
          if(writeError)return;
          outputBytes+=chunk.length;
          // Synchronous writes apply backpressure to the child instead of queuing the full log in memory.
          if(handle&&(!logStdoutOnly||stream===child.stdout)){let offset=0;while(offset<chunk.length)offset+=writeSync(handle.fd,chunk,offset,chunk.length-offset);}
          if(maxOutputBytes===undefined)output+=chunk;
          else tail=chunk.length>=maxOutputBytes?Buffer.from(chunk.subarray(-maxOutputBytes)):Buffer.concat([tail,chunk]).subarray(-maxOutputBytes);
        }catch(error){writeError=error;child.kill('SIGTERM');}
      });
      // close, unlike exit, also waits for both output pipes to finish.
      child.on('close',(code,signal)=>writeError?reject(writeError):resolve({code:code??1,signal}));
    });
  } finally {await handle?.close();}
  if(maxOutputBytes!==undefined)output=tail.toString('utf8');
  if(result.code && !allowFailure)throw new Error(`${argv[0]} ${argv.slice(1,3).join(' ')} failed (${result.code}): ${output.slice(-2500)}`);
  return {...result,output:output.trim(),outputBytes,truncated:maxOutputBytes!==undefined&&outputBytes>maxOutputBytes,duration:Date.now()-start};
}
export async function git(args,cwd){return (await command(['git',...args],{cwd})).output;}
export async function withRunLock(file,fn){
 const lock=`${file}.lock`;await mkdir(path.dirname(file),{recursive:true});
 try{await mkdir(lock);}catch(e){if(e.code==='EEXIST')throw Error('Run is busy; retry after the active operation. Never remove a live run lock.');throw e;}
 try{await saveJSON(path.join(lock,'owner.json'),{pid:process.pid,startedAt:new Date().toISOString()});return await fn();}finally{await import('node:fs/promises').then(fs=>fs.rm(lock,{recursive:true}));}
}
