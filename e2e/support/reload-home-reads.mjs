// Test-only ownership: responses must belong to requests started by this reload.
export function observeReloadHomeReads(page) {
 const expectedURL=page.url(),expectedOrigin=new URL(expectedURL).origin;
 const mainFrame=page.mainFrame(),requests=new Set();
 let navigationRequest=null,committed=false,failure=null,disposed=false;
 const fail=message=>{failure??=new Error(message);};
 const frameOf=request=>{try{return request.frame();}catch{return null;}};
 const onRequest=request=>{
  if(disposed||failure||frameOf(request)!==mainFrame)return;
  if(request.isNavigationRequest()){
   if(new URL(request.url()).origin!==expectedOrigin){fail('Foreign-origin navigation during Home reload');return;}
   if(committed||navigationRequest)fail('Unexpected main-frame navigation during Home reload');
   else navigationRequest=request;
   return;
  }
  if(committed&&request.method()==='GET'){
   const url=new URL(request.url());
   if(url.origin===expectedOrigin&&url.pathname==='/api/shell/games'&&['my','other'].includes(url.searchParams.get('section')))requests.add(request);
  }
 };
 const onNavigated=frame=>{
  if(frame!==mainFrame||disposed)return;
  if(!navigationRequest||frame.url()!==expectedURL)fail('Unexpected main-frame commit during Home reload');
  else committed=true;
 };
 const onClose=()=>fail('Page closed during Home reload');
 page.on('request',onRequest);page.on('framenavigated',onNavigated);page.on('close',onClose);
 const assertCurrent=()=>{if(disposed)throw new Error('Home reload observation disposed');if(failure)throw failure;};
 return {
  matches(response,section){
   assertCurrent();
   const request=response.request(),url=new URL(response.url());
   return committed&&requests.has(request)&&new URL(request.url()).origin===expectedOrigin&&url.origin===expectedOrigin&&request.method()==='GET'&&url.pathname==='/api/shell/games'&&url.searchParams.get('section')===section&&response.status()===200;
  },
  assertReload(response){
   assertCurrent();
   if(!committed||!response||response.request()!==navigationRequest||new URL(response.url()).origin!==expectedOrigin||new URL(navigationRequest.url()).origin!==expectedOrigin)throw new Error('Home reads are not bound to the completed reload navigation');
  },
  dispose(){
   if(disposed)return;
   disposed=true;requests.clear();
   page.off('request',onRequest);page.off('framenavigated',onNavigated);page.off('close',onClose);
  },
 };
}
