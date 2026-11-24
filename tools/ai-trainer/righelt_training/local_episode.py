"""New local authority, with no changes to historical campaign clocks."""
from datetime import datetime
import math
from pathlib import Path
import json


def wall(value):
    return datetime.fromisoformat(value).timestamp()


def validate(plan):
    from .portable import read_bound
    authority=json.loads(read_bound(plan['localAuthority']))
    boundaries=authority['boundaries'];start=wall(authority['kickoff'])
    expected={'preparation':3,'broad':10,'targeted':15,'trainingStop':20,'delivery':24}
    if (authority.get('schema')!=1 or authority.get('kind')!='approved-local-24hour-program'
            or not authority.get('authority') or any(wall(boundaries[k])!=start+h*3600 for k,h in expected.items())
            or plan.get('schema')!=3 or plan.get('trainingStopWall')!=wall(boundaries['trainingStop'])
            or plan.get('artifactDeadlineWall')!=wall(boundaries['delivery'])
            or plan.get('checkpoint',{}).get('sha256')!=authority['baseline']['sha256']
            or plan.get('seed')!=2026112401 or plan.get('nativeManifest',{}).get('executionBackend')!='mps'
            or authority['authorityScope'].get('cloud') is not False
            or authority['authorityScope'].get('defaultPromotion') is not False
            or authority['caps']!={'experimentalSeconds':21600,'repairSeconds':10800,'automaticResumes':2,
                'repairAttemptsPerFailure':2,'newRunBytes':96*1024**3,'freeDiskBytes':50*1024**3,
                'initialWorkers':2,'maximumWorkers':4}):
        raise ValueError('new local window does not match approved authority')
    return authority


def consume_resume(directory,reason,now):
    from .allocation import append,rows
    from .exploratory_contract import start_repair,check_repair
    directory=Path(directory);plan=json.loads((directory/'plan.json').read_text());authority=validate(plan)
    events=[r for r in rows(directory/'exploratory-recovery.jsonl') if r['event']=='resume-consumed']
    if (reason not in ('resource-pressure-stop','transport-interruption') or not math.isfinite(now)
            or now>=plan['trainingStopWall'] or len(events)>=authority['caps']['automaticResumes']):
        raise ValueError('local resume reason, deadline or allowance invalid')
    start_repair(directory,now);check_repair(directory,now)
    append(directory/'exploratory-recovery.jsonl',{'event':'resume-consumed','ordinal':len(events)+1,
        'reason':reason,'observedAt':now,'trainingStopWall':plan['trainingStopWall']})


def resource_stop(directory,sample):
    """Apply this allocation's stricter caps without altering old policy limits."""
    path=Path(directory)/'plan.json'
    if not path.exists():return None
    plan=json.loads(path.read_text())
    if plan.get('schema')!=3:return None
    caps=validate(plan)['caps']
    # Keep one GiB inside the cap for final checkpoint, export and receipts.
    if sample.artifact_bytes>=caps['newRunBytes']-1024**3:return 'local-artifact-cap'
    if sample.disk_free_bytes<caps['freeDiskBytes']+1024**3:return 'local-disk-reserve'
    return None
