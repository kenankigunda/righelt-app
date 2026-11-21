import sys
import math
"""Read-only telemetry. Missing activity observations never imply idle threads."""
import json
import os
import stat
from pathlib import Path
import subprocess
import time
import psutil
from .resources import Sample

def artifact_bytes(root):
    """Measure live artifacts without treating atomic publication as failure.

    A scan is a point-in-time estimate, not an archive integrity check. Only
    vanished descendants are harmless; inaccessible storage must fail closed.
    scandir propagates traversal errors which Path.rglob may suppress.
    """
    root=Path(root)
    if not stat.S_ISDIR(root.stat().st_mode):raise NotADirectoryError(str(root))
    pending=[root];total=0
    while pending:
        directory=pending.pop()
        try:
            with os.scandir(directory) as entries:
                for entry in entries:
                    try:info=entry.stat(follow_symlinks=False)
                    except FileNotFoundError:continue
                    if stat.S_ISDIR(info.st_mode):pending.append(Path(entry.path))
                    elif stat.S_ISREG(info.st_mode):total+=info.st_size
                    # Do not traverse symlinks outside the artifact tree.
        except FileNotFoundError:
            if directory==root:raise
    # Losing the root during traversal is not an empty archive.
    if not stat.S_ISDIR(root.stat().st_mode):raise NotADirectoryError(str(root))
    return total

def read_device_memory(path, runner_pid, now=None):
    try:
        gpu=json.loads(Path(path).read_text());value=gpu['driverBytes']
        # A runner may publish while CPU/pressure telemetry is being collected.
        # Compare with time after this read, not the start of the whole sample.
        now=time.time() if now is None else now
        if (gpu.get('schema')==1 and gpu.get('pid')==runner_pid
            and isinstance(value,int) and value>=0 and 0<=now-gpu['observedAt']<=30):
            return value,True
    except (OSError,ValueError,KeyError,TypeError):pass
    return 0,False

class Telemetry:
    def __init__(self, artifacts, activity_file, device_memory_file=None, runner_pid=None):
        self.artifacts=Path(artifacts);self.activity_file=Path(activity_file)
        self.process=psutil.Process();self.processes={}
        self.device_memory_file=Path(device_memory_file) if device_memory_file else None
        self.runner_pid=runner_pid
        self.memory_reader=None
        psutil.cpu_percent()

    def sample(self):
        try:
            return self._sample()
        except (OSError, psutil.Error, subprocess.SubprocessError) as error:
            raise RuntimeError(f'Resource telemetry unavailable: {type(error).__name__}: {error}') from error

    def _sample(self):
        now=time.time();observed=None;active=None;ramp=False
        try:
            data=json.loads(self.activity_file.read_text())
            if data.get('schema')==1 and isinstance(data.get('developmentActive'),bool):
                observed=float(data['observedAt']);active=data['developmentActive']
                ramp=data.get('rampAuthorized') is True
        except (OSError,ValueError,KeyError,TypeError):pass
        owned_cpu=0.;rss=0
        live=[self.process]+self.process.children(recursive=True)
        for proc in live:
            try:
                cached=self.processes.setdefault(proc.pid,proc)
                owned_cpu+=cached.cpu_percent();rss+=cached.memory_info().rss
            except (psutil.NoSuchProcess,psutil.AccessDenied):pass
        pids={p.pid for p in live};self.processes={pid:p for pid,p in self.processes.items() if pid in pids}
        pressure='unknown'
        try:
            result=subprocess.run(['/usr/sbin/sysctl','-n','kern.memorystatus_vm_pressure_level'],capture_output=True,text=True,timeout=2,check=True)
            pressure={'1':'normal','2':'warning','4':'critical'}.get(result.stdout.strip(),'unknown')
        except (OSError,subprocess.SubprocessError):pass
        memory_diagnostics=None;available=psutil.virtual_memory().available;container_swap=None
        if sys.platform.startswith('linux') and os.environ.get('RIGHELT_HOSTED_MEMORY_SCOPE'):
            from .linux_memory import MemoryReader,SCOPE
            if os.environ['RIGHELT_HOSTED_MEMORY_SCOPE']!=SCOPE:raise RuntimeError('unknown workload memory scope')
            if self.memory_reader is None:self.memory_reader=MemoryReader()
            try:memory_diagnostics=self.memory_reader.sample(available)
            except (OSError,ValueError,KeyError,IndexError) as error:
                from .checkpoint import atomic_json
                directory=self.device_memory_file.parent if self.device_memory_file else self.artifacts
                atomic_json(directory/'memory-telemetry-failure.json',{'schema':1,'reason':str(error),
                    'observedAt':time.time(),'diagnostics':self.memory_reader.diagnostics})
                raise RuntimeError('workload memory telemetry unavailable: '+str(error)) from error
            pressure=memory_diagnostics['workloadPressure'];available=memory_diagnostics['effectiveAvailable']
            container_swap=memory_diagnostics['swapCurrent']
            memory_diagnostics.update(ownedCpuPercent=owned_cpu,ownedRssBytes=rss,ownedDeviceBytes=0)
        elif sys.platform.startswith('linux'):
            # Available memory and swap-growth remain enforced by ResourcePolicy.
            # Linux has no Darwin pressure sysctl. PSI is an additional signal.
            try:
                fields=Path('/proc/pressure/memory').read_text().splitlines()[0].split()
                avg=float(dict(field.split('=') for field in fields[1:])['avg10'])
                if not math.isfinite(avg) or avg<0:raise ValueError('invalid Linux memory pressure')
                pressure='critical' if avg>=10 else 'warning' if avg>=1 else 'normal'
            except (OSError,ValueError,KeyError,IndexError):
                pressure='unknown'
        # GPU allocation is process-local; read the runner's own measurement.
        # RSS may overlap these bytes, so this sum is intentionally conservative.
        device_known=self.device_memory_file is None
        if self.device_memory_file:
            amount,device_known=read_device_memory(self.device_memory_file,self.runner_pid)
            rss+=amount
            if memory_diagnostics is not None:memory_diagnostics['ownedDeviceBytes']=amount
        size=artifact_bytes(self.artifacts)
        if memory_diagnostics is not None:memory_diagnostics['deviceMemoryKnown']=device_known
        # Track allocated swap growth across runner restarts. On Darwin psutil's
        # sout can reflect general page-outs, so it is not a swap-growth signal.
        # Stable historical usage is not pressure; unavailable usage fails closed.
        try:
            swap_used=psutil.swap_memory().used
            if container_swap is not None:swap_used=max(swap_used,container_swap)
        except (OSError,psutil.Error):
            swap_used=None
        return Sample(now,observed,active,max(0,psutil.cpu_percent()*psutil.cpu_count()-owned_cpu),pressure,rss,
                      available,psutil.disk_usage(self.artifacts).free,size,device_known,
                      swap_used,ramp,memory_diagnostics)
