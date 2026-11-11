import test from 'node:test';
import assert from 'node:assert/strict';
import {requiresUndoApproval} from '../generated/packages/shared-types/src/undo-policy.js';
test('Undo is direct for one controller, including self-play and owned computer seats',()=>{
 for(const other of [null,undefined,'owner'])assert.equal(requiresUndoApproval('owner',other),false);
});
test('Undo against another human requires their approval regardless of their name',()=>{
 for(const other of ['another-human','Babs','Computer'])assert.equal(requiresUndoApproval('owner',other),true);
});
