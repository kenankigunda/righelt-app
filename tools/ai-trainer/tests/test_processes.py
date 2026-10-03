import os
import sys
import unittest
import subprocess
import time
import psutil
import tempfile
from pathlib import Path
from righelt_training.processes import start_group,stop_group,register_owned,cleanup_owned
from righelt_training.allocation import append

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

    def test_owned_cleanup_reaps_sleeping_child_after_group_leader_reaped(self):
        with tempfile.TemporaryDirectory() as directory:
            code="import subprocess,sys; p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],stdout=subprocess.DEVNULL);print(p.pid,flush=True);sys.stdin.readline()"
            leader=start_group([sys.executable,'-c',code],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
            child=None
            try:
                child=psutil.Process(int(leader.stdout.readline()))
                register_owned(directory,leader)
                leader.stdin.write('exit\n');leader.stdin.flush();leader.wait(timeout=3)
                self.assertFalse(psutil.pid_exists(leader.pid));self.assertTrue(child.is_running())
                cleanup_owned(directory)
                self.assertTrue(not child.is_running() or child.status()==psutil.STATUS_ZOMBIE)
            finally:
                if leader.poll() is None:stop_group(leader)
                if child is not None:
                    try:child.kill()
                    except psutil.NoSuchProcess:pass
                leader.stdin.close();leader.stdout.close()

    def test_reused_group_number_without_token_proof_is_not_killed(self):
        with tempfile.TemporaryDirectory() as directory:
            unrelated=start_group([sys.executable,'-c','import time;time.sleep(60)'])
            try:
                append(Path(directory)/'process-ownership.jsonl',{'pid':unrelated.pid,'created':0,
                    'group':unrelated.pid,'owner':os.getpid(),'groupToken':'different-old-allocation'})
                cleanup_owned(directory)
                self.assertIsNone(unrelated.poll())
            finally:stop_group(unrelated)

if __name__=='__main__':unittest.main()
