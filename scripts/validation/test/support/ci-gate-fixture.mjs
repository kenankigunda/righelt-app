export function gateFixture({repository='o/r',head='h',base='b',number=1,baseRef='main',conclusion='success',status='completed'}={}) {
 const detailsUrl=`https://github.com/${repository}/actions/runs/101/job/202`;
 const selected={__typename:'CheckRun',name:'PR validation',workflowName:'CI',detailsUrl,status:status.toUpperCase(),conclusion:conclusion?.toUpperCase()??null};
 const job={id:202,run_id:101,run_attempt:1,name:'PR validation',head_sha:head,html_url:detailsUrl,check_run_url:`https://api.github.com/repos/${repository}/check-runs/303`,status,conclusion};
 const check={id:303,name:'PR validation',head_sha:head,status,conclusion,app:{slug:'github-actions',owner:{login:'github'}},check_suite:{id:404}};
 const run={id:101,run_attempt:1,repository:{full_name:repository},path:'.github/workflows/ci.yml',name:'CI',head_sha:head,event:'pull_request',check_suite_id:404,pull_requests:[{number,head:{sha:head},base:{sha:base,ref:baseRef}}]};
 const gate={verified:true,status:'passed',name:'PR validation',workflowPath:'.github/workflows/ci.yml',repository,number,head,base,baseRef,runId:101,runAttempt:1,jobId:202,checkId:303,checkSuiteId:404,checkedAt:new Date().toISOString()};
 return {selected,job,check,run,gate,resources:{[`repos/${repository}/actions/jobs/202`]:job,[`repos/${repository}/check-runs/303`]:check,[`repos/${repository}/actions/runs/101`]:run}};
}
