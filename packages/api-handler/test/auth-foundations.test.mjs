import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsername, normalizeDisplayName, normalizePassword, isPasswordAllowed, safeContinuation } from '../../shared-types/src/auth.ts';
import { authCookie, clearAuthCookie, readAuthCookie, randomToken, tokenHash, createRecoveryCode, normalizeRecoveryCode, sessionExpired, sessionExpiry, recoverySessionToken } from '../src/auth-security.ts';
import { hashPassword, verifyPassword, parseHash } from '../../../apps/auth-hash/hash.mjs';
import { PasswordAdmissionDO } from '../../../apps/auth/index.mjs';

test('username normalization preserves spelling but collapses ASCII case; rejects Unicode and punctuation',()=>{
  assert.deepEqual(normalizeUsername(' \tKenan_42\r'),{ok:true,value:{username:'Kenan_42',canonical:'kenan_42'}});
  for(const value of ['ab','a'.repeat(25),'a b','kéna','\u00a0kenan',null]) assert.equal(normalizeUsername(value).ok,false);
});
test('display names count graphemes and reject invisible/control/bidi content',()=>{
  assert.equal(normalizeDisplayName('', 'Kenan').value,'Kenan');
  assert.equal(normalizeDisplayName(' cafe\u0301 👩‍💻 ', 'Kenan').value,'café 👩‍💻');
  assert.equal(normalizeDisplayName('👩‍💻'.repeat(20),'Kenan').ok,true);
  for(const value of ['a'.repeat(33),'👩‍💻'.repeat(24),'\u200b\u200d','name\u202etext','name\ntext','name\ud800']) assert.equal(normalizeDisplayName(value,'Kenan').ok,false,value);
});
test('password policy counts normalized code points, preserves spaces and permits blocklist injection',()=>{
  assert.equal(normalizePassword('  abcdefghij  ').value,'  abcdefghij  ');
  assert.equal(normalizePassword('é'.repeat(11)+'e\u0301').value,'é'.repeat(12));
  assert.equal(normalizePassword('🦉'.repeat(128)).ok,true);
  for(const value of ['a'.repeat(11),'🦉'.repeat(129),'a'.repeat(12)+'\ud800',null]) assert.equal(normalizePassword(value).ok,false);
  assert.equal(isPasswordAllowed('CommonPassword12','kenan',new Set(['CommonPassword12'])),false);
  assert.equal(isPasswordAllowed('KeNaN','kenan',new Set()),false);
  assert.equal(isPasswordAllowed(' common password ','kenan',new Set(['common password'])),true);
});
test('continuation only permits same-origin internal routes',()=>{
  const origin='https://righelt.example';
  assert.equal(safeContinuation('/game/abc?invite=xyz#board',origin),'/game/abc?invite=xyz#board');
  for(const value of ['https://evil.test','//evil.test','/\\evil.test','/\n/evil.test','javascript:alert(1)',null]) assert.equal(safeContinuation(value,origin),null);
});
test('opaque tokens/recovery codes have roundtrip entropy and do not leak through cookie scope',async()=>{
  const token=randomToken();assert.match(token,/^[a-f0-9]{64}$/);assert.notEqual(token,randomToken());
  assert.equal((await tokenHash(token)).length,64);assert.notEqual(await tokenHash(token),token);
  const code=createRecoveryCode();assert.match(code,/^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){7}$/);
  assert.equal(normalizeRecoveryCode(code.toLowerCase().replaceAll('-',' ')),code.replaceAll('-',''));
  assert.equal(normalizeRecoveryCode('I'.repeat(32)),null);
  const cookie=authCookie(token);assert.match(cookie,/Max-Age=2592000; Secure; HttpOnly; SameSite=Lax$/);assert.doesNotMatch(cookie,/Domain=/);
  const request=value=>new Request('https://site.test',{headers:{Cookie:value}});
  assert.equal(readAuthCookie(request(cookie)),token);
  assert.equal(readAuthCookie(request(`${cookie}; __Host-righelt_session=${randomToken()}`)),null);
  assert.match(clearAuthCookie(),/Max-Age=0/);
  assert.throws(()=>authCookie('token; injected=true'));
  assert.equal(sessionExpiry(1000),2592001000);assert.equal(sessionExpired(1000,1000),true);assert.equal(sessionExpired(1001,1000),false);
  const key=randomToken(),flow=randomToken();
  assert.equal(await recoverySessionToken(key,flow),await recoverySessionToken(key,flow));
  assert.notEqual(await recoverySessionToken(key,flow),await recoverySessionToken(key,randomToken()));
});
test('fixed versioned scrypt format uses independent random salts and rejects altered parameters',()=>{
  const password='synthetic-password-123';const encoded=hashPassword(password), second=hashPassword(password);
  assert.notEqual(encoded,second);assert.equal(parseHash(encoded).salt.length,16);
  assert.equal(verifyPassword(password,encoded),true);assert.equal(verifyPassword('incorrect-password-123',encoded),false);
  for(const value of [encoded.replace('$16384$','$1024$'),encoded.replace('scrypt$1','scrypt$2'),encoded+'0','invalid']) {assert.equal(parseHash(value),null);assert.equal(verifyPassword(password,value),false);}
});
test('private admission queues four and releases work on upstream failure',async()=>{
  const releases=[];let calls=0;
  const admission=new PasswordAdmissionDO(null,{HASH_ENGINE:{fetch:async()=>{const index=calls++;await new Promise(resolve=>releases.push(resolve));if(index===0) throw new Error('unavailable');return Response.json({encoded:'test'});}}});
  const request=()=>new Request('https://auth.internal/hash',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'hash',password:'synthetic-password-123'})});
  const jobs=Array.from({length:20},()=>admission.fetch(request()));
  // Attach rejection observers before releasing the deliberately failed request.
  const settled=Promise.allSettled(jobs);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
  for(let i=0;i<5;i++){releases.shift()();await new Promise(resolve=>setImmediate(resolve));}
  const results=await settled;
  assert.equal(results.filter(r=>r.status==='rejected').length,0);
  const failed=results.find(r=>r.value.status===503).value;
  assert.deepEqual(await failed.json(),{error:'temporarily_unavailable'});
  assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.status===429).length,15);
  assert.equal(calls,5);assert.equal(admission.active,false);
});
