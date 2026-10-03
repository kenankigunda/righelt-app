"""Read-only telemetry. Missing activity observations never imply idle threads."""
import json
import os
from pathlib import Path
import subprocess
import time
import psutil
from .resources import Sample

class Telemetry:
    def __init__(self, artifacts, activity_file):
        self.artifacts=Path(artifacts);self.activity_file=Path(activity_file)
        self.process=psutil.Process();self.processes={}
        psutil.cpu_percent()

    def sample(self):
        now=time.time();observed=None;active=None
        try:
            data=json.loads(self.activity_file.read_text())
            if data.get('schema')==1 and isinstance(data.get('developmentActive'),bool):
                observed=float(data['observedAt']);active=data['developmentActive']
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
        # GPU driver memory is not fully represented in RSS. Count it conservatively.
        try:
            import torch
            if torch.backends.mps.is_available():rss+=torch.mps.driver_allocated_memory()
        except (ImportError,RuntimeError):pass
        size=sum(p.stat().st_size for p in self.artifacts.rglob('*') if p.is_file())
        return Sample(now,observed,active,max(0,psutil.cpu_percent()*psutil.cpu_count()-owned_cpu),pressure,rss,
                      psutil.virtual_memory().available,psutil.disk_usage(self.artifacts).free,size)
