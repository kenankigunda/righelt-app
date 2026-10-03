import { HASH_MAX_WAITING } from '../../packages/shared-types/src/auth-policy.js';
import { readHashInput } from '../auth-hash/index.mjs';
export class PasswordAdmissionDO {
  active=false;
  waiting=[];
  constructor(ctx,env) {this.env=env;}
  async fetch(request) {
    // Validate before occupying the bounded queue.
    const input=await readHashInput(request);
    if(!input) return Response.json({error:'invalid_input'},{status:400,headers:{'Cache-Control':'no-store'}});
    if(this.active) {
      if(this.waiting.length>=HASH_MAX_WAITING) return Response.json({error:'temporarily_unavailable'},{status:429,headers:{'Retry-After':'1','Cache-Control':'no-store'}});
      await new Promise(resolve=>this.waiting.push(resolve));
    } else this.active=true;
    try {
      return await this.env.HASH_ENGINE.fetch('https://auth.internal/hash',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    } catch {
      return Response.json({error:'temporarily_unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});
    } finally {
      const next=this.waiting.shift();if(next) next(); else this.active=false;
    }
  }
}
export default {
  async fetch(request,env) {
    try {return await env.PASSWORD_ADMISSION.get(env.PASSWORD_ADMISSION.idFromName('password-admission-v1')).fetch(request);}
    catch {return Response.json({error:'temporarily_unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
  }
};
