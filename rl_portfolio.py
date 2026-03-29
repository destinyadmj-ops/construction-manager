import numpy as np

class RLPortfolio:

    def __init__(self, symbols):
        self.symbols = symbols
        self.n = len(symbols)
        # 初期ウェイト（均等）
        self.weights = np.ones(self.n) / self.n
        self.lr = 0.01
        self.history_returns = []

    # =========================
    # ■ 特徴量 → 配分
    # =========================
    def compute_weights(self, features):
        x = np.array(features)
        # softmaxで正規化（合計1）
        exp_x = np.exp(x)
        self.weights = exp_x / np.sum(exp_x)
        return self.weights

    # =========================
    # ■ Sharpe + Sortino報酬
    # =========================
    def compute_reward(self, returns):
        self.history_returns.append(returns)
        r = np.array(self.history_returns)
        mean = np.mean(r)
        std = np.std(r)
        downside = r[r < 0]
        downside_std = np.std(downside) if len(downside) > 0 else 1
        sharpe = mean / (std + 1e-6)
        sortino = mean / (downside_std + 1e-6)
        # 合成報酬
        reward = sharpe * 0.5 + sortino * 0.5
        return reward

    # =========================
    # ■ 学習（シンプル版）
    # =========================
    def update(self, reward):
        grad = reward * self.lr
        self.weights += grad
        # 正規化
        self.weights = np.maximum(self.weights, 0)
        self.weights /= np.sum(self.weights)
