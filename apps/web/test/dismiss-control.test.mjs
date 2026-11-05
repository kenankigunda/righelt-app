import test from 'node:test';
import assert from 'node:assert/strict';
import {renderDismissButton} from '../shell/dismiss-control.js';

test('dismissal keeps a native button, mandatory accessible name and decorative icon',()=>{
 const html=renderDismissButton({label:'Close invite',className:'invite-close',attributes:{'data-action':'close-invite'}});
 assert.match(html,/^<button type="button"/);
 assert.match(html,/class="ui-icon-button ui-dismiss-button invite-close"/);
 assert.match(html,/aria-label="Close invite"/);
 assert.match(html,/data-action="close-invite"/);
 assert.match(html,/<svg[^>]*aria-hidden="true"[^>]*focusable="false"/);
 for(const label of [undefined,null,'','   ',42])assert.throws(()=>renderDismissButton({label}),/accessible label/);
});

test('dismiss owner attributes preserve boolean presence and aria false without overriding semantics',()=>{
 const html=renderDismissButton({label:'Close',attributes:{'data-cancel':true,'data-modal-close':true,'aria-expanded':false,'data-optional':false,'data-empty':null},disabled:true});
 assert.match(html,/ disabled data-cancel data-modal-close aria-expanded="false"/);
 assert.doesNotMatch(html,/data-optional|data-empty/);
 for(const name of ['type','class','aria-label','aria-labelledby','onclick','data-action" onclick="bad','data-'])assert.throws(()=>renderDismissButton({label:'Close',attributes:{[name]:'bad'}}),/Unsupported dismiss attribute/);
});

test('dismiss labels, classes and owner values escape markup without adding attributes',()=>{
 const html=renderDismissButton({label:'Close <thing> "now"',className:'owner" autofocus="',attributes:{'data-action':'x" onclick="bad'}});
 assert.match(html,/aria-label="Close &lt;thing&gt; &quot;now&quot;"/);
 assert.match(html,/owner&quot; autofocus=&quot;/);
 assert.match(html,/data-action="x&quot; onclick=&quot;bad"/);
 assert.doesNotMatch(html,/<thing>| onclick="| autofocus="/);
});
