"""Elapsed compute budget, including throttled and paused time after launch."""
from dataclasses import dataclass
import math

@dataclass(frozen=True)
class Budget:
    started: float
    seconds: float

    def __post_init__(self):
        if not math.isfinite(self.started) or not math.isfinite(self.seconds) or self.seconds <= 0:
            raise ValueError('invalid budget')

    def remaining(self, now: float) -> float:
        if not math.isfinite(now) or now < self.started:
            raise ValueError('invalid clock')
        return max(0.0, self.seconds - (now - self.started))

    def may_start(self, now: float, bound_seconds: float, checkpoint_seconds: float = 10) -> bool:
        if not math.isfinite(bound_seconds) or bound_seconds <= 0 or checkpoint_seconds < 0:
            raise ValueError('invalid batch bound')
        return self.remaining(now) >= bound_seconds + checkpoint_seconds
