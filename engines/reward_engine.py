import numpy as np

class RewardEngine:
    def __init__(self):
        self.returns = []
        self.balance = 1000
        self.peak = 1000

    def update(self, pnl):
        self.balance += pnl
        self.returns.append(pnl)
        if self.balance > self.peak:
            self.peak = self.balance

    def compute(self, weight=0.0):
        r = np.array(self.returns[-50:])
        if len(r) < 5:
            return 0
        mean = r.mean()
        std = r.std() + 1e-6
        sharpe = mean / std
        dd = (self.peak - self.balance) / self.peak
        reward = sharpe - dd * 1.2
        if weight > 0.05:
            reward += 0.01
        return reward
