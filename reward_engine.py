import numpy as np

def compute_calmar(equity_curve):
    # 安定化: カルマーレシオは総リターン(%) / 最大ドローダウン(%) で計算する
    if len(equity_curve) < 2:
        return 0.0
    start = float(equity_curve[0]) if equity_curve[0] != 0 else 1.0
    total_return_pct = (float(equity_curve[-1]) - start) / start
    peak = np.maximum.accumulate(equity_curve)
    # ドローダウンをパーセンテージで計算
    with np.errstate(divide='ignore', invalid='ignore'):
        drawdown = (equity_curve - peak) / peak
    max_dd = abs(np.nanmin(drawdown)) + 1e-8
    return float(total_return_pct / max_dd) if max_dd > 0 else 0.0

class RewardEngine:
    def __init__(self):
        self.equity_curve = []
        # 環境変数からチューニングパラメータを読み込む
        import os
        self.sharpe_clip = float(os.getenv('REWARD_SHARPE_CLIP', '5.0'))
        self.calmar_clip = float(os.getenv('REWARD_CALMAR_CLIP', '10.0'))
        self.max_dd_clip = float(os.getenv('REWARD_MAX_DD_CLIP', '1.0'))
        self.best_arb_coef = float(os.getenv('REWARD_BEST_ARB_COEF', '0.001'))
    def compute(self, equity, weights=None, best_arb=None):
        self.equity_curve.append(equity)
        if len(self.equity_curve) < 20:
            return 0.0
        # パーセンテージリターンで計算してスケーリングを安定化
        prev = np.array(self.equity_curve[:-1], dtype=float)
        curr = np.array(self.equity_curve[1:], dtype=float)
        with np.errstate(divide='ignore', invalid='ignore'):
            pct_returns = (curr - prev) / np.where(prev == 0, 1.0, prev)
        # 基本統計量
        mean_r = float(np.nanmean(pct_returns))
        std_r = float(np.nanstd(pct_returns)) + 1e-8
        sharpe = mean_r / std_r
        calmar = compute_calmar(np.array(self.equity_curve, dtype=float))
        # 最大ドローダウン（%）
        peak = np.maximum.accumulate(self.equity_curve)
        with np.errstate(divide='ignore', invalid='ignore'):
            drawdown = (np.array(self.equity_curve) - peak) / peak
        max_dd = abs(np.nanmin(drawdown)) if len(drawdown) > 0 else 0.0
        # クリッピングで極端な値を抑制
        sharpe = float(np.clip(sharpe, -self.sharpe_clip, self.sharpe_clip))
        calmar = float(np.clip(calmar, -self.calmar_clip, self.calmar_clip))
        max_dd = float(np.clip(max_dd, 0.0, self.max_dd_clip))
        reward = (
            sharpe * 0.5 +
            calmar * 0.5 -
            max_dd * 2.0
        )
        # Optionally include best_arb in reward calculation
        # best_arb が dict またはオブジェクト属性として渡される可能性に対応
        if best_arb:
            try:
                if isinstance(best_arb, dict):
                    edge = float(best_arb.get("net_edge_bps", 0.0) or 0.0)
                else:
                    edge = float(getattr(best_arb, 'net_edge_bps', 0.0) or 0.0)
                # bps 単位を環境変数係数で加算
                reward += edge * self.best_arb_coef
            except Exception:
                pass
        return float(reward)
