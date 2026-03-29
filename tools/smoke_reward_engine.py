"""スモークテスト: RewardEngine.compute の簡易検証スクリプト
実行: python tools/smoke_reward_engine.py

目的:
- 標準的な数値（equity）入力に対して reward を返すこと
- best_arb を dict とオブジェクト（属性持ち）で渡した場合の挙動確認
"""
from reward_engine import RewardEngine

class ArbObj:
    def __init__(self, net_edge_bps):
        self.net_edge_bps = net_edge_bps


def run_smoke():
    re = RewardEngine()
    print("feeding equities...")
    for i in range(30):
        equity = 1000.0 + i * 1.5  # 単調増加
        # 10回目だけ dict を渡す
        if i == 10:
            best_arb = {"net_edge_bps": 5.0}
        # 20回目だけオブジェクトを渡す
        elif i == 20:
            best_arb = ArbObj(3.0)
        else:
            best_arb = None
        reward = re.compute(equity, weights=None, best_arb=best_arb)
        print(f"i={i:02d} equity={equity:.2f} best_arb={type(best_arb).__name__} reward={reward:.6f}")

if __name__ == '__main__':
    run_smoke()
