"""Pure resource policy. Task observations and load must both permit escalation."""
from dataclasses import dataclass, asdict
import math
from .config import CONFIG

LIMITS = CONFIG['resources']
GIB = 1024 ** 3

@dataclass(frozen=True)
class Sample:
    now: float
    activity_observed_at: float | None
    development_active: bool | None
    external_cpu_percent: float
    memory_pressure: str
    experiment_bytes: int
    available_bytes: int
    disk_free_bytes: int
    artifact_bytes: int
    device_memory_known: bool = True

@dataclass(frozen=True)
class Allocation:
    workers: int
    memory_gib: int
    paused: bool
    stop: bool
    reason: str

    def record(self):
        return asdict(self)

class AdaptivePolicy:
    def __init__(self):
        self.workers = LIMITS['minWorkers']
        self.quiet_since = None
        self.last_ramp = None

    def decide(self, sample: Sample) -> Allocation:
        nums = [sample.now, sample.external_cpu_percent, sample.experiment_bytes,
                sample.available_bytes, sample.disk_free_bytes, sample.artifact_bytes]
        if any(not math.isfinite(n) or n < 0 for n in nums):
            return Allocation(0, LIMITS['minMemoryGiB'], True, True, 'invalid-telemetry')
        if sample.artifact_bytes >= LIMITS['artifactGiB'] * GIB:
            return Allocation(0, LIMITS['minMemoryGiB'], True, True, 'artifact-cap')
        if sample.disk_free_bytes < LIMITS['freeDiskFloorGiB'] * GIB:
            return Allocation(0, LIMITS['minMemoryGiB'], True, True, 'disk-reserve')
        if not sample.device_memory_known:
            self.workers=LIMITS['minWorkers'];self.quiet_since=None
            return Allocation(0,LIMITS['minMemoryGiB'],True,False,'device-memory-unknown')
        fresh = (sample.activity_observed_at is not None
                 and math.isfinite(sample.activity_observed_at)
                 and 0 <= sample.now - sample.activity_observed_at <= LIMITS['activityFreshSeconds'])
        dev_busy = not fresh or sample.development_active is not False
        pressured = sample.memory_pressure != 'normal' or sample.available_bytes < 4 * GIB
        busy = dev_busy or sample.external_cpu_percent >= LIMITS['externalCpuBusyPercent']
        ceiling = LIMITS['minMemoryGiB'] if busy or pressured else LIMITS['maxMemoryGiB']
        if pressured or sample.experiment_bytes > ceiling * GIB:
            self.workers = LIMITS['minWorkers']
            self.quiet_since = None
            return Allocation(0, ceiling, True, False, 'memory-pressure')
        if busy:
            self.workers = LIMITS['minWorkers']
            self.quiet_since = None
            reason = 'development-active' if fresh and sample.development_active else 'activity-unknown' if dev_busy else 'external-load'
            return Allocation(self.workers, ceiling, False, False, reason)
        if sample.external_cpu_percent > LIMITS['externalCpuQuietPercent']:
            self.quiet_since = None
            return Allocation(self.workers, ceiling, False, False, 'waiting-for-quiet')
        if self.quiet_since is None:
            self.quiet_since = sample.now
        if sample.now - self.quiet_since >= LIMITS['quietSeconds'] and (self.last_ramp is None or sample.now - self.last_ramp >= LIMITS['rampSeconds']):
            self.workers = min(LIMITS['maxWorkers'], self.workers + 1)
            self.last_ramp = sample.now
        return Allocation(self.workers, ceiling, False, False, 'quiet-ramp')
