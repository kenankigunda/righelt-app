"""Read-only, namespace-aware cgroup-v2 workload memory observations."""
import math
import os
from pathlib import Path, PurePosixPath
import re
import json

_SCOPE_POLICY=json.loads((Path(__file__).resolve().parents[3]/'tools/hosted-compute/cloud-replacement-20261121.json').read_bytes())

SCOPE=_SCOPE_POLICY['memoryScope']


def _unescape(value):
    return re.sub(r'\\([0-7]{3})',lambda m:chr(int(m[1],8)),value)


def _absolute(value):
    path=PurePosixPath(value)
    if not path.is_absolute() or '..' in path.parts:raise ValueError('unsafe cgroup path')
    return path


def psi(raw):
    result={}
    for line in raw.splitlines():
        fields=line.split();name=fields[0];values=dict(item.split('=',1) for item in fields[1:])
        if name not in ('some','full') or name in result:raise ValueError('invalid pressure records')
        record={key:float(values[key]) for key in ('avg10','avg60','avg300')}
        if any(not math.isfinite(v) or not 0<=v<=100 for v in record.values()):raise ValueError('invalid pressure average')
        record['total']=int(values['total'])
        if record['total']<0:raise ValueError('invalid pressure total')
        result[name]=record
    if set(result)!= {'some','full'}:raise ValueError('incomplete workload pressure')
    return result


def _number(raw,unlimited=False):
    value=raw.strip()
    if unlimited and value=='max':return None
    if not re.fullmatch(r'[0-9]+',value):raise ValueError('invalid cgroup memory amount')
    return int(value)


class MemoryReader:
    def __init__(self,proc=Path('/proc'),*,read=None,pid=None):
        self.proc=Path(proc);self.read=read or (lambda path:Path(path).read_text());self.pid=os.getpid() if pid is None else pid
        self.previous={};self.identity=None;self.ancestor_identities={};self.diagnostics={}

    def locate(self):
        membership=[line.split(':',2)[2] for line in self.read(self.proc/'self/cgroup').splitlines() if line.startswith('0::')]
        if len(membership)!=1:raise ValueError('one cgroup-v2 membership required')
        group=_absolute(membership[0]);candidates=[]
        for line in self.read(self.proc/'self/mountinfo').splitlines():
            left,right=line.split(' - ',1)
            if right.split()[0]!='cgroup2':continue
            fields=left.split();mount_root=_absolute(_unescape(fields[3]));mount=Path(_unescape(fields[4]))
            _absolute(str(mount))
            relatives=[]
            if group.is_relative_to(mount_root):relatives.append(group.relative_to(mount_root))
            # A cgroup namespace may make membership relative to its mounted root.
            relatives.append(group.relative_to('/'))
            for relative in set(relatives):
                candidate=mount/str(relative)
                try:pids={int(p) for p in self.read(candidate/'cgroup.procs').split()}
                except (OSError,ValueError):continue
                if self.pid in pids:candidates.append((candidate,mount,str(mount_root),str(group)))
        unique={(str(c),str(m)): (c,m,r,g) for c,m,r,g in candidates}
        if len(unique)!=1:raise ValueError('ambiguous or inaccessible workload cgroup')
        return next(iter(unique.values()))

    def sample(self,physical_available):
        if type(physical_available) is not int or physical_available<0:raise ValueError('invalid physical headroom')
        self.diagnostics={'scope':SCOPE,'stage':'discover'}
        leaf,mount,mount_root,membership=self.locate();levels=[];self.diagnostics.update(membership=membership,mountRoot=mount_root,mountPoint=str(mount),levels=levels); headroom=physical_available;pressure='normal';swap=0;event_stop=False
        identity=(str(leaf),str(mount),os.stat(leaf).st_dev,os.stat(leaf).st_ino)
        if self.identity is not None and identity!=self.identity:raise ValueError('workload cgroup identity changed')
        current=leaf;now_events={};now_identities={}
        while True:
            names=('memory.current','memory.max','memory.high','memory.events','memory.swap.current','memory.pressure')
            raw={};self.diagnostics['partialRaw']={'path':str(current),'values':raw}
            try:
                for name in names:raw[name]=self.read(current/name)
            except FileNotFoundError:
                if current==mount and current!=leaf and mount_root=='/':
                    # The physical root cannot impose a memory-controller limit.
                    # A missing non-root file, including a namespace-root leaf,
                    # remains an error rather than a host-memory fallback.
                    absent=[]
                    for name in ('memory.max','memory.high'):
                        try:self.read(current/name)
                        except FileNotFoundError:absent.append(name)
                    if len(absent)==2:
                        levels.append({'path':str(current),'scope':'physical-root','raw':raw});break
                raise
            used=_number(raw['memory.current']);maximum=_number(raw['memory.max'],True);high=_number(raw['memory.high'],True)
            swap_used=_number(raw['memory.swap.current']);swap=max(swap,swap_used)
            events={key:_number(value) for key,value in (line.split() for line in raw['memory.events'].splitlines())}
            if not {'high','max','oom','oom_kill'}<=set(events):raise ValueError('incomplete workload memory events')
            key=str(current);prior=self.previous.get(key);delta={name:events[name]-(prior.get(name,0) if prior else events[name]) for name in events}
            info=os.stat(current);now_identities[key]=(info.st_dev,info.st_ino)
            if key in self.ancestor_identities and self.ancestor_identities[key]!=now_identities[key]:raise ValueError('workload ancestor identity changed')
            if any(v<0 for v in delta.values()):raise ValueError('workload event counter regressed')
            relevant=current==leaf or maximum is not None or high is not None
            event_stop|=relevant and any(delta.get(name,0)>0 for name in ('high','max','oom','oom_kill'))
            now_events[key]=events
            measured=psi(raw['memory.pressure']);avg=max(v['avg10'] for v in measured.values())
            if relevant and avg>=10:pressure='critical'
            elif relevant and avg>=1 and pressure!='critical':pressure='warning'
            for cap in (maximum,high):
                if cap is not None:headroom=min(headroom,max(0,cap-used))
            if maximum is not None and used>maximum:event_stop=True
            levels.append({'path':key,'current':used,'max':maximum,'high':high,'swapCurrent':swap_used,
                           'pressure':measured,'events':events,'eventDelta':delta,'limitingWorkloadBoundary':relevant,'raw':raw})
            if current==mount:break
            if mount not in current.parents:raise ValueError('cgroup escaped visible mount')
            current=current.parent
        if self.previous and set(now_events)!=set(self.previous):raise ValueError('workload ancestor identity changed')
        self.previous=now_events;self.identity=identity;self.ancestor_identities=now_identities
        if event_stop:pressure='critical'
        host_raw=self.read(self.proc/'pressure/memory');self.diagnostics['hostPressureRaw']=host_raw;host=psi(host_raw)
        return {'scope':SCOPE,'membership':membership,'mountRoot':mount_root,'mountPoint':str(mount),
                'physicalAvailable':physical_available,'effectiveAvailable':headroom,'workloadPressure':pressure,
                'swapCurrent':swap,'levels':levels,'hostPressure':host,'hostPressureRaw':host_raw}
