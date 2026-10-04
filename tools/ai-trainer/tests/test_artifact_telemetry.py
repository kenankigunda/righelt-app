import errno
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from righelt_training.telemetry import Telemetry, artifact_bytes


class ArtifactTelemetryTest(unittest.TestCase):
    def telemetry(self, root):
        telemetry=object.__new__(Telemetry)
        telemetry.artifacts=root;telemetry.activity_file=root/'missing-activity'
        telemetry.process=Mock(pid=123)
        telemetry.process.children.return_value=[]
        telemetry.process.cpu_percent.return_value=0
        telemetry.process.memory_info.return_value=SimpleNamespace(rss=0)
        telemetry.processes={};telemetry.device_memory_file=None
        return telemetry

    def test_nested_files_and_live_checkpoint_temporary_files_are_counted(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'checkpoints').mkdir()
            (root/'checkpoints/model.pt').write_bytes(b'a'*19)
            (root/'checkpoints/model.pt.unique.tmp').write_bytes(b'b'*31)
            (root/'heartbeat.json.tmp').write_bytes(b'c'*7)
            self.assertEqual(artifact_bytes(root),57)

    def test_entry_disappearing_after_enumeration_does_not_abort_scan(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'stable').write_bytes(b'123')
            real_scandir=os.scandir
            vanished=Mock();vanished.stat.side_effect=FileNotFoundError(2,'renamed','heartbeat.tmp')
            def scan(path):
                with real_scandir(path) as entries:rows=list(entries)
                context=Mock();context.__enter__=Mock(return_value=iter([vanished,*rows]))
                context.__exit__=Mock(return_value=False)
                return context
            with patch('righelt_training.telemetry.os.scandir',side_effect=scan):
                self.assertEqual(artifact_bytes(root),3)
            vanished.stat.assert_called_once_with(follow_symlinks=False)

    def test_atomic_replacement_between_enumeration_and_stat(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);target=root/'heartbeat.json';temporary=root/'heartbeat.json.tmp'
            target.write_bytes(b'old');temporary.write_bytes(b'newer')
            with os.scandir(root) as entries:rows=list(entries)
            os.replace(temporary,target)
            context=Mock();context.__enter__=Mock(return_value=iter(rows));context.__exit__=Mock(return_value=False)
            with patch('righelt_training.telemetry.os.scandir',return_value=context):
                self.assertEqual(artifact_bytes(root),5)

    def test_missing_root_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(FileNotFoundError):artifact_bytes(Path(d)/'missing')

    def test_root_disappearing_during_scan_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)/'archive';root.mkdir()
            def scan(path):
                root.rmdir()
                raise FileNotFoundError(2,'missing',str(path))
            with patch('righelt_training.telemetry.os.scandir',side_effect=scan):
                with self.assertRaises(FileNotFoundError):artifact_bytes(root)

    def test_vanished_descendant_directory_is_harmless(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);child=root/'transient';child.mkdir()
            real_scandir=os.scandir
            def scan(path):
                if Path(path)==child:
                    child.rmdir()
                return real_scandir(path)
            with patch('righelt_training.telemetry.os.scandir',side_effect=scan):
                self.assertEqual(artifact_bytes(root),0)

    def test_entry_permission_and_io_errors_propagate(self):
        with tempfile.TemporaryDirectory() as d:
            for error in (PermissionError(errno.EACCES,'denied','checkpoint'),OSError(errno.EIO,'I/O error','checkpoint')):
                with self.subTest(error=error):
                    entry=Mock();entry.stat.side_effect=error
                    context=Mock();context.__enter__=Mock(return_value=iter([entry]));context.__exit__=Mock(return_value=False)
                    with patch('righelt_training.telemetry.os.scandir',return_value=context):
                        with self.assertRaises(type(error)):artifact_bytes(Path(d))

    def test_descendant_traversal_error_propagates(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);child=root/'restricted';child.mkdir();real_scandir=os.scandir
            def scan(path):
                if Path(path)==child:raise PermissionError(errno.EACCES,'denied',str(path))
                return real_scandir(path)
            with patch('righelt_training.telemetry.os.scandir',side_effect=scan):
                with self.assertRaises(PermissionError):artifact_bytes(root)

    def test_symlink_directory_cannot_escape_or_cycle(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'stable').write_bytes(b'123');(root/'cycle').symlink_to(root,target_is_directory=True)
            self.assertEqual(artifact_bytes(root),3)

    def test_sample_failure_preserves_error_path_and_cause(self):
        with tempfile.TemporaryDirectory() as d:
            error=OSError(errno.EIO,'I/O error','specific-checkpoint.pt')
            telemetry=self.telemetry(Path(d))
            with patch('righelt_training.telemetry.artifact_bytes',side_effect=error),patch('righelt_training.telemetry.subprocess.run',return_value=SimpleNamespace(stdout='1')):
                with self.assertRaisesRegex(RuntimeError,'specific-checkpoint.pt') as result:telemetry.sample()
            self.assertIs(result.exception.__cause__,error)

    def test_supervisor_continues_after_atomic_rename_and_stops_on_io_failure(self):
        from righelt_training.supervisor import supervise
        from righelt_training.budget import Budget
        from righelt_training.resources import AdaptivePolicy
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);target=root/'heartbeat.json';temporary=root/'heartbeat.json.tmp'
            target.write_bytes(b'old');temporary.write_bytes(b'new')
            with os.scandir(root) as entries:rows=list(entries)
            os.replace(temporary,target)
            context=Mock();context.__enter__=Mock(return_value=iter(rows));context.__exit__=Mock(return_value=False)
            process=Mock(pid=456,returncode=0);process.poll.side_effect=[None,0]
            telemetry=self.telemetry(root)
            with patch('righelt_training.telemetry.os.scandir',return_value=context),patch('righelt_training.telemetry.subprocess.run',return_value=SimpleNamespace(stdout='1')),patch('righelt_training.telemetry.psutil.cpu_percent',return_value=0),patch('righelt_training.telemetry.psutil.virtual_memory',return_value=SimpleNamespace(available=32*1024**3)),patch('righelt_training.supervisor.stop_group'):
                result=supervise(process,Budget(0,600),AdaptivePolicy(),telemetry,root,clock=lambda:1,sleep=lambda _:None)
            self.assertEqual(result,'completed')
            process.poll.side_effect=None;process.poll.return_value=None
            with patch.object(telemetry,'_sample',side_effect=OSError(errno.EIO,'I/O error','archive')),patch('righelt_training.supervisor.stop_group') as stop:
                result=supervise(process,Budget(0,600),AdaptivePolicy(),telemetry,root,clock=lambda:1,sleep=lambda _:None)
            self.assertEqual(result,'telemetry-failed');self.assertTrue(stop.called)
            self.assertIn('archive',(root/'resource-events.jsonl').read_text())


if __name__=='__main__':unittest.main()
