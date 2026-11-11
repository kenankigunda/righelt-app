import test from 'node:test';
import assert from 'node:assert/strict';
import {issueDiagnostics} from '../shell/issue-diagnostics.js';
import {renderDiagnosticDisclosure,handleDiagnosticAction} from '../shell/diagnostic-disclosure.js';

test('labelled inline details copies the complete sanitized Debug report and confirms success',async t=>{
 issueDiagnostics.clear();t.after(()=>issueDiagnostics.clear());
 const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');let copied;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async value=>{copied=value;}}}});
 t.after(()=>{if(original)Object.defineProperty(globalThis,'navigator',original);else delete globalThis.navigator;});
 const id=issueDiagnostics.capture('inline-copy',{operation:'move_recovery',stage:'notice_promoted',gameId:'g',commandId:'same-command',fingerprint:'same-fingerprint',authorization:'SECRET'});
 const target=action=>({dataset:{action,incidentId:id}});
 assert.match(renderDiagnosticDisclosure(id),/>Details<\/button>/);
 await handleDiagnosticAction(target('toggle-diagnostic'));
 assert.match(renderDiagnosticDisclosure(id),/>Copy full details<\/button>/);
 await handleDiagnosticAction(target('copy-diagnostic'));
 assert.equal(copied,issueDiagnostics.text(id));assert.doesNotMatch(copied,/SECRET/);
 assert.match(renderDiagnosticDisclosure(id),/role="status">Full details copied\./);
 assert.equal(renderDiagnosticDisclosure(id,'recent').includes('same-command'),true);
});

test('denied clipboard keeps full manual text and an accessible status',async t=>{
 issueDiagnostics.clear();t.after(()=>issueDiagnostics.clear());
 const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async()=>{throw Error('denied');}}}});
 t.after(()=>{if(original)Object.defineProperty(globalThis,'navigator',original);else delete globalThis.navigator;});
 const id=issueDiagnostics.capture('inline-denied',{operation:'move_recovery',stage:'failed'});
 await handleDiagnosticAction({dataset:{action:'toggle-diagnostic',incidentId:id}});
 await handleDiagnosticAction({dataset:{action:'copy-diagnostic',incidentId:id}});
 const html=renderDiagnosticDisclosure(id);
 assert.match(html,/role="status">Copy the full details below\./);assert.match(html,/<pre tabindex="0">/);
 assert.match(html,/move_recovery/);assert.doesNotMatch(html,/Full details copied\./);
});
