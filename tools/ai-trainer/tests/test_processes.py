import os
import sys
import unittest
from righelt_training.processes import start_group,stop_group

class ProcessTest(unittest.TestCase):
    def test_busy_child_is_actually_killed(self):
        p=start_group([sys.executable,'-c','while True: pass'])
        stop_group(p)
        self.assertIsNotNone(p.returncode)
        with self.assertRaises(ProcessLookupError):os.kill(p.pid,0)
        stop_group(p)

if __name__=='__main__':unittest.main()
