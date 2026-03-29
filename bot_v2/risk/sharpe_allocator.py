import numpy as np

class RegimePortfolio:
    def __init__(self):
        self.data = {
            "trend": {},
            "range": {}
        }

    def add_return(self, regime, strategy, r):
        if strategy not in self.data[regime]:
            self.data[regime][strategy] = []
        self.data[regime][strategy].append(r)
        if len(self.data[regime][strategy]) > 100:
            self.data[regime][strategy].pop(0)

    def get_matrix(self, regime):
        strategies = list(self.data[regime].keys())
        if not strategies:
            return None, []
        min_len = min(len(v) for v in self.data[regime].values())
        if min_len < 10:
            return None, strategies
        matrix = []
        for s in strategies:
            matrix.append(self.data[regime][s][-min_len:])
        return np.array(matrix), strategies

class SharpeAllocator:
    def __init__(self, risk_free=0.0):
        self.risk_free = risk_free
    def optimize(self, returns_matrix):
        mean_returns = np.mean(returns_matrix, axis=1)
        cov = np.cov(returns_matrix)
        try:
            inv_cov = np.linalg.pinv(cov)
            excess = mean_returns - self.risk_free
            weights = inv_cov @ excess
            weights /= np.sum(np.abs(weights))
            return weights
        except:
            n = len(mean_returns)
            return np.ones(n) / n
