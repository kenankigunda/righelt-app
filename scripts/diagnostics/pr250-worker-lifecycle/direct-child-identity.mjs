export function requireDirectIdentity(saved,inspect){
 if(!saved||!Number.isSafeInteger(saved.pid)||typeof saved.startTicks!=='string'||!/^\d+$/.test(saved.startTicks))throw Error('Saved direct-child identity unavailable');
 const current=inspect(saved.pid);
 if(!current||current.pid!==saved.pid||current.startTicks!==saved.startTicks)throw Error('Direct child identity changed, refusing PID adoption');
 return current;
}
export function signalDirectChild(child,saved,signal,inspect){
 if(child.pid!==saved?.pid)throw Error('Direct creation handle mismatch');
 requireDirectIdentity(saved,inspect);
 return child.kill(signal);
}
import {ChildProcess} from 'node:child_process';


const boundedClose=(closed,ms)=>{
 let timer;
 return Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Direct creation-handle close deadline')),ms);})]).finally(()=>clearTimeout(timer));
};

// Only captureInitialChildIdentity invokes this, immediately after the actual
// spawn. It accepts an unreaped creation handle, never a searched or adopted PID.
async function stopBeforeInitialIdentity(child,closed,{termMs,killMs}){
 if(!(child instanceof ChildProcess))throw Error('Actual direct ChildProcess creation handle required');
 const signals=[],errors=[];let result=null;
 const signal=value=>{
  if(child.exitCode!==null||child.signalCode!==null)return;
  try{const sent=child.kill(value);signals.push({signal:value,sent});if(!sent)errors.push({phase:'signal',message:'Native creation handle refused '+value});}
  catch(error){errors.push({phase:'signal',message:error.message});}
 };
 // No process exists for a rejected spawn without a PID. Still require close.
 if(Number.isSafeInteger(child.pid))signal('SIGTERM');
 try{result=await boundedClose(closed,termMs);}
 catch(error){
  errors.push({phase:'term-close',message:error.message});
  if(Number.isSafeInteger(child.pid))signal('SIGKILL');
  try{result=await boundedClose(closed,killMs);}catch(error){errors.push({phase:'kill-close',message:error.message});}
 }
 return{pid:child.pid??null,reaped:result!==null,result,signals,errors,scope:'immediate initial identity capture failure only'};
}

export async function captureInitialChildIdentity(child,closed,inspect,onCleanup=()=>{},{termMs=10000,killMs=3000}={}){
 try{
  const saved=inspect(child.pid);
  requireDirectIdentity(saved,()=>saved);
  if(saved.pid!==child.pid)throw Error('Initial child creation identity mismatch');
  return saved;
 }catch(primary){
  let cleanup;
  try{cleanup=await stopBeforeInitialIdentity(child,closed,{termMs,killMs});onCleanup(cleanup,primary);}
  catch(secondary){throw new AggregateError([primary,secondary],'Initial identity capture and direct cleanup failed');}
  if(!cleanup.reaped||cleanup.errors.length)throw new AggregateError([primary,...cleanup.errors.map(error=>Error(error.phase+': '+error.message))],'Initial identity capture failed; direct cleanup has secondary evidence');
  throw primary;
 }
}
