import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
import psutil


class CancellationTests(unittest.TestCase):
    def test_stage_termination_reaps_supervisor_and_separate_compute_group(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);pids=root/'pids'
            supervisor=root/'supervisor.py'
            supervisor.write_text('''import sys,time,json
from pathlib import Path
from righelt_training.processes import install_stop_handlers,start_group,stop_group
install_stop_handlers()
p=start_group([sys.executable,'-c','import time; time.sleep(60)'])
Path(sys.argv[1]).write_text(json.dumps([__import__('os').getpid(),p.pid]))
try:
    p.wait()
finally:
    stop_group(p)
''')
            stage=root/'stage.py'
            stage.write_text('''import sys
from righelt_training.processes import install_stop_handlers
from righelt_training.stage import invoke_supervisor
install_stop_handlers()
invoke_supervisor([sys.executable,sys.argv[1],sys.argv[2]])
''')
            process=subprocess.Popen([sys.executable,str(stage),str(supervisor),str(pids)])
            children=[]
            try:
                end=time.monotonic()+5
                while not pids.exists() and time.monotonic()<end:time.sleep(.02)
                self.assertTrue(pids.exists())
                children=__import__('json').loads(pids.read_text())
                process.send_signal(signal.SIGTERM);process.wait(timeout=5)
                self.assertEqual(process.returncode,143)
                for pid in children:self.assertFalse(psutil.pid_exists(pid),f'process {pid} leaked')
            finally:
                if process.poll() is None:process.kill();process.wait()
                for pid in children:
                    try:os.kill(pid,signal.SIGKILL)
                    except ProcessLookupError:pass
