// Failure evidence must never replace the operation's original failure. Read the
// current document once, without locator waits or a new authoritative API read.
export async function attachFailureAndRethrow(error,{page,testInfo,lastVerifiedProjection=null,details={}}) {
 try {
  let dom=null,domCaptureError=null;
  try {
   dom=await page.evaluate(()=>({
    route:location.hash,
    boardMessage:document.querySelector('#shell-board-preview-label')?.textContent??null,
    recovery:document.querySelector('[data-testid="sync-recovery-banner"]')?.textContent??null,
    computerStatus:[...document.querySelectorAll('[data-computer-status]')].map(node=>({text:node.textContent,hidden:node.hidden})),
    shell:document.querySelector('[data-testid="game-shell"]')?.getAttribute('data-game-id')??null,
    loading:[...document.querySelectorAll('[data-loading-state="pending"]')].map(node=>({key:node.getAttribute('data-loading-key'),phase:node.getAttribute('data-loading-phase')})),
   }));
  } catch(captureError) {domCaptureError=String(captureError);}
  try {
   await testInfo.attach('computer-failure-state',{contentType:'application/json',body:JSON.stringify({
    originalError:{name:error?.name??null,message:error?.message??String(error)},
    lastVerifiedProjection,dom,domCaptureError,details,
   })});
  } catch { /* A closed test or failed reporter must not mask the real failure. */ }
 } finally {throw error;}
}
