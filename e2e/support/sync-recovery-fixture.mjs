import {expect} from '@playwright/test';
import {createGameFromHome,openDirectGameLink,requestPlayerJoin,acceptPendingRequest,joinAsViewer} from './app.mjs';

// Fault controls live at the browser transport boundary, never in production endpoints.
export async function wire(page, {interceptHttp=true}={}) {
 const fault={interceptHttp,receive:false,http:false,loseReply:false, requests:0,snapshots:0,bytes:0,commands:[],outcomes:[],latency:100,lastInbound:0};
 await page.routeWebSocket(/\/api\/shell\/games\//, socket=>{
  const server=socket.connectToServer();
  server.onMessage(message=>{
   fault.bytes+=Buffer.byteLength(message);
   let data;try{data=JSON.parse(message);if(fault.legacy){delete data.protocolVersion;message=JSON.stringify(data);}}catch{}
   if(data?.game)fault.snapshots++;
   if(!fault.receive){setTimeout(()=>{fault.lastInbound=Date.now();socket.send(message);},fault.latency);}
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
  await Promise.allSettled(contexts.map(async context=>{
   try{await context.unrouteAll({behavior:'ignoreErrors'});}finally{await context.close();}
  }));
  throw error;
 }
}
