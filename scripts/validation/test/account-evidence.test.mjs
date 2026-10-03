import test from 'node:test';import assert from 'node:assert/strict';
import {verifyAccountEvidence,FRESH_ACCOUNT_WORKFLOW,RETAINED_ACCOUNT_WORKFLOW} from '../account-evidence.mjs';
const labels=['account-home','sign-in','recovery-acknowledgment','account-owned-move','account-settings'];
const item=(viewport,title,checkpoints)=>({viewport,title:`${viewport} / accounts.spec.mjs / ${title}`,status:'passed',images:checkpoints.flatMap(label=>['context','component'].map(kind=>({caption:`${label} · ${viewport} · ${kind}${kind==='component'?' (visible area)':''}`,src:'images/x.png',thumbnail:'images/t.png',digest:'hash'})))});
test('account acceptance requires each exact workflow and viewport with both image roles',()=>{
 const rows=['mobile','mid-wide','full-wide'].flatMap(viewport=>[item(viewport,FRESH_ACCOUNT_WORKFLOW,labels),item(viewport,RETAINED_ACCOUNT_WORKFLOW,['retained-account-upgrade'])]);
 verifyAccountEvidence(rows,{retained:true});
 assert.throws(()=>verifyAccountEvidence([...rows.slice(0,5),rows[0]],{retained:true}),/Missing or duplicate/);
 const missing=structuredClone(rows);missing[0].images.pop();assert.throws(()=>verifyAccountEvidence(missing,{retained:true}),/checkpoint/);
 assert.throws(()=>verifyAccountEvidence(rows,{retained:true,capabilities:{stories:true}}),/unavailable-trained-story/);
 assert.throws(()=>verifyAccountEvidence(rows,{retained:true,capabilities:{movePreview:true}}),/move-preview-before-confirm/);
 assert.throws(()=>verifyAccountEvidence(rows,{retained:true,legacy:true}),/legacy-history/);
});

test('results capability requires result, chosen rematch, and confirmed new game at every viewport',()=>{
 const resultLabels=['friend-game-result','friend-rematch-choice','friend-rematch-created'];
 const rows=['mobile','mid-wide','full-wide'].map(viewport=>item(viewport,FRESH_ACCOUNT_WORKFLOW,[...labels,...resultLabels]));
 verifyAccountEvidence(rows,{capabilities:{results:true}});
 for(const label of resultLabels){const missing=structuredClone(rows);missing[1].images=missing[1].images.filter(image=>!image.caption.startsWith(label+' ·'));assert.throws(()=>verifyAccountEvidence(missing,{capabilities:{results:true}}),/Missing account checkpoint/);}
});
