import numpy as np

def compute_score(row):
    rsi_score = np.tanh((row["rsi"] - 50) / 8)
    atr_score = np.tanh(row["atr"] / (row["close"] * 0.01))
    vol_score = np.tanh(np.log1p(row["volume"]) / 5)
    momentum = np.tanh(row["return"] * 20)
    score = (
        0.35 * rsi_score +
        0.25 * atr_score +
        0.2  * vol_score +
        0.2  * momentum
    )
    return score

def normalize_weights(scores):
    scores = np.array(scores)
    exp_scores = np.exp(scores)
    weights = exp_scores / np.sum(exp_scores)
    floor = 0.01
    weights = np.maximum(weights, floor)
    return weights / np.sum(weights)

def compute_size(balance, weight, volatility):
    base = balance * weight
    vol_adj = 1 / (1 + volatility * 50)
    size = base * vol_adj
    return max(size, balance * 0.001)

def should_exit(current_weight, prev_weight, pnl, holding_time):
    if current_weight < prev_weight * 0.5:
        return True, "weight_drop"
    if holding_time > 50:
        return True, "time_exit"
    if pnl < -0.02:
        return True, "stop_loss"
    if pnl > 0.03 and current_weight < prev_weight:
        return True, "take_profit"
    return False, None

def partial_take_profit(position, pnl):
    if pnl > 0.02 and not position.get("tp1"):
        position["size"] *= 0.7
        position["tp1"] = True
    if pnl > 0.05 and not position.get("tp2"):
        position["size"] *= 0.5
        position["tp2"] = True
    return position


def compute_reward(returns, turnover):
    returns = np.array(returns)
    mean = np.mean(returns)
    std = np.std(returns) + 1e-6
    sharpe = mean / std
    # ドローダウン
    cum = np.cumsum(returns)
    peak = np.maximum.accumulate(cum)
    dd = np.max(peak - cum)
    # skew（右肩上がり優遇）
    skew = np.mean((returns - mean) ** 3) / (std ** 3 + 1e-6)
    reward = (
        sharpe * 1.5
        - dd * 1.8
        + skew * 0.2
        - turnover * 0.001
    )
    return reward

def apply_slippage(price, side, slippage_bps=3):
    if side == "buy":
        return price * (1 + slippage_bps / 10000)
    else:
        return price * (1 - slippage_bps / 10000)

import time
class DataValidator:
    def __init__(self, timeout=5):
        self.last_update = {}
        self.timeout = timeout
    def update(self, symbol):
        self.last_update[symbol] = time.time()
    def is_stale(self, symbol):
        if symbol not in self.last_update:
            return True
        return (time.time() - self.last_update[symbol]) > self.timeout

def adjust_by_regime(weight, regime):
    if regime == "trend":
        return weight * 1.3
    elif regime == "range":
        return weight * 0.7
    return weight
