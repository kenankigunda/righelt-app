import os
import sys
import unittest
import subprocess
import time
import psutil
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from righelt_training.processes import start_group,stop_group,register_owned,cleanup_owned
from righelt_training.allocation import append

class ProcessTest(unittest.TestCase):
    def denied_candidate(self, directory, statuses, running=True, group=40001):
        append(Path(directory)/'process-ownership.jsonl',{'pid':40001,'created':100,
            'group':40001,'owner':os.getpid(),'groupToken':'owned-test-token'})
        process=Mock(pid=40002)
        process.create_time.return_value=101
        process.uids.return_value=SimpleNamespace(real=os.getuid())
        process.is_running.return_value=running
        process.status.side_effect=statuses
        process.environ.side_effect=psutil.AccessDenied(process.pid)
        return process,group

    def test_cleanup_does_not_read_environment_of_observed_zombie(self):
        with tempfile.TemporaryDirectory() as directory:
            process,group=self.denied_candidate(directory,[psutil.STATUS_ZOMBIE])
            with patch('righelt_training.allocation.alive',return_value=False),patch('psutil.process_iter',return_value=[process]),patch('os.getpgid',return_value=group):
                cleanup_owned(directory)
            process.environ.assert_not_called();process.kill.assert_not_called()

    def test_cleanup_rechecks_exit_after_environment_permission_race(self):
        with tempfile.TemporaryDirectory() as directory:
            process,group=self.denied_candidate(directory,[psutil.STATUS_RUNNING,psutil.STATUS_ZOMBIE])
            with patch('righelt_training.allocation.alive',return_value=False),patch('psutil.process_iter',return_value=[process]),patch('os.getpgid',return_value=group):
                cleanup_owned(directory)
            process.environ.assert_called_once();process.kill.assert_not_called()

    def test_cleanup_permission_denial_never_proves_live_or_unknown_owned_exit(self):
        for state in (psutil.STATUS_RUNNING,psutil.STATUS_STOPPED,psutil.AccessDenied(40002)):
            with self.subTest(state=state),tempfile.TemporaryDirectory() as directory:
                process,group=self.denied_candidate(directory,[state,state])
                with patch('righelt_training.allocation.alive',return_value=False),patch('psutil.process_iter',return_value=[process]),patch('os.getpgid',return_value=group):
                    with self.assertRaises(psutil.AccessDenied):cleanup_owned(directory)
                process.kill.assert_not_called()

    def test_cleanup_does_not_signal_unrelated_protected_process(self):
        with tempfile.TemporaryDirectory() as directory:
            process,group=self.denied_candidate(directory,[psutil.STATUS_RUNNING,psutil.STATUS_RUNNING],group=50001)
            with patch('righelt_training.allocation.alive',return_value=False),patch('psutil.process_iter',return_value=[process]),patch('os.getpgid',return_value=group):
                cleanup_owned(directory)
            process.kill.assert_not_called()

    def test_reaped_leader_zombie_in_token_discovery_needs_no_environment(self):
        # Sibling processes in one group let this test retain an unreaped zombie
        # after the registered leader exits. Neither is our ancestry witness.
        with tempfile.TemporaryDirectory() as directory:
            token='zombie-discovery-fixture'
            env={**os.environ,'RIGHELT_COMPUTE_GROUP_TOKEN':token}
            leader=subprocess.Popen([sys.executable,'-c','import sys;sys.stdin.read()'],
                stdin=subprocess.PIPE,process_group=0,env=env)
            leader._righelt_group_token=token
            child=None
            try:
                register_owned(directory,leader)
                child=subprocess.Popen([sys.executable,'-c','import sys;sys.stdin.read()'],
                    stdin=subprocess.PIPE,process_group=leader.pid,env=env)
                zombie=psutil.Process(child.pid)
                leader.stdin.close();leader.wait(timeout=3)
                self.assertFalse(psutil.pid_exists(leader.pid))
                group=os.getpgid(child.pid)
                self.assertEqual(group,leader.pid)
                child.stdin.close()
                until=time.monotonic()+3
                while zombie.status()!=psutil.STATUS_ZOMBIE:
                    if time.monotonic()>=until:self.fail('fixture did not become a zombie')
                    time.sleep(.01)
                # macOS getpgid may report ESRCH for a zombie. Inject the last
                # witnessed group and a denied environment read. The zombie
                # state and absent group leader are real on the current host.
                with patch('psutil.process_iter',return_value=[zombie]),patch('os.getpgid',return_value=group),patch.object(zombie,'environ',side_effect=psutil.AccessDenied(child.pid)) as environment:
                    cleanup_owned(directory)
                environment.assert_not_called()
            finally:
                for process in (child,leader):
                    if process is not None:
                        if process.stdin and not process.stdin.closed:process.stdin.close()
                        if process.poll() is None:process.kill()
                        process.wait(timeout=3)

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




    def test_hard_killed_leader_detached_child_is_owned_by_inherited_token(self):
        with tempfile.TemporaryDirectory() as directory:
            code="import subprocess,sys; p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],start_new_session=True,stdout=subprocess.DEVNULL);print(p.pid,flush=True);sys.stdin.readline()"
            leader=start_group([sys.executable,'-c',code],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
            unrelated=start_group([sys.executable,'-c','import time;time.sleep(60)'])
            child=None
            try:
                child=psutil.Process(int(leader.stdout.readline()))
                self.assertNotEqual(os.getpgid(child.pid),os.getpgid(leader.pid))
                register_owned(directory,leader)
                stop_group(leader)
                self.assertTrue(child.is_running())
                cleanup_owned(directory)
                self.assertTrue(not child.is_running() or child.status()==psutil.STATUS_ZOMBIE)
                self.assertIsNone(unrelated.poll())
            finally:
                if leader.poll() is None:stop_group(leader)
                stop_group(unrelated)
                if child is not None:
                    try:child.kill()
                    except psutil.NoSuchProcess:pass
                leader.stdin.close();leader.stdout.close()

    def test_live_legacy_identity_keeps_group_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            leader=start_group([sys.executable,'-c','import time;time.sleep(60)'])
            try:
                append(Path(directory)/'process-ownership.jsonl',{'pid':leader.pid,'created':psutil.Process(leader.pid).create_time(),
                    'group':leader.pid+1,'owner':os.getpid(),'groupToken':None})
                with self.assertRaisesRegex(RuntimeError,'group changed'):cleanup_owned(directory)
                self.assertIsNone(leader.poll())
            finally:stop_group(leader)



    def test_token_does_not_authorize_process_older_than_recorded_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            process=start_group([sys.executable,'-c','import time;time.sleep(60)'])
            try:
                birth=psutil.Process(process.pid).create_time()
                append(Path(directory)/'process-ownership.jsonl',{'pid':process.pid,'created':birth+60,
                    'group':process.pid,'owner':os.getpid(),'groupToken':process._righelt_group_token})
                cleanup_owned(directory)
                self.assertIsNone(process.poll())
            finally:stop_group(process)

    def test_detached_token_cleanup_respects_owner_filter(self):
        with tempfile.TemporaryDirectory() as directory:
            leaders=[];children=[]
            code="import subprocess,sys; p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],start_new_session=True,stdout=subprocess.DEVNULL);print(p.pid,flush=True);sys.stdin.readline()"
            try:
                for owner in (101,202):
                    leader=start_group([sys.executable,'-c',code],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
                    leaders.append(leader);children.append(psutil.Process(int(leader.stdout.readline())))
                    append(Path(directory)/'process-ownership.jsonl',{'pid':leader.pid,'created':psutil.Process(leader.pid).create_time(),
                        'group':leader.pid,'owner':owner,'groupToken':leader._righelt_group_token})
                    stop_group(leader)
                cleanup_owned(directory,owner=101)
                self.assertTrue(not children[0].is_running() or children[0].status()==psutil.STATUS_ZOMBIE)
                self.assertTrue(children[1].is_running());self.assertNotEqual(children[1].status(),psutil.STATUS_ZOMBIE)
                cleanup_owned(directory,owner=202)
                self.assertTrue(not children[1].is_running() or children[1].status()==psutil.STATUS_ZOMBIE)
            finally:
                for leader in leaders:
                    if leader.poll() is None:stop_group(leader)
                    leader.stdin.close();leader.stdout.close()
                for child in children:
                    try:child.kill()
                    except psutil.NoSuchProcess:pass

if __name__=='__main__':unittest.main()
