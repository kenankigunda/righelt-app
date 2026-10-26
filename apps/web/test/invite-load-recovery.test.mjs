import test from 'node:test';
import assert from 'node:assert/strict';
import { invitationLoadFailureKind, renderInviteLoadRecovery } from '../shell/invite-load-recovery.js';

test('only inconclusive invitation reads offer Retry', () => {
  for (const error of [{code:'request_timeout'}, {status:503}, new Error('offline')]) assert.equal(invitationLoadFailureKind(error), 'retry');
  for (const error of [{status:404}, {code:'invite_not_found'}, {code:'invalid_invite_token',status:400}]) assert.equal(invitationLoadFailureKind(error), 'unavailable');
  assert.equal(invitationLoadFailureKind({status:410}), 'expired');
});

test('invitation recovery exposes concise Retry and Home actions with canonical icons', () => {
  const html = renderInviteLoadRecovery();
  assert.match(html, /We couldn’t load your invitation/);
  assert.match(html, /data-action="retry-invite-load"/);
  assert.match(html, />[^<]*Retry<\/button>/);
  assert.match(html, /href="#\/"/);
  assert.equal((html.match(/<svg /g) ?? []).length, 2);
  assert.doesNotMatch(html, /timeout|HTTP|5000|request|network|data-action="join/);
});

test('manual retry keeps the same card and label while its action is disabled and loading', () => {
  const html = renderInviteLoadRecovery({pending:true});
  assert.match(html, /data-testid="invite-load-recovery" aria-busy="true"/);
  assert.match(html, /Loading your invitation/);
  assert.match(html, /data-loading-state="pending" disabled aria-busy="true"/);
  assert.match(html, /<h2 id="invite-surface-title">Open invitation<\/h2>/);
  assert.match(html, /data-action="retry-invite-load"[\s\S]*?Retry<\/button>/);
  assert.match(html, /Home<\/a>/);
});

test('confirmed missing and expired links show Home without an endless retry action', () => {
  for (const kind of ['unavailable','expired']) {
    const html=renderInviteLoadRecovery({kind,homeHref:'#/?debug=1&scenarios=1'});
    assert.match(html, /Invitation unavailable/);
    assert.match(html, kind==='expired' ? /has expired/ : /no longer available/);
    assert.doesNotMatch(html, /retry-invite-load|>Retry</);
    assert.match(html, /href="#\/\?debug=1&amp;scenarios=1"/);
  }
});
