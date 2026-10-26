// Real candidate-owned stack worker. Never import trainer or construct fixture games.
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifySource} from './manifest.mjs';
assert.ok(process.send,'Stack worker requires its owning driver IPC');
const [root,persistRoot,sourceRevision,tree]=process.argv.slice(2);verifySource({checkout:root,sourceRevision,tree});
let stop,requested=false,startSettled=false,closing;
const send=value=>{if(process.connected)process.send(value);};
async function shutdown(){
 requested=true;
 // Do not acknowledge cleanup while startup can still spawn more owned children.
 if(!startSettled){if(stop)await stop();return;}
 return closing??=(async()=>{try{await stop?.();send({type:'stopped',root,persistRoot});}catch(error){send({type:'error',message:error.message});process.exitCode=1;}finally{if(process.connected)process.disconnect();}})();
}
process.on('message',message=>{if(message?.type==='stop')void shutdown();});process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);process.once('disconnect',shutdown);
try {
 const {startAccountStack}=await import(pathToFileURL(path.join(root,'scripts/validation/account-stack.mjs')).href);
 const stack=await startAccountStack({root,persistRoot,onStopReady(value){stop=value;if(requested)void stop();}});stop=stack.stop;startSettled=true;
 if(requested)await shutdown();else send({type:'ready',origin:stack.origin,root,persistRoot,pid:process.pid});
}catch(error){send({type:'error',message:error.message,stack:error.stack});process.exitCode=1;startSettled=true;await shutdown();}
