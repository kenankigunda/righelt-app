"""Elapsed compute budget, including throttled and paused time after launch."""
from dataclasses import dataclass
import math
import time

@dataclass(frozen=True)
class Budget:
    started: float
    seconds: float
    wall_deadline: float | None = None

    def __post_init__(self):
        if not math.isfinite(self.started) or not math.isfinite(self.seconds) or self.seconds <= 0:
            raise ValueError('invalid budget')
        if self.wall_deadline is not None and not math.isfinite(self.wall_deadline):raise ValueError('invalid wall deadline')

    def remaining(self, now: float) -> float:
        if not math.isfinite(now) or now < self.started:
            raise ValueError('invalid clock')
        remaining=self.seconds - (now - self.started)
        if self.wall_deadline is not None:remaining=min(remaining,self.wall_deadline-time.time())
        return max(0.0,remaining)

    def may_start(self, now: float, bound_seconds: float, checkpoint_seconds: float = 10) -> bool:
        if not math.isfinite(bound_seconds) or bound_seconds <= 0 or checkpoint_seconds < 0:
            raise ValueError('invalid batch bound')
        return self.remaining(now) >= bound_seconds + checkpoint_seconds


def effective_deadline(runtime):
    deadline=runtime['deadlineMonotonic']
    if 'deadlineWall' in runtime:deadline=min(deadline,time.monotonic()+max(0,runtime['deadlineWall']-time.time()))
    return deadline
