from bot_v2.risk.sharpe_allocator import RegimePortfolio, SharpeAllocator

class MetaAllocator:
    def __init__(self):
        self.portfolio = RegimePortfolio()
        self.sharpe = SharpeAllocator()
    def update(self, regime, strategy, pnl_ratio):
        self.portfolio.add_return(regime, strategy, pnl_ratio)
    def get_weight(self, regime, strategy):
        matrix, strategies = self.portfolio.get_matrix(regime)
        if matrix is None or strategy not in strategies:
            return 0.1  # fallback
        weights = self.sharpe.optimize(matrix)
        idx = strategies.index(strategy)
        return weights[idx]
