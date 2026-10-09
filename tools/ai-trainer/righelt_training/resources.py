"""Pure resource policy. Task observations and load must both permit escalation."""
from dataclasses import dataclass, asdict
import math
from .resource_policy import LIMITS
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
    swap_used_bytes: int | None = 0

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
        self.memory_held = False
        self.recovery_since = None
        self.last_sample = None
        self.last_swap_used = None

    def decide(self, sample: Sample) -> Allocation:
        nums = [sample.now, sample.external_cpu_percent, sample.experiment_bytes,
                sample.available_bytes, sample.disk_free_bytes, sample.artifact_bytes]
        if any(not math.isfinite(n) or n < 0 for n in nums):
            return Allocation(0, LIMITS['minMemoryGiB'], True, True, 'invalid-telemetry')
        if sample.artifact_bytes >= LIMITS['artifactGiB'] * GIB:
            return Allocation(0, LIMITS['minMemoryGiB'], True, True, 'artifact-cap')
        if sample.disk_free_bytes < LIMITS['freeDiskFloorGiB'] * GIB:
            return Allocation(0, LIMITS['minMemoryGiB'], True, True, 'disk-reserve')
        # A gap or clock jump does not establish sustained healthy observations.
        if self.last_sample is not None and not 0 <= sample.now - self.last_sample <= 2 * LIMITS['sampleSeconds']:
            self.quiet_since = self.recovery_since = None
        self.last_sample = sample.now
        swap_known = (isinstance(sample.swap_used_bytes, int) and not isinstance(sample.swap_used_bytes, bool)
                      and sample.swap_used_bytes >= 0)
        swap_growth = swap_known and self.last_swap_used is not None and sample.swap_used_bytes > self.last_swap_used
        self.last_swap_used = sample.swap_used_bytes if swap_known else None
        fresh = (sample.activity_observed_at is not None
                 and math.isfinite(sample.activity_observed_at)
                 and 0 <= sample.now - sample.activity_observed_at <= LIMITS['activityFreshSeconds'])
        dev_busy = not fresh or sample.development_active is not False
        pressured = (sample.memory_pressure != 'normal' or sample.available_bytes < LIMITS['pauseAvailableGiB'] * GIB
                     or not swap_known or swap_growth)
        busy = dev_busy or sample.external_cpu_percent >= LIMITS['externalCpuBusyPercent']
        headroom = sample.available_bytes >= LIMITS['resumeAvailableGiB'] * GIB
        # Check the already-granted ceiling before escalation: an over-limit
        # runner cannot escape pressure by qualifying for a larger allocation.
        ceiling = (LIMITS['maxMemoryGiB'] if self.workers > LIMITS['minWorkers']
                   and not busy and not pressured and headroom else LIMITS['minMemoryGiB'])
        if pressured or sample.experiment_bytes > ceiling * GIB:
            self.workers = LIMITS['minWorkers']
            self.quiet_since = None
            self.memory_held = True
            self.recovery_since = None
            return Allocation(0, ceiling, True, False, 'swap-growth' if swap_growth else 'memory-pressure')
        if self.memory_held:
            if not headroom or not sample.device_memory_known:
                self.recovery_since = None
            elif self.recovery_since is None:
                self.recovery_since = sample.now
            if self.recovery_since is None or sample.now - self.recovery_since < LIMITS['recoverySeconds']:
                return Allocation(0, LIMITS['minMemoryGiB'], True, False, 'memory-recovery')
            self.memory_held = False
            self.recovery_since = self.quiet_since = None
        if not sample.device_memory_known:
            # Expected before the new runner publishes its first heartbeat. It
            # pauses compute, but is not evidence of actual memory pressure.
            self.workers=LIMITS['minWorkers'];self.quiet_since=None
            return Allocation(0,LIMITS['minMemoryGiB'],True,False,'device-memory-unknown')
        if busy:
            self.workers = LIMITS['minWorkers']
            self.quiet_since = None
            reason = 'development-active' if fresh and sample.development_active else 'activity-unknown' if dev_busy else 'external-load'
            return Allocation(self.workers, ceiling, False, False, reason)
        if not headroom:
            self.workers = LIMITS['minWorkers']
            self.quiet_since = None
            return Allocation(self.workers, ceiling, False, False, 'headroom-conservative')
        if sample.external_cpu_percent > LIMITS['externalCpuQuietPercent']:
            self.quiet_since = None
            return Allocation(self.workers, ceiling, False, False, 'waiting-for-quiet')
        if self.quiet_since is None:
            self.quiet_since = sample.now
        if sample.now - self.quiet_since >= LIMITS['quietSeconds'] and (self.last_ramp is None or sample.now - self.last_ramp >= LIMITS['rampSeconds']):
            self.workers = min(LIMITS['maxWorkers'], self.workers + 1)
            self.last_ramp = sample.now
            ceiling = LIMITS['maxMemoryGiB']
        return Allocation(self.workers, ceiling, False, False, 'quiet-ramp')
