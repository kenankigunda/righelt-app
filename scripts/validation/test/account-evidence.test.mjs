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

test('personal home evidence requires deliberate lower scroll positions at every viewport',()=>{
 const homeLabels=['personal-home-start-lower','returning-personal-home','returning-personal-home-lower'];
 const rows=['mobile','mid-wide','full-wide'].map(viewport=>item(viewport,FRESH_ACCOUNT_WORKFLOW,[...labels,...homeLabels]));
 verifyAccountEvidence(rows,{capabilities:{personalHome:true}});
 for(const label of homeLabels){const missing=structuredClone(rows);missing[0].images=missing[0].images.filter(image=>!image.caption.startsWith(label+' ·'));assert.throws(()=>verifyAccountEvidence(missing,{capabilities:{personalHome:true}}),/Missing account checkpoint/);}
});

test('text-only proof requires passed workflows for declared clients without images',()=>{
 const rows=['mobile','mid-wide'].map(v=>item(v,FRESH_ACCOUNT_WORKFLOW,[]));verifyAccountEvidence(rows,{visualMode:'none',viewports:['mobile','mid-wide']});assert.throws(()=>verifyAccountEvidence(rows,{visualMode:'none'}),/full-wide/);rows[1].status='failed';assert.throws(()=>verifyAccountEvidence(rows,{visualMode:'none',viewports:['mobile','mid-wide']}),/Missing or duplicate/);
});
test('walkthrough requires selected context checkpoints and exact workflows',()=>{
 const rows=['mobile','mid-wide'].map(v=>item(v,FRESH_ACCOUNT_WORKFLOW,['account-home']));for(const row of rows)row.images=row.images.filter(i=>i.caption.endsWith('context'));const options={visualMode:'walkthrough',viewports:['mobile','mid-wide'],checkpoints:['account-home']};verifyAccountEvidence(rows,options);assert.throws(()=>verifyAccountEvidence(rows.slice(1),options),/Missing or duplicate/);rows[0].images=[];assert.throws(()=>verifyAccountEvidence(rows,options),/account-home/);
});

test('walkthrough still requires full-wide behavioral pass without full-wide images',()=>{
 const rows=['mobile','mid-wide','full-wide'].map(v=>item(v,FRESH_ACCOUNT_WORKFLOW,v==='full-wide'?[]:['account-home']));verifyAccountEvidence(rows,{visualMode:'walkthrough',checkpoints:['account-home']});rows[2].status='failed';assert.throws(()=>verifyAccountEvidence(rows,{visualMode:'walkthrough',checkpoints:['account-home']}),/full-wide/);
});


test('simplified signup requires creation evidence and cannot be satisfied by retired recovery images',()=>{
 const rows=['mobile','mid-wide','full-wide'].map(v=>item(v,FRESH_ACCOUNT_WORKFLOW,labels));
 assert.throws(()=>verifyAccountEvidence(rows,{capabilities:{simplifiedAccounts:true}}),/account-creation/);
 const revised=['mobile','mid-wide','full-wide'].map(v=>item(v,FRESH_ACCOUNT_WORKFLOW,labels.map(label=>label==='recovery-acknowledgment'?'account-creation':label)));
 verifyAccountEvidence(revised,{capabilities:{simplifiedAccounts:true}});
 assert.throws(()=>verifyAccountEvidence(revised),/recovery-acknowledgment/);
});
