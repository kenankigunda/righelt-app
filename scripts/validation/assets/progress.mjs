export const statuses=['Needs revisit','Not started','In progress','Complete','Skipped'];
export const actions={ 'Not started':['Start','Complete','Skip'],'In progress':['Complete','Cancel','Skip'],Complete:['Reopen'],Skipped:['Start','Complete','Cancel'],'Needs revisit':['Start','Complete','Cancel','Skip']};
export function statusOf(record,revision){if(record && ['Complete','In progress'].includes(record.status)&&record.revision!==revision)return 'Needs revisit';return record?.status??'Not started';}
export function transition(record,action,revision,now=new Date().toISOString()){
  if(!actions[statusOf(record,revision)].includes(action))throw Error('Invalid transition');
  const status={Start:'In progress',Reopen:'In progress',Complete:'Complete',Cancel:'Not started',Skip:'Skipped'}[action];
  const next={...record,status,revision,updatedAt:now,notes:record?.notes??'',history:[...(record?.history??[])]};
  if(action==='Complete'&&!next.history.some(h=>h.revision===revision))next.history.push({revision,at:now});
  return {record:next,expanded:['Start','Reopen'].includes(action)};
}
export function validateBackup(data){
 if(data?.version!==1 || typeof data.namespace!=='string' || !data.records || typeof data.records!=='object'||Array.isArray(data.records)||!data.expanded||typeof data.expanded!=='object'||Array.isArray(data.expanded))throw Error('Invalid review backup');
 if(data.conflicts!==undefined&&(!Array.isArray(data.conflicts)||data.conflicts.some(c=>!c||typeof c.id!=='string'||typeof c.local!=='string'||typeof c.incoming!=='string')))throw Error('Invalid note conflicts');
 for(const [id,r]of Object.entries(data.records)){if(['__proto__','constructor','prototype'].includes(id)||!r||!statuses.includes(r.status)||typeof r.notes!=='string'||typeof r.revision!=='string'||!Number.isFinite(Date.parse(r.updatedAt))||!Array.isArray(r.history)||r.history.some(h=>typeof h.revision!=='string'||!Number.isFinite(Date.parse(h.at))))throw Error('Invalid review record');}
 for(const [id,x]of Object.entries(data.expanded))if(['__proto__','constructor','prototype'].includes(id)||typeof x!=='boolean')throw Error('Invalid expansion');return data;
}
export function mergeBackup(local,incoming){validateBackup(incoming);if(local.namespace!==incoming.namespace)throw Error('Backup belongs to another validation run');const next=structuredClone(local);const conflicts=[...(local.conflicts??[]),...(incoming.conflicts??[])];
 for(const [id,r]of Object.entries(incoming.records)){const prior=next.records[id];if(prior&&prior.notes!==r.notes)conflicts.push({id,local:prior.notes,incoming:r.notes});if(!prior||r.updatedAt>prior.updatedAt)next.records[id]={...r};if(prior)next.records[id]={...next.records[id],history:[...new Map([...prior.history,...r.history].map(h=>[h.revision,h])).values()]};}
 next.conflicts=conflicts;next.expanded={...incoming.expanded,...local.expanded};return {next,conflicts};}
