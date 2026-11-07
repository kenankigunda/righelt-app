import {originalPolicyInputs} from './message-reservation-policy.mjs';
import {readFileSync} from 'node:fs';
import {expect} from '@playwright/test';
import {installGuardedHeightPublication} from './height-publication-observer.mjs';
const recipe=JSON.parse(readFileSync(new URL('./height-publication-recipe.json',import.meta.url),'utf8'));
export async function controlledHeightPublication({page,browserName,baseURL},use,info){
 const owner=await installGuardedHeightPublication({context:page.context(),baseURL,recipe});
 let primary;
 try{
  await page.addInitScript(({profile,inputs})=>{Object.defineProperty(globalThis,'__fontUsedSizeProfile',{value:profile});inputs.bands.forEach(Object.freeze);Object.freeze(inputs.bands);Object.freeze(inputs);Object.defineProperty(globalThis,'__fontOriginalPolicyInputs',{value:inputs});},{profile:browserName,inputs:originalPolicyInputs});
  await use(owner);
 }catch(error){primary=error;throw error;}finally{
  const failures=[];
  const attempt=async(name,operation)=>{try{await operation();}catch(error){failures.push(error);console.error(JSON.stringify({kind:name,name:error?.name??'Error'}));}};
  await attempt('publication-disposal-incomplete',()=>owner.dispose());
  const metadata=owner.metadata();
  await attempt('publication-route-evidence-incomplete',()=>info.attach('Guarded original height publication route',{body:JSON.stringify(metadata),contentType:'application/json'}));
  if(!page.isClosed())await attempt('publication-final-observation-incomplete',async()=>{const admission=await page.evaluate(()=>window.currentFontAdmission?.()??window.fixturePublicationLast??null);await info.attach('Final current-scale publication',{body:JSON.stringify(admission),contentType:'application/json'});});
  await attempt('publication-contract-incomplete',async()=>{
   expect(metadata.pending,'Owned module requests must finish before teardown').toBe(0);
   expect(metadata.issues,'Original source/route binding must qualify').toEqual([]);
   expect(metadata.issueDropped).toBe(0);expect(metadata.transformed).toBeGreaterThan(0);expect(metadata.incomplete).toBe(false);
  });
  if(!primary&&failures.length)throw failures[0];
 }
}
