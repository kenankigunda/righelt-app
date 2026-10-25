import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const usesFirefoxCiAudio=(project,{env=process.env,platform=process.platform}={})=>
 Boolean(platform==='linux' && env.CI && env.GITHUB_ACTIONS==='true'
 && env.RUNNER_ENVIRONMENT==='github-hosted' && project==='firefox');

const childExit=child=>new Promise((resolve,reject)=>{
 child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));
});
const stop=async(child,exited)=>{
 if(!child)return;
 if(child.exitCode===null && child.signalCode===null)child.kill('SIGTERM');
 let timer;
 try{
  await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Audio service did not stop')),5000);})]);
 }catch(error){
  child.kill('SIGKILL');await exited;throw error;
 }finally{clearTimeout(timer);}
};

// Invoked inside the existing heavy supervisor. Both children stay foreground
// in its owned process group, including when the test runner is terminated.
export async function runWithFirefoxAudio(args,{env=process.env,platform=process.platform,
 browserCommand='pnpm',browserArgs=['exec','playwright','test',...args],
 pulseCommand='pulseaudio',pactlCommand='pactl'}={}){
 const project=args.find(arg=>arg.startsWith('--project='))?.slice('--project='.length);
 const enabled=usesFirefoxCiAudio(project,{env,platform});
 let directory,audio,audioExit,browser,browserExit,stopping=false;
 const terminate=()=>{stopping=true;browser?.kill('SIGTERM');audio?.kill('SIGTERM');};
 process.on('SIGTERM',terminate);process.on('SIGINT',terminate);
 try{
  let childEnv=env;
  if(enabled){
   directory=await mkdtemp(path.join(tmpdir(),'righelt-audio-'));
   const socket=path.join(directory,'native');
   childEnv={...env,PULSE_SERVER:`unix:${socket}`};
   if(stopping)throw Error('Audio startup interrupted');
   audio=spawn(pulseCommand,['-n','--daemonize=no','--exit-idle-time=-1','--log-target=stderr',
    `--load=module-native-protocol-unix socket=${socket}`,
    '--load=module-null-sink sink_name=righelt_ci'],{env:childEnv,stdio:'inherit'});
   audioExit=childExit(audio);audioExit.catch(()=>{});
   const deadline=Date.now()+10000;
   let ready=false;
   while(!ready && Date.now()<deadline){
    if(stopping || audio.exitCode!==null || audio.signalCode!==null)throw Error('Native audio service exited before readiness');
    try{execFileSync(pactlCommand,['info'],{env:childEnv,stdio:'pipe',timeout:1000});ready=true;}
    catch{await new Promise(resolve=>setTimeout(resolve,100));}
   }
   if(!ready)throw Error('Native audio service did not become ready');
   console.log('[native-audio] Owned PulseAudio null sink ready');
  }
  if(stopping)throw Error('Browser startup interrupted');
  browser=spawn(browserCommand,browserArgs,{env:childEnv,stdio:'inherit'});
  browserExit=childExit(browser);
 if(audio)audioExit.then(()=>{if(!stopping){stopping=true;if(browser.exitCode===null)browser.kill('SIGTERM');}},()=>{stopping=true;browser.kill('SIGTERM');});
  const result=await browserExit;
  return stopping?1:result.code??1;
 }finally{
  stopping=true;
  try{await stop(audio,audioExit);}finally{
   process.removeListener('SIGTERM',terminate);process.removeListener('SIGINT',terminate);
   if(directory)await rm(directory,{recursive:true,force:true});
  }
 }
}
