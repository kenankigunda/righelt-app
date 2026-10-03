import os
import sys
import unittest
import subprocess
import time
import psutil
from righelt_training.processes import start_group,stop_group

class ProcessTest(unittest.TestCase):
    def test_busy_child_is_actually_killed(self):
        p=start_group([sys.executable,'-c','while True: pass'])
        stop_group(p)
        self.assertIsNotNone(p.returncode)
        with self.assertRaises(ProcessLookupError):os.kill(p.pid,0)
        stop_group(p)

    def test_exited_parent_does_not_leave_its_busy_descendant(self):
        code="import subprocess,sys; p=subprocess.Popen([sys.executable,'-c','while True: pass'],stdout=subprocess.DEVNULL); print(p.pid,flush=True)"
        p=start_group([sys.executable,'-c',code],stdout=subprocess.PIPE,text=True)
        pid=int(p.stdout.readline());p.wait(timeout=2)
        stop_group(p);p.stdout.close()
        until=time.monotonic()+2
        while time.monotonic()<until:
            try:
                if psutil.Process(pid).status()==psutil.STATUS_ZOMBIE:break
            except psutil.NoSuchProcess:break
            time.sleep(.01)
        else:self.fail('descendant remained alive after parent exited')

if __name__=='__main__':unittest.main()
