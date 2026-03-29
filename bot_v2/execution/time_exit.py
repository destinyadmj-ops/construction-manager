from __future__ import annotations

import time


class TimeExit:
    def __init__(self, max_seconds: float = 1800):
        self.max_seconds = max(1.0, float(max_seconds))

    def elapsed_seconds(self, pos) -> float:
        return max(0.0, time.time() - float(getattr(pos, 'timestamp', 0.0) or 0.0))

    def should_exit(self, pos) -> bool:
        return self.elapsed_seconds(pos) >= self.max_seconds