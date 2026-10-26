"""Explicit training-only curriculum/teacher choices, separate from live search."""
import hashlib
import json
from .config import ROOT
DEFINITION_PATH=ROOT/'packages/computer-player/config/followup-teaching-v1.json'
DEFINITION=json.loads(DEFINITION_PATH.read_text())
DEFINITION_SHA256=hashlib.sha256(DEFINITION_PATH.read_bytes()).hexdigest()


def checked_recipe(value):
    if value is None:return None
    if not isinstance(value,dict)or set(value)!={'schema','kind','pretrainRounds','teacher','curriculum','definitionSha256'}:
        raise ValueError('Incomplete pilot teaching recipe')
    if value['schema']!=1 or value['kind']!=DEFINITION['kind']or value['definitionSha256']!=DEFINITION_SHA256:raise ValueError('Unknown pilot recipe')
    if type(value['pretrainRounds'])is not int or not 1<=value['pretrainRounds']<=DEFINITION['maximumPretrainRounds']:raise ValueError('Unbounded replay pretraining')
    if value['curriculum']!=DEFINITION['curriculum']:raise ValueError('Unknown pilot curriculum')
    teacher=value['teacher']
    if not isinstance(teacher,dict)or set(teacher)!={'path','sha256','manifestSha256'}:raise ValueError('Teacher checkpoint binding required')
    if not isinstance(teacher['path'],str)or not teacher['path'].startswith('/')or any(not isinstance(teacher[k],str)or len(teacher[k])!=64 or any(c not in '0123456789abcdef'for c in teacher[k])for k in ('sha256','manifestSha256')):
        raise ValueError('Invalid teacher checkpoint identity')
    return value


def recipe_hash(value):
    checked_recipe(value)
    if value is None:raise ValueError('Explicit pilot recipe required')
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()


def teaching_job(recipe,index,current_version):
    checked_recipe(recipe)
    if type(index)is not int or index<0:raise ValueError('Invalid teaching job identity')
    # Cross all four curricula slots with all four opponent/teacher roles.
    cycle=(index//4+index)%4
    selected=DEFINITION['cycles'][cycle]
    roles=selected['roles']
    profile=DEFINITION['profiles'][selected['profile']]
    return {'schema':1,'recipeSha256':recipe_hash(recipe),'cycle':cycle,
            'roles':dict(roles),'definitionSha256':DEFINITION_SHA256,
            'models':{'current':current_version,'teacher':recipe['teacher']['sha256']},
            'profiles':{seat:dict(profile)for seat in ('P1','P2')}}


def new_update_count(state):
    total=state['updates'];inherited=state.get('inheritedUpdates',0);nonzero=state['nonzeroUpdates']
    if any(type(v)is not int or v<0 for v in (total,inherited,nonzero))or inherited>total:
        raise ValueError('Invalid inherited/new update accounting')
    return total-inherited


def finite_new_updates(state):
    count=new_update_count(state)
    return count>0 and state['nonzeroUpdates']==count


def curriculum_slot(index):
    if type(index)is not int or index<0:raise ValueError('Invalid curriculum index')
    slots=DEFINITION['curriculumSlots']
    return slots[index%len(slots)]
