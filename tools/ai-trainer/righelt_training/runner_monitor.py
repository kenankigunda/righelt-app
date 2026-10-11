"""Independent heartbeat plus explicit bounded-operation watchdog evidence."""
from contextlib import contextmanager
import os
from pathlib import Path
import threading
import time
import torch
from .checkpoint import atomic_json

class RunnerMonitor:
    def __init__(self,directory,*,interval=3,clock=time.monotonic,query=None,expire=None):
        self.directory=Path(directory);self.interval=interval;self.clock=clock
        self.query=query or (lambda:torch.mps.driver_allocated_memory() if torch.backends.mps.is_available() else 0)
        self.expire=expire or (lambda:os._exit(70))
        self.lock=threading.RLock();self.stop=threading.Event();self.error=None;self.active=None
    def publish(self):
        with self.lock:
            atomic_json(self.directory/'device-memory.json',{'schema':1,'pid':os.getpid(),'observedAt':time.time(),'driverBytes':self.query()})
            if self.active and self.clock()>=self.active['deadlineMonotonic']:
                atomic_json(self.directory/'operation-status.json',{**self.active,'status':'timed-out','observedAt':time.time()})
                self.expire()
    def check(self):
        if self.error:raise RuntimeError('independent runner telemetry failed') from self.error
    def _loop(self):
        while not self.stop.wait(self.interval):
            try:self.publish()
            except BaseException as error:
                self.error=error
                try:atomic_json(self.directory/'operation-status.json',{'schema':1,'pid':os.getpid(),'observedAt':time.time(),
                    'status':'monitor-failed','deadlineMonotonic':self.clock(),'error':str(error)})
                finally:self.expire()
                return
    def __enter__(self):
        # Publish a watchdog bound before even the first GPU allocator query.
        atomic_json(self.directory/'operation-status.json',{'schema':1,'pid':os.getpid(),'name':'monitor-initialization',
            'status':'running','observedAt':time.time(),'deadlineMonotonic':self.clock()+60})
        self.publish()
        atomic_json(self.directory/'operation-status.json',{'schema':1,'pid':os.getpid(),'status':'idle',
            'observedAt':time.time(),'deadlineMonotonic':None})
        self.thread=threading.Thread(target=self._loop,daemon=True);self.thread.start();return self
    def __exit__(self,*_):
        self.stop.set();self.thread.join(timeout=1);self.check()
    @contextmanager
    def operation(self,name,seconds):
        self.check()
        with self.lock:
            previous=self.active
            deadline=self.clock()+seconds
            if previous:deadline=min(deadline,previous['deadlineMonotonic'])
            self.active={'schema':1,'pid':os.getpid(),'name':name,'status':'running',
                         'observedAt':time.time(),'deadlineMonotonic':deadline}
            atomic_json(self.directory/'operation-status.json',self.active)
        try:yield
        finally:
            with self.lock:
                expired=self.clock()>=self.active['deadlineMonotonic']
                ended={**self.active,'status':'timed-out','observedAt':time.time()}
                self.active=previous
                atomic_json(self.directory/'operation-status.json',ended if expired else previous or {'schema':1,'pid':os.getpid(),
                    'status':'idle','observedAt':time.time(),'deadlineMonotonic':None})
            if expired:raise TimeoutError('runner operation exceeded watchdog deadline')
            self.check()
