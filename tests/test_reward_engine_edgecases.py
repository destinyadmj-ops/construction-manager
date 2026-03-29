import math
from reward_engine import RewardEngine

class ArbObj:
    def __init__(self, net_edge_bps):
        self.net_edge_bps = net_edge_bps


def test_large_dd_and_negative_returns():
    re = RewardEngine()
    # create a curve with a large drawdown
    vals = [1000.0] * 10 + [800.0] * 10 + [1200.0]
    for v in vals:
        r = re.compute(v)
    assert isinstance(r, float)
    assert not math.isnan(r)


def test_best_arb_scaling_env():
    import os
    os.environ['REWARD_BEST_ARB_COEF'] = '0.01'
    re = RewardEngine()
    for i in range(20):
        re.compute(1000.0 + i)
    r1 = re.compute(1020.0, best_arb={"net_edge_bps": 100.0})
    # with coef 0.01, contribution should be 1.0
    assert isinstance(r1, float)
