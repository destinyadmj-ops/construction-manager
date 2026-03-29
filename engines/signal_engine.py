import numpy as np

def compute_score(ind):
    # 正規化（重要）
    rsi_score = (ind["rsi"] - 48) / 10  # ソフト化
    atr_score = ind["atr"] / (ind["atr"] + 10)  # percentile化
    vol_score = np.log1p(ind["volume"]) / 10
    score = (
        rsi_score * 0.4 +
        atr_score * 0.3 +
        vol_score * 0.3
    )
    return score

def normalize_weights(w):
    w = np.maximum(w, 0)
    floor = 0.05
    w = np.maximum(w, floor)
    return w / np.sum(w)

def compute_size(balance, weight):
    base = balance * weight
    min_size = balance * 0.002
    return max(base * 0.01, min_size)
