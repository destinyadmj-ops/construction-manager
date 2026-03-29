"""
Monte Carlo Risk Engine
- ランダムパスで損益分布・最大DD・リスク指標を推定
"""
import numpy as np

class MonteCarloRiskEngine:
    def __init__(self, n_sim=1000, horizon=100):
        self.n_sim = n_sim
        self.horizon = horizon

    def simulate(self, returns):
        """
        returns: list of float（日次リターン等）
        return: dict {max_drawdown, mean, std, VaR, ...}
        """
        results = []
        for _ in range(self.n_sim):
            path = np.random.choice(returns, self.horizon, replace=True)
            cum = np.cumprod([1 + r for r in path])
            dd = np.max(np.maximum.accumulate(cum) - cum)
            results.append((cum[-1], dd))
        final = [r[0] for r in results]
        dds = [r[1] for r in results]
        return {
            'mean': np.mean(final),
            'std': np.std(final),
            'max_drawdown': np.max(dds),
            'VaR_5': np.percentile(final, 5),
            'VaR_1': np.percentile(final, 1),
        }
