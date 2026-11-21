import json
import os
from pathlib import Path
import tempfile
import unittest
from righelt_training.linux_memory import MemoryReader
from righelt_training.resources import AdaptivePolicy,Sample,GIB


def pressure(avg=0):
    return f'some avg10={avg} avg60=0.00 avg300=0.00 total=100\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n'


class LinuxMemoryTest(unittest.TestCase):
    def fixture(self,root,*,namespace=False,physical_root=False):
        proc=root/'proc';(proc/'self').mkdir(parents=True);(proc/'pressure').mkdir()
        mount=root/'cgroup';leaf=mount if namespace else mount/'leaf';leaf.mkdir(parents=True)
        group='/' if namespace else '/tenant/leaf' if not physical_root else '/leaf'
        mount_root='/tenant' if not physical_root else '/'
        (proc/'self/cgroup').write_text('0::'+group+'\n')
        (proc/'self/mountinfo').write_text(f'1 0 0:1 {mount_root} {mount} rw - cgroup2 cgroup rw\n')
        (proc/'pressure/memory').write_text(pressure(2))
        def level(path,used=GIB,maximum='max',high='max',avg=0):
            path.mkdir(exist_ok=True)
            values={'memory.current':str(used),'memory.max':str(maximum),'memory.high':str(high),
                    'memory.pressure':pressure(avg),'memory.swap.current':'0',
                    'memory.events':'low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\n','cgroup.procs':str(os.getpid()) if path==leaf else ''}
            for name,value in values.items():(path/name).write_text(value)
        level(leaf,8*GIB,32*GIB)
        if not namespace and not physical_root:level(mount,20*GIB,avg=50)
        return MemoryReader(proc),proc,mount,leaf,level

    def test_shared_host_warning_and_unlimited_ancestor_are_diagnostic_not_workload_pressure(self):
        with tempfile.TemporaryDirectory() as d:
            reader,proc,mount,leaf,_=self.fixture(Path(d));sample=reader.sample(423*GIB)
            self.assertEqual(sample['workloadPressure'],'normal');self.assertEqual(sample['effectiveAvailable'],24*GIB)
            self.assertEqual(sample['hostPressure']['some']['avg10'],2)
            self.assertFalse(sample['levels'][1]['limitingWorkloadBoundary'])
            (mount/'memory.events').write_text('low 0\nhigh 10\nmax 10\noom 1\noom_kill 1\n')
            self.assertEqual(reader.sample(423*GIB)['workloadPressure'],'normal')
            policy=AdaptivePolicy();result=policy.decide(Sample(0,None,None,0,'normal',int(8.42*1e9),sample['effectiveAvailable'],85*GIB,0))
            self.assertFalse(result.paused);self.assertFalse(result.stop);self.assertEqual(result.memory_gib,16)

    def test_limiting_ancestor_uses_its_own_usage_and_physical_headroom(self):
        with tempfile.TemporaryDirectory() as d:
            reader,_,mount,leaf,level=self.fixture(Path(d));level(leaf,100,maximum='max');level(mount,900,maximum=1000)
            self.assertEqual(reader.sample(5000)['effectiveAvailable'],100)
            self.assertEqual(reader.sample(50)['effectiveAvailable'],50)
            level(mount,900,maximum='max',high='max');self.assertEqual(reader.sample(5000)['effectiveAvailable'],5000)

    def test_namespace_root_and_physical_root_capabilities_are_distinguished(self):
        for namespace,physical in ((True,False),(False,True)):
            with self.subTest(namespace=namespace),tempfile.TemporaryDirectory() as d:
                reader,_,_,_,_=self.fixture(Path(d),namespace=namespace,physical_root=physical)
                self.assertEqual(reader.sample(423*GIB)['effectiveAvailable'],24*GIB)
        with tempfile.TemporaryDirectory() as d:
            reader,_,mount,_,_=self.fixture(Path(d),namespace=True)
            (mount/'memory.max').unlink()
            with self.assertRaises(FileNotFoundError):reader.sample(423*GIB)

    def test_pressure_and_event_growth_still_block_and_unknown_or_changed_identity_fails(self):
        for change in ('pressure','oom','malformed','contradictory','missing','identity','counter-reset'):
            with self.subTest(change=change),tempfile.TemporaryDirectory() as d:
                reader,_,mount,leaf,_=self.fixture(Path(d));reader.sample(423*GIB)
                if change=='pressure':(leaf/'memory.pressure').write_text(pressure(2))
                if change=='oom':(leaf/'memory.events').write_text('low 0\nhigh 0\nmax 0\noom 1\noom_kill 1\n')
                if change=='malformed':(leaf/'memory.pressure').write_text(pressure('nan'))
                if change=='contradictory':(leaf/'memory.pressure').write_text(pressure().replace('full avg10=0.00','full avg10=0.50'))
                if change=='missing':(leaf/'memory.current').unlink()
                if change=='identity':(leaf/'cgroup.procs').write_text('99999999')
                if change=='counter-reset':
                    (leaf/'memory.events').write_text('low 0\nhigh 1\nmax 0\noom 0\noom_kill 0\n');reader.sample(423*GIB)
                    (leaf/'memory.events').write_text('low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\n')
                if change in ('pressure','oom'):
                    measured=reader.sample(423*GIB)
                    self.assertIn(measured['workloadPressure'],('warning','critical'))
                    allocation=AdaptivePolicy().decide(Sample(0,None,None,0,measured['workloadPressure'],8*GIB,measured['effectiveAvailable'],85*GIB,0))
                    self.assertTrue(allocation.paused)
                else:
                    with self.assertRaises((ValueError,FileNotFoundError)):reader.sample(423*GIB)


if __name__=='__main__':unittest.main()
