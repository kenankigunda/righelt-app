// All test services are local. Production schedules and R2 names never carry over.
export function storageFixtureConfig(source,{archives=false}={}){
 source=source.replace(/\[\[r2_buckets\]\][\s\S]*?(?=\n\[|$)/g,'').replace(/\[triggers\][\s\S]*?(?=\n\[|$)/g,'');
 for(const [key,value] of Object.entries({STORAGE_ARCHIVE_MODE:archives?'active':'disabled',STORAGE_ARCHIVE_CANARY_GAME_ID:'',STORAGE_ARCHIVES_ENABLED:String(archives),STORAGE_BUDGET_ENABLED:String(archives),STORAGE_EXCLUSIVE_R2:String(archives)})){
  const line=`${key} = ${JSON.stringify(value)}`,pattern=new RegExp(`^${key}\\s*=.*$`,'m');
  source=pattern.test(source)?source.replace(pattern,line):source.replace('[vars]',`[vars]\n${line}`);
 }
 if(archives)source+='\n[[r2_buckets]]\nbinding = "ARCHIVES"\nbucket_name = "local-storage-e2e"\n';
 return source;
}
