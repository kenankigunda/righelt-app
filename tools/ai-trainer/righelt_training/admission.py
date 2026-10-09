"""Conservative generation admission; estimates never extend experiment bounds."""
import math
from pathlib import Path
from .allocation import append, rows

KINDS=('normal','simple','continuation')
PHASES=('generation','replay')
# Conservative admission defaults, not measured performance promises. Observed
# complete and censored durations can only raise these per-kind estimates.
FLOORS={'generation':60.,'replay':20.}
CHECKPOINT_ALLOWANCE=10.
HISTORY_SIZE=128


def apply_observation(state,record):
    if (record.get('kind') not in KINDS or record.get('phase') not in PHASES
        or not isinstance(record.get('jobId'),str) or not record['jobId']
        or type(record.get('censored')) is not bool
        or type(record.get('seconds')) not in (int,float)
        or not math.isfinite(record['seconds']) or record['seconds']<0):
        raise ValueError('invalid admission duration evidence')
    groups=state.setdefault('admissionDurations',{})
    key=f"{record['kind']}:{record['phase']}"
    group=groups.setdefault(key,{'completed':[],'completedCount':0,'censoredCount':0,'censoredLowerBound':0.})
    if record['censored']:
        group['censoredCount']+=1
        group['censoredLowerBound']=max(group['censoredLowerBound'],record['seconds'])
    else:
        group['completedCount']+=1
        group['completed']=(group['completed']+[record['seconds']])[-HISTORY_SIZE:]


def restore_observations(state,directory):
    path=(Path(directory)/'admission-durations.jsonl').resolve()
    # Checkpoint summaries can be inherited, but a relocated allocation has its
    # own append-only journal and cursor. Do not replay the old run twice.
    if state.get('admissionJournalPath')!=str(path):
        state['admissionJournalPath']=str(path);state['admissionJournalCursor']=0
    records=rows(path);cursor=state.get('admissionJournalCursor',0)
    if type(cursor) is not int or not 0<=cursor<=len(records):raise ValueError('admission journal truncated')
    for record in records[cursor:]:apply_observation(state,record)
    state['admissionJournalCursor']=len(records)


def observe(state,directory,*,job_id,kind,phase,seconds,censored):
    restore_observations(state,directory)
    record={'jobId':job_id,'kind':kind,'phase':phase,'seconds':seconds,'censored':censored}
    # Validate before the immutable append. A crash after append is recovered by
    # the checkpoint-bound cursor without forgetting or double-counting evidence.
    apply_observation({},record)
    append(Path(directory)/'admission-durations.jsonl',record)
    apply_observation(state,record)
    state['admissionJournalCursor']+=1


def estimate(state,kind):
    if kind not in KINDS:raise ValueError('unknown admission kind')
    bounds={}
    for phase in PHASES:
        group=state.get('admissionDurations',{}).get(f'{kind}:{phase}',{})
        completed=sorted(group.get('completed',[]))
        p90=completed[max(0,math.ceil(len(completed)*.9)-1)] if completed else 0.
        lower=group.get('censoredLowerBound',0.)
        bounds[phase]=max(FLOORS[phase],1.25*max(p90,lower))
    return {**bounds,'checkpoint':CHECKPOINT_ALLOWANCE,
            'requiredSeconds':sum(bounds.values())+CHECKPOINT_ALLOWANCE,
            'basis':'max(default floor, 1.25 × max(completed p90, unfinished lower bound))'}
