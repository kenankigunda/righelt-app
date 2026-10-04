import {visualPolicy,selectedViewports} from './visual-policy.mjs';
export const FRESH_ACCOUNT_WORKFLOW='fresh account acknowledgment, owned move, returning login and independent UX';
export const RETAINED_ACCOUNT_WORKFLOW='retained account session, ownership, history and preferences survive the next schema';
export function verifyAccountEvidence(items,{retained=false,capabilities={},legacy=false,visualMode='legacy',viewports:requiredViewports,visualViewports,checkpoints}={}){
 const env={RIGHELT_VISUAL_MODE:visualMode,...(visualViewports?{RIGHELT_VISUAL_VIEWPORTS:JSON.stringify(visualViewports)}:{}),...(requiredViewports?{RIGHELT_VALIDATION_VIEWPORTS:JSON.stringify(requiredViewports.map(v=>typeof v==='string'?v:v.name))}:{}),...(checkpoints?{RIGHELT_VISUAL_CHECKPOINTS:JSON.stringify(checkpoints)}:{})};
 const policy=visualPolicy(env);const required=selectedViewports(env);
 const matrix=[{title:FRESH_ACCOUNT_WORKFLOW,labels:['account-home','sign-in','recovery-acknowledgment','account-owned-move','account-settings',...(capabilities.movePreview?['move-preview-before-confirm']:[]),...(capabilities.personalHome?['personal-home-start-lower','returning-personal-home','returning-personal-home-lower']:[]),...(capabilities.stories?['unavailable-trained-story']:[]),...(capabilities.results?['friend-game-result','friend-rematch-choice','friend-rematch-created']:[]),...(legacy?['legacy-history-preserved-no-account-takeover']:[])]},...(retained?[{title:RETAINED_ACCOUNT_WORKFLOW,labels:['retained-account-upgrade']}]:[])];
 for(const {name}of required)for(const row of matrix){
  const matches=items.filter(item=>item.viewport===name&&item.title.split(' / ').at(-1)===row.title);
  if(matches.length!==1||matches[0].status!=='passed')throw Error(`Missing or duplicate account proof: ${name} / ${row.title}`);
  if(visualMode==='none'||visualMode==='walkthrough'&&!policy.visualViewports.includes(name))continue;
  const labels=visualMode==='walkthrough'?row.labels.filter(label=>policy.checkpoints.includes(label)):row.labels;
  for(const label of labels)for(const kind of visualMode==='walkthrough'?['context']:['context','component']){
   if(!matches[0].images?.some(image=>image.caption===`${label} · ${name} · ${kind}${kind==='component'?' (visible area)':''}`&&image.src&&image.thumbnail&&image.digest))throw Error(`Missing account checkpoint: ${name} / ${label} / ${kind}`);
  }
 }
}
