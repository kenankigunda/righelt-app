import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export function archiveConfig(source,bucket){
 if(!/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket||''))throw Error('Provide the verified private archive bucket name');
 if(/\[\[r2_buckets\]\]|\[triggers\]/.test(source))throw Error('Existing resource bindings require explicit reconciliation');
 for(const flag of ['STORAGE_ARCHIVES_ENABLED','STORAGE_BUDGET_ENABLED','STORAGE_EXCLUSIVE_R2'])source=source.replace(`${flag} = "false"`,`${flag} = "true"`);
 return source+`\n[[r2_buckets]]\nbinding = "ARCHIVES"\nbucket_name = "${bucket}"\n\n[triggers]\ncrons = ["0 * * * *"]\n`;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const args=process.argv.slice(2),bucket=args[args.indexOf('--bucket')+1];
  if(!args.includes('--exclusive-bucket'))throw Error('Confirm account-wide R2 usage is exclusively tracked by this bucket');
  const path='apps/api/wrangler.toml',result=archiveConfig(readFileSync(path,'utf8'),bucket);
  if(args.includes('--apply'))writeFileSync(path,result);else console.log(result);
 }catch(error){console.error(error.message);process.exitCode=1;}
}
