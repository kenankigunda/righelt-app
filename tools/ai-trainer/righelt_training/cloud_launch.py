"""One prospective admission window, sharing the original repair and create cap."""
import json
from pathlib import Path

LIMITS=json.loads((Path(__file__).resolve().parents[3]/'tools/hosted-compute/cloud-launch-20261121.json').read_bytes())
REPLACEMENT=json.loads((Path(__file__).resolve().parents[3]/'tools/hosted-compute/cloud-replacement-20261121.json').read_bytes())


def replacement_window(plan):
    ready=plan.get('repairReadyAtWall')
    if (type(ready) not in (int,float) or not REPLACEMENT['authorizedAt']/1000<=ready<=REPLACEMENT['repairDeadline']/1000
            or plan.get('launchAuthorizedAtWall')!=ready or plan.get('memoryScope')!=REPLACEMENT['memoryScope']
            or plan.get('consumedWorkTransfer',{}).get('sha256')!=REPLACEMENT['consumptionEvidenceSha256']):
        raise ValueError('verified replacement readiness and consumed work required')
    return ready,min(ready+REPLACEMENT['maximumQualificationMs']/1000,REPLACEMENT['qualificationDeadline']/1000)


def admission_window(plan,repair_limits):
    if 'launchAuthorityId' not in plan:
        return repair_limits['repairStartedAt']/1000,repair_limits['repairDeadline']/1000
    if plan.get('launchAuthorityId')==REPLACEMENT['id']:
        start,end=replacement_window(plan)
        if plan.get('episodeId')!=REPLACEMENT['episodeId'] or plan.get('launchAdmissionDeadlineWall')!=end or type(plan.get('additionalRepairSeconds')) is not int or plan['additionalRepairSeconds']!=0:
            raise ValueError('replacement qualification does not grant repair or resume')
        return start,end
    if (plan.get('launchAuthorityId')!=LIMITS['id'] or plan.get('episodeId')!=LIMITS['episodeId']
            or plan.get('launchAuthorizedAtWall')!=LIMITS['authorizedAt']/1000
            or plan.get('launchAdmissionDeadlineWall')!=LIMITS['admissionDeadline']/1000
            or type(plan.get('additionalRepairSeconds')) is not int or plan['additionalRepairSeconds']!=0):
        raise ValueError('explicit prospective launch with no additional repair required')
    return LIMITS['authorizedAt']/1000,LIMITS['admissionDeadline']/1000


def is_prospective(plan):
    return plan.get('launchAuthorityId') in (LIMITS['id'],REPLACEMENT['id'])


def qualify(directory,plan,gate_path):
    """Emit only after the real target gate passes, before productive training."""
    import hashlib
    import time
    from .cloud_episode import validate
    from .exploratory_contract import validate_gate,digest
    from .checkpoint import atomic_json
    validate(plan)
    from .cloud_episode import LIMITS as REPAIR
    start,end=admission_window(plan,REPAIR)
    if plan.get('launchAuthorityId')==REPLACEMENT['id']:
        from .portable import read_bound
        ready=json.loads(read_bound(plan['repairReadyProof']))
        if (ready.get('kind')!='bounded-repair-ready' or ready.get('authorityId')!=REPLACEMENT['id']
                or ready.get('sourceRevision')!=plan['sourceRevision'] or ready.get('repairReadyAt')!=round(start*1000)
                or ready.get('image')!=plan['nativeManifest']['runtimeMetadataImage']
                or any(ready.get(k) is not True for k in ('checksPassed','reviewPassed','imageVerified'))):
            raise ValueError('actual post-check repair-ready proof differs')
    now=int(time.time()*1000)
    if not is_prospective(plan) or not start*1000<=now<end*1000:
        raise ValueError('prospective target qualification admission expired')
    gate_raw=Path(gate_path).read_bytes();gate=json.loads(gate_raw)
    validate_gate(gate,plan['sourceRevision'],'cuda',plan)
    qualified_at=int(time.time()*1000)
    if qualified_at>=end*1000:
        raise ValueError('prospective target qualification admission expired')
    record={'schema':1,'kind':'prospective-launch-qualified','launchAuthorityId':plan['launchAuthorityId'],
            'episodeId':plan['episodeId'],'sourceRevision':plan['sourceRevision'],'planSha256':digest(plan),
            'launchGateSha256':hashlib.sha256(gate_raw).hexdigest(),
            'targetReportSha256':gate['checks']['targetBackend']['evidence']['sha256'],
            'qualifiedAt':qualified_at,'admissionDeadline':round(end*1000),
            'additionalRepairSeconds':0,'productiveWorkStarted':False}
    if plan['launchAuthorityId']==REPLACEMENT['id']:
        record.update(repairReadyAt=round(start*1000),repairReadyProofSha256=plan['repairReadyProof']['sha256'],
                      consumedWorkTransferSha256=plan['consumedWorkTransfer']['sha256'],memoryScope=REPLACEMENT['memoryScope'])
    path=Path(directory)/'launch-qualified.json'
    if path.exists():raise ValueError('prospective target qualification already recorded')
    atomic_json(path,record)
    return record
