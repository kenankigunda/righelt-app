import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { credentialGuard, sessionGuard, clearTransactionGuard } from '../src/auth-db.ts';
const require=createRequire(import.meta.url);
const {Miniflare}=createRequire(require.resolve('wrangler/package.json'))('miniflare');
const root=fileURLToPath(new URL('../../../',import.meta.url));
const migration=readFileSync(new URL('../../../db/migrations/0011_accounts.sql',import.meta.url),'utf8');
const token='a'.repeat(64), recovery='b'.repeat(64);
const createAccount=(db,id='account-a',username='Kenan')=>db.prepare('INSERT INTO accounts(account_id,username,username_canonical,display_name,created_at,password_hash,recovery_hash) VALUES(?,?,?,?,?,?,?)').bind(id,username,username.toLowerCase(),username,1000,'synthetic-encoded-hash',recovery).run();

test('actual D1 schema: uniqueness, immutable usernames, conditional guard rollback and concurrent winner',async()=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:'auth-foundations'}});
 try {
  const db=await mf.getD1Database('DB');
  // D1 exec handles single-line statements; prepare supports complete SQL scripts
  // split on statement boundaries, keeping the one trigger body together.
  const clean=migration.replace(/--[^\n]*/g,'');
  const trigger=clean.match(/CREATE TRIGGER[\s\S]*?END;/)[0];
  const statements=[...clean.replace(trigger,'').split(';').filter(sql=>sql.trim()),trigger].map(sql=>db.prepare(sql.trim()));
  await db.batch(statements);
  await createAccount(db);
  await assert.rejects(createAccount(db,'account-b','kenan'),/UNIQUE/);
  await assert.rejects(db.prepare("UPDATE accounts SET username='Other',username_canonical='other' WHERE account_id='account-a'").run(),/immutable/);
  await assert.rejects(db.prepare("UPDATE accounts SET tutorial_state='invalid'").run(),/CHECK/);
  const expected={accountId:'account-a',credentialVersion:1,recoveryVersion:1,sessionEpoch:1};
  const update=()=>db.prepare("UPDATE accounts SET credential_version=credential_version+1 WHERE account_id='account-a'");
  const batch=id=>db.batch([credentialGuard(db,id,expected),update(),clearTransactionGuard(db,id)]);
  const races=await Promise.allSettled([batch('guard-1'),batch('guard-2')]);
  assert.equal(races.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await db.prepare('SELECT credential_version FROM accounts').first()).credential_version,2);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM account_transaction_guards').first()).n,0);
  // A late guard failure must undo earlier writes as well as skip later ones.
  await assert.rejects(db.batch([db.prepare("UPDATE accounts SET display_name='must rollback'"),credentialGuard(db,'stale',expected)]),/CHECK/);
  assert.equal((await db.prepare('SELECT display_name FROM accounts').first()).display_name,'Kenan');
  await assert.rejects(db.batch([credentialGuard(db,'missing',{...expected,accountId:'missing'}),update()]),/CHECK/);
  // A failure after the credential write must also roll back its increment.
  await assert.rejects(db.batch([credentialGuard(db,'later-failure',{...expected,credentialVersion:2}),update(),db.prepare("INSERT INTO account_sessions(token_hash,account_id,session_epoch,context_id,created_at,last_activity_at,expires_at) VALUES('bad','account-a',1,'bad',1000,1000,2000)")]),/CHECK/);
  assert.equal((await db.prepare('SELECT credential_version FROM accounts').first()).credential_version,2);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM account_transaction_guards').first()).n,0);
  await db.prepare('INSERT INTO account_sessions(token_hash,account_id,session_epoch,context_id,created_at,last_activity_at,expires_at) VALUES(?,?,1,?,1000,1000,9999999999999)').bind(token,'account-a','browser-a').run();
  const attempt=(id,context,ack=true)=>db.batch([sessionGuard(db,id,token,context,ack),db.prepare("UPDATE accounts SET display_name='authorized'"),clearTransactionGuard(db,id)]);
  await assert.rejects(attempt('unack','browser-a'),/CHECK/);
  await attempt('restricted','browser-a',false);
  await db.prepare('UPDATE accounts SET recovery_acknowledged=1').run();
  await attempt('valid','browser-a');
  const queued=sessionGuard(db,'expired',token,'browser-a');
  await db.prepare("UPDATE account_sessions SET expires_at=CAST(unixepoch('subsec') * 1000 AS INTEGER)").run();
  await assert.rejects(db.batch([queued]),/CHECK/);
  await db.prepare('UPDATE account_sessions SET expires_at=9999999999999').run();
  await assert.rejects(attempt('switched','browser-b'),/CHECK/);
  await db.prepare('UPDATE accounts SET session_epoch=session_epoch+1').run();
  await assert.rejects(attempt('revoked-epoch','browser-a'),/CHECK/);
  await db.prepare('UPDATE account_sessions SET session_epoch=2,revoked_at=1500').run();
  await assert.rejects(attempt('revoked-session','browser-a'),/CHECK/);
 } finally {await mf.dispose();}
});

test('actual workerd private admission/hash services: random salts, verification, strict inputs and burst',async()=>{
 const common={modules:true,modulesRules:[{type:'ESModule',include:['**/*.mjs','**/*.js'],fallthrough:true}],compatibilityDate:'2026-03-12',compatibilityFlags:['nodejs_compat']};
 const mf=new Miniflare({workers:[
  {...common,name:'auth',scriptPath:`${root}apps/auth/index.mjs`,durableObjects:{PASSWORD_ADMISSION:{className:'PasswordAdmissionDO',useSQLite:true}},serviceBindings:{HASH_ENGINE:'hash'}},
  {...common,name:'hash',scriptPath:`${root}apps/auth-hash/index.mjs`,durableObjects:{PASSWORD_HASH:{className:'PasswordHashDO',useSQLite:true}}},
 ]});
 const password='synthetic-password-123';
 const send=body=>mf.dispatchFetch('https://auth.internal/hash',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try {
  const first=await send({operation:'hash',password});assert.equal(first.status,200);assert.equal(first.headers.get('Cache-Control'),'no-store');const {encoded}=await first.json();
  assert.notEqual((await (await send({operation:'hash',password})).json()).encoded,encoded);
  assert.equal((await (await send({operation:'verify',password,encoded})).json()).verified,true);
  assert.equal((await (await send({operation:'verify',password:'incorrect-password-123',encoded})).json()).verified,false);
  for(const input of [{operation:'hash',password,N:1},{operation:'hash',password:'short'},{operation:'verify',password,encoded:'invalid'},{operation:'hash',password:'x'.repeat(5000)},null]) assert.equal((await send(input)).status,400);
  const burst=await Promise.all(Array.from({length:20},()=>send({operation:'hash',password})));
  assert.ok(burst.some(r=>r.status===429));assert.ok(burst.some(r=>r.status===200));assert.ok(burst.every(r=>r.status===200||r.status===429));
  assert.equal((await send({operation:'hash',password})).status,200);
 } finally {await mf.dispose();}
});
