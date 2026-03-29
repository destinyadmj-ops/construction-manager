import math
from reward_engine import RewardEngine

class ArbObj:
    def __init__(self, net_edge_bps):
        self.net_edge_bps = net_edge_bps


def test_rewardengine_basic():
    re = RewardEngine()
    # 最初は20未満で0
    for i in range(19):
        r = re.compute(1000.0 + i)
        assert isinstance(r, float)
        assert r == 0.0
    # 20回目で計算が行われる
    r20 = re.compute(1020.0)
    assert isinstance(r20, float)
    assert not math.isnan(r20)

def test_rewardengine_best_arb_variants():
    re = RewardEngine()
    for i in range(20):
        re.compute(1000.0 + i)
    # dict variant
    r1 = re.compute(1020.0, best_arb={"net_edge_bps": 5.0})
    # object variant
    r2 = re.compute(1021.0, best_arb=ArbObj(3.0))
    assert isinstance(r1, float)
    assert isinstance(r2, float)
