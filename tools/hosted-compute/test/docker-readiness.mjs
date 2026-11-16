import {setTimeout as pause} from 'node:timers/promises';

// Keep native Docker proof mandatory. A cold or busy runner may need more than
// one five-second query before its daemon answers; readiness is finite.
export async function waitForDocker(execute,{clock=Date.now,sleep=pause,milliseconds=30000}={}){
  const deadline=clock()+milliseconds;let failure;
  while(clock()<deadline){
    try{return await execute('docker',['info','--format','{{.ServerVersion}}'],{timeout:Math.min(5000,Math.max(1,deadline-clock()))});}
    catch(error){failure=error;}
    if(clock()<deadline)await sleep(Math.min(1000,deadline-clock()));
  }
  throw Error('Docker daemon readiness deadline reached',{cause:failure});
}
