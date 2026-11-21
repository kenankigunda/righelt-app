"""One prospective admission window, sharing the original repair and create cap."""
import json
from pathlib import Path

LIMITS=json.loads((Path(__file__).resolve().parents[3]/'tools/hosted-compute/cloud-launch-20261121.json').read_bytes())


def admission_window(plan,repair_limits):
    if 'launchAuthorityId' not in plan:
        return repair_limits['repairStartedAt']/1000,repair_limits['repairDeadline']/1000
    if (plan.get('launchAuthorityId')!=LIMITS['id'] or plan.get('episodeId')!=LIMITS['episodeId']
            or plan.get('launchAuthorizedAtWall')!=LIMITS['authorizedAt']/1000
            or plan.get('launchAdmissionDeadlineWall')!=LIMITS['admissionDeadline']/1000
            or type(plan.get('additionalRepairSeconds')) is not int or plan['additionalRepairSeconds']!=0):
        raise ValueError('explicit prospective launch with no additional repair required')
    return LIMITS['authorizedAt']/1000,LIMITS['admissionDeadline']/1000


def is_prospective(plan):
    return plan.get('launchAuthorityId')==LIMITS['id']


def qualify(directory,plan,gate_path):
    """Emit only after the real target gate passes, before productive training."""
    import hashlib
    import time
    from .cloud_episode import validate
    from .exploratory_contract import validate_gate,digest
    from .checkpoint import atomic_json
    validate(plan)
    now=int(time.time()*1000)
    if not is_prospective(plan) or not LIMITS['authorizedAt']<=now<LIMITS['admissionDeadline']:
        raise ValueError('prospective target qualification admission expired')
    gate_raw=Path(gate_path).read_bytes();gate=json.loads(gate_raw)
    validate_gate(gate,plan['sourceRevision'],'cuda',plan)
    qualified_at=int(time.time()*1000)
    if qualified_at>=LIMITS['admissionDeadline']:
        raise ValueError('prospective target qualification admission expired')
    record={'schema':1,'kind':'prospective-launch-qualified','launchAuthorityId':LIMITS['id'],
            'episodeId':LIMITS['episodeId'],'sourceRevision':plan['sourceRevision'],'planSha256':digest(plan),
            'launchGateSha256':hashlib.sha256(gate_raw).hexdigest(),
            'targetReportSha256':gate['checks']['targetBackend']['evidence']['sha256'],
            'qualifiedAt':qualified_at,'admissionDeadline':LIMITS['admissionDeadline'],
            'additionalRepairSeconds':0,'productiveWorkStarted':False}
    path=Path(directory)/'launch-qualified.json'
    if path.exists():raise ValueError('prospective target qualification already recorded')
    atomic_json(path,record)
    return record
