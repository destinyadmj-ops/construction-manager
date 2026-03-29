import numpy as np

class PnLTracker:
    def __init__(self):
        self.last_equity = None
    def update(self, equity):
        if self.last_equity is None:
            self.last_equity = equity
            return 0.0
        pnl = equity - self.last_equity
        self.last_equity = equity
        return pnl
    def reward(self, pnl, current_equity):
        # ノイズ除去・スケール安定化
        return np.tanh(pnl / max(1.0, current_equity))
