"""Disposable process fixtures only; no models, MPS or actual screen workload."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
import psutil

from righelt_training.config import ROOT
from righelt_training.exploration_screen import ComputeProcess
from righelt_training.processes import cleanup_owned, start_group, stop_group


def stopped(pid):
    try: return not psutil.pid_exists(pid) or psutil.Process(pid).status() == psutil.STATUS_ZOMBIE
    except psutil.NoSuchProcess: return True


class ExplorationProcessTests(unittest.TestCase):
    def test_external_deadline_kills_blocked_python_and_its_node_child(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            code = """import json,subprocess,time
p=subprocess.Popen(['node','-e','setInterval(()=>{},1000)'])
print(json.dumps({'type':'ready','node':p.pid}),flush=True)
time.sleep(60)
"""
            process = ComputeProcess(directory, 'unused', directory / 'session', argv=[sys.executable, '-c', code])
            node = None
            try:
                answer = process.receive(5, lambda: None); node = answer['node']
                with self.assertRaises(TimeoutError): process.receive(.1, lambda: None)
            finally: process.stop()
            self.assertTrue(stopped(process.process.pid)); self.assertTrue(stopped(node))

    def test_independent_owner_can_clean_compute_while_coordinator_is_suspended(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp); ready = directory / 'ready.json'
            model_code = """import json,subprocess,time
p=subprocess.Popen(['node','-e','setInterval(()=>{},1000)'])
print(json.dumps({'type':'ready','node':p.pid}),flush=True)
time.sleep(60)
"""
            coordinator_code = """import json,sys,time
from pathlib import Path
from righelt_training.exploration_screen import ComputeProcess
p=ComputeProcess(Path(sys.argv[1]),'unused',Path(sys.argv[1])/'session',argv=[sys.executable,'-c',sys.argv[2]])
r=p.receive(5,lambda:None)
(Path(sys.argv[1])/'ready.json').write_text(json.dumps({'model':p.process.pid,'node':r['node']}))
time.sleep(60)
"""
            coordinator = start_group([sys.executable, '-c', coordinator_code, str(directory), model_code], cwd=ROOT,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            identities = None
            try:
                deadline = time.monotonic() + 8
                while not ready.exists() and time.monotonic() < deadline and coordinator.poll() is None: time.sleep(.05)
                self.assertTrue(ready.exists(), 'fixture coordinator did not publish process identities')
                identities = json.loads(ready.read_text())
                os.kill(coordinator.pid, signal.SIGSTOP)
                cleanup_owned(directory, owner=coordinator.pid)
                self.assertTrue(stopped(identities['model'])); self.assertTrue(stopped(identities['node']))
                self.assertEqual(psutil.Process(coordinator.pid).status(), psutil.STATUS_STOPPED)
            finally:
                stop_group(coordinator); cleanup_owned(directory); coordinator.stderr.close()

    def test_protocol_error_is_not_an_expected_limit(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            process = ComputeProcess(directory, 'unused', directory / 'session', argv=[sys.executable, '-c',
                'print(\'{"type":"error","message":"invalid model output"}\',flush=True)'])
            try:
                with self.assertRaisesRegex(ValueError, 'correctness error'): process.receive(5, lambda: None)
            finally: process.stop()

    def test_full_pipe_to_suspended_reader_is_bounded_before_receive(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            process = ComputeProcess(directory, 'unused', directory / 'session', argv=[sys.executable, '-c',
                'import os,signal,time; print(\'{"type":"ready"}\',flush=True); os.kill(os.getpid(),signal.SIGSTOP); time.sleep(60)'])
            checks = []
            try:
                self.assertEqual(process.receive(5, lambda: None)['type'], 'ready')
                start = time.monotonic()
                with self.assertRaisesRegex(TimeoutError, 'dispatch deadline'):
                    process.send({'padding': 'x' * 1024 * 1024}, .15, lambda: checks.append(True))
                self.assertLess(time.monotonic() - start, 1)
                self.assertTrue(checks)
            finally: process.stop()
            self.assertTrue(stopped(process.process.pid))


if __name__ == '__main__': unittest.main()
