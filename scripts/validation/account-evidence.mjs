import {viewports} from './model.mjs';
export const FRESH_ACCOUNT_WORKFLOW='fresh account acknowledgment, owned move, returning login and independent UX';
export const RETAINED_ACCOUNT_WORKFLOW='retained account session, ownership, history and preferences survive the next schema';
export function verifyAccountEvidence(items,{retained=false,capabilities={},legacy=false}={}){
 const matrix=[{title:FRESH_ACCOUNT_WORKFLOW,labels:['account-home','sign-in','recovery-acknowledgment','account-owned-move','account-settings',...(capabilities.personalHome?['returning-personal-home']:[]),...(capabilities.stories?['unavailable-trained-story']:[]),...(legacy?['legacy-history-preserved-no-account-takeover']:[])]},...(retained?[{title:RETAINED_ACCOUNT_WORKFLOW,labels:['retained-account-upgrade']}]:[])];
 for(const {name}of viewports)for(const row of matrix){
  const matches=items.filter(item=>item.viewport===name&&item.title.split(' / ').at(-1)===row.title);
  if(matches.length!==1||matches[0].status!=='passed')throw Error(`Missing or duplicate account proof: ${name} / ${row.title}`);
  for(const label of row.labels)for(const kind of ['context','component']){
   if(!matches[0].images?.some(image=>image.caption===`${label} · ${name} · ${kind}`&&image.src&&image.thumbnail&&image.digest))throw Error(`Missing account checkpoint: ${name} / ${label} / ${kind}`);
  }
 }
}
