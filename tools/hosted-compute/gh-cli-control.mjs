import { execFile as nativeExecFile } from 'node:child_process';
import { assert, POLICY } from './policy.mjs';
import { GitHubControlWriter } from './github-control.mjs';

// Operator-only transport. Call the operator CLI through an authorized scoped
// outside-sandbox launch. gh reads its existing OS keyring login itself. Never
// run `gh auth token`, copy the login into an environment variable, or put a
// credential/body in process arguments. Runtime controller/Actions transports
// use their separate purpose-scoped credentials instead.
export function ghCliFetch(execFile=nativeExecFile) {
  return async(url,options={})=>{
    const parsed=new URL(url),method=options.method??'GET';
    assert(parsed.origin==='https://api.github.com' && parsed.pathname.startsWith('/repos/') && ['GET','PUT'].includes(method),'fixed GitHub CLI API required');
    const args=['api','--hostname','github.com','--method',method,'--include',parsed.pathname.slice(1)+parsed.search];
    if(options.body!==undefined) args.push('--input','-');
    // Inherit only ordinary login/configuration paths. An ambient GH_TOKEN or
    // GITHUB_TOKEN must not replace the user's keyring login for operator work.
    const env=Object.fromEntries(['PATH','HOME','USER','LOGNAME','SHELL','TMPDIR','LANG','LC_ALL','GH_CONFIG_DIR','XDG_CONFIG_HOME'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
    env.GH_PROMPT_DISABLED='1';
    const {error,stdout}=await new Promise(resolve=>{
      const child=execFile('gh',args,{encoding:'utf8',maxBuffer:256*1024,timeout:POLICY.requestMs,env},(error,stdout)=>resolve({error,stdout}));
      child.stdin?.on?.('error',()=>{}); // execFile's callback reports early exit.
      child.stdin?.end(options.body);
    });
    const separator=/\r?\n\r?\n/.exec(stdout??''),status=/^HTTP\/[0-9.]+\s+(\d{3})\b/.exec(stdout??'');
    assert(separator && status,'GitHub CLI request unavailable');
    const code=Number(status[1]);
    assert(!error || code>=400,'GitHub CLI request unavailable');
    return new Response(stdout.slice(separator.index+separator[0].length),{status:code});
  };
}
export class GhCliControlWriter extends GitHubControlWriter {
  constructor({repository,branch='main',execFile}={}) {
    super({repository,branch,fetcher:ghCliFetch(execFile),authentication:'keyring'});
  }
}
