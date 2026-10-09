import {expect} from '@playwright/test';
import {createGameFromHome,openDirectGameLink,requestPlayerJoin,acceptPendingRequest,joinAsViewer} from './app.mjs';

const disposersByContext=new WeakMap();
const cleanupByContext=new WeakMap();
const pagesByContext=new WeakMap();

export async function closeContexts(contexts) {
 const results=await Promise.allSettled([...new Set(contexts)].map(context=>{
  if(!cleanupByContext.has(context)){
   const cleanup=(async()=>{
    for(const dispose of [...(disposersByContext.get(context)??[])])dispose();
    const routes=await Promise.allSettled([
     ...[...(pagesByContext.get(context)??[])].map(page=>Promise.resolve().then(()=>page.unrouteAll({behavior:'wait'}))),
     Promise.resolve().then(()=>context.unrouteAll({behavior:'wait'}))
    ]);
    pagesByContext.delete(context);
    const failures=routes.filter(result=>result.status==='rejected').map(result=>result.reason);
    try{await context.close();}catch(error){failures.push(error);}
    if(failures.length)throw new AggregateError(failures,'Sync context cleanup failed');
   })();
   cleanupByContext.set(context,cleanup);
  }
  return cleanupByContext.get(context);
 }));
 const failures=results.filter(result=>result.status==='rejected').map(result=>result.reason);
 if(failures.length)throw new AggregateError(failures,'Sync fixture cleanup failed');
}

// Fault controls live at the browser transport boundary, never in production endpoints.
export async function wire(page, {interceptHttp=true}={}) {
 const fault={interceptHttp,receive:false,http:false,loseReply:false, requests:0,snapshots:0,bytes:0,commands:[],outcomes:[],latency:100,lastInbound:0};
 const context=page.context(),sockets=new Set();let disposed=false;
 if(!pagesByContext.has(context))pagesByContext.set(context,new Set());
 pagesByContext.get(context).add(page);
 if(!disposersByContext.has(context))disposersByContext.set(context,new Set());
 const dispose=()=>{
  if(disposed)return;
  disposed=true;
  for(const retire of [...sockets])retire();
  page.off('close',dispose);page.off('crash',dispose);
  disposersByContext.get(context).delete(dispose);
 };
 disposersByContext.get(context).add(dispose);
 page.once('close',dispose);page.once('crash',dispose);
 await page.routeWebSocket(/\/api\/shell\/games\//, socket=>{
  if(disposed)return socket.close();
  const server=socket.connectToServer();
  const pending=new Set();let closed=false,pageCloseForwarded=false,serverCloseForwarded=false;
  const retire=()=>{
   if(closed)return false;
   closed=true;for(const timer of pending)clearTimeout(timer);pending.clear();sockets.delete(retire);return true;
  };
  sockets.add(retire);
  // Installing close handlers replaces Playwright's default propagation.
  socket.onClose(async(code,reason)=>{
   retire();if(pageCloseForwarded)return;pageCloseForwarded=true;await server.close({code,reason});
  });
  server.onClose(async(code,reason)=>{
   retire();if(serverCloseForwarded)return;serverCloseForwarded=true;await socket.close({code,reason});
  });
  server.onMessage(message=>{
   if(disposed||closed)return;
   fault.bytes+=Buffer.byteLength(message);
   let data;try{data=JSON.parse(message);if(fault.legacy){delete data.protocolVersion;message=JSON.stringify(data);}}catch{}
   if(data?.game)fault.snapshots++;
   if(!fault.receive){
    const timer=setTimeout(()=>{
     pending.delete(timer);
     if(disposed||closed||page.isClosed())return;
     fault.lastInbound=Date.now();socket.send(message);
    },fault.latency);
    pending.add(timer);
   }
  });
 });
 await page.route('**/api/shell/games/**',async route=>{
  // Setup uses the browser transport. Auxiliary HTTP interception starts only
  // after the party is ready; WebSocket routing must be installed beforehand.
  if(!fault.interceptHttp){await route.continue();return;}
  fault.requests++;
  if(fault.legacy && /\/reconcile$/.test(new URL(route.request().url()).pathname)){await route.fulfill({status:404,json:{ok:false,error:"not_found"}});return;}
  if(fault.http || (fault.loseReply && /\/reconcile$/.test(new URL(route.request().url()).pathname))){await route.abort();return;}
  const mutation=route.request().method()==='POST'&&/\/apply$/.test(new URL(route.request().url()).pathname);
  // Loss of an admitted move begins at submission, not during pointer setup.
  // Otherwise a slow browser can enter recovery and reject the click entirely.
  if(mutation&&fault.loseAtApply){fault.loseAtApply=false;fault.receive=true;fault.loseReply=true;}
  if(mutation)fault.commands.push(route.request().postDataJSON());
  if(mutation&&fault.holdApply){await route.abort();return;}
  const response=await route.fetch({timeout:5000});
  let body=await response.body();
  if(fault.legacy){try{const parsed=JSON.parse(body);if(parsed.game){delete parsed.protocolVersion;body=Buffer.from(JSON.stringify(parsed));}}catch{}}
  fault.bytes+=body.length;
  try{const parsed=JSON.parse(body);if(parsed.game)fault.snapshots++;if(mutation)fault.outcomes.push(...(parsed.commandOutcomes??[]));}catch{}
  if(fault.interruptNextRecovery && /\/reconcile$/.test(new URL(route.request().url()).pathname)){
   fault.interruptNextRecovery=false;fault.interruptedRecoveries=(fault.interruptedRecoveries||0)+1;fault.http=true;await route.abort();return;
  }
  if(mutation&&fault.loseReply){await route.abort();return;}
  await new Promise(resolve=>setTimeout(resolve,fault.latency));
  await route.fulfill({response,body});
 });
 return fault;
}
export async function party(browser,baseURL) {
 const contexts=[];
 try{
 for(let i=0;i<3;i++)contexts.push(await browser.newContext());
 const pages=await Promise.all(contexts.map(c=>c.newPage()));
 const faults=await Promise.all(pages.map(page=>wire(page,{interceptHttp:false})));
 const game=await createGameFromHome(pages[0]);
 await openDirectGameLink(pages[1],baseURL,game.gameHash);await requestPlayerJoin(pages[1]);await acceptPendingRequest(pages[0]);
 await openDirectGameLink(pages[2],baseURL,game.gameHash);await joinAsViewer(pages[2]);
 for(const page of pages)await expect(page.getByTestId('sync-recovery-banner')).toHaveCount(0);
 faults.forEach(f=>{f.requests=0;f.snapshots=0;f.bytes=0;f.interceptHttp=true;});
 return {...game,pages,faults,contexts};
 }catch(error){
  // The caller cannot clean up a party that was never returned. Also close
  // contexts acquired before a later newContext or page setup failed.
  try{await closeContexts(contexts);}catch(cleanupError){
   throw new AggregateError([error,cleanupError],'Sync fixture setup and cleanup failed',{cause:error});
  }
  throw error;
 }
}
