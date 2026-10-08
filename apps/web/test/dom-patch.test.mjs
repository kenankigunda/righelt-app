import test from 'node:test';
import assert from 'node:assert/strict';
import { patchSectionContent } from '../shell/dom-patch.js';

test('parent patches preserve controller-owned preview children and runtime state', () => {
  const attributes = new Map([['data-mini-board-preview',''],['data-preview-id','old'],['class','mini-board-preview-root'],['data-preview-size-variant','compact']]);
  const board = { attached: true };
  const current = {
    hasAttribute: name => attributes.has(name),
    setAttribute: (name,value) => attributes.set(name,value),
    childNodes: [board],
  };
  const next = {
    hasAttribute: name => name === 'data-mini-board-preview',
    getAttribute: name => name === 'data-preview-id' ? 'new' : null,
    childNodes: [],
  };
  patchSectionContent(current,next);
  assert.equal(attributes.get('data-preview-id'),'new');
  assert.equal(attributes.get('class'),'mini-board-preview-root');
  assert.equal(attributes.get('data-preview-size-variant'),'compact');
  assert.equal(current.childNodes[0],board);
});
