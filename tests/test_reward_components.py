import unittest
from bot_v2.ai.reward import compute_reward
from bot_v2.ai.safety import safety_check


class TestRewardComponents(unittest.TestCase):
    def test_cost_penalty_reduces_total(self):
        info_low_cost = {'realized_pnl': 1.0, 'pnl_std': 1.0, 'fee': 0.0, 'slippage': 0.0}
        info_high_cost = {'realized_pnl': 1.0, 'pnl_std': 1.0, 'fee': 0.5, 'slippage': 0.2}
        r1 = compute_reward({}, 0.0, info_low_cost)
        r2 = compute_reward({}, 0.0, info_high_cost)
        self.assertLess(r2['total'], r1['total'])

    def test_safety_heartbeat_rejects(self):
        ok, reason = safety_check({}, 0.0, {'indicators_heartbeat_age': 5.0})
        self.assertFalse(ok)
        self.assertIn('heartbeat stale', reason)


if __name__ == '__main__':
    unittest.main()
