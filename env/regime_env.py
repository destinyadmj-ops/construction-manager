

import gymnasium as gym
from gymnasium import spaces
import numpy as np

class RegimeEnv(gym.Env):
    def __init__(self, data):
        super().__init__()
        self.data = data
        self.idx = 100
        self.action_space = spaces.Box(low=0, high=1, shape=(3,), dtype=np.float32)
        self.observation_space = spaces.Box(low=-10, high=10, shape=(12,), dtype=np.float32)

    def detect_regime(self, row):
        # ATRをpercentile化、RSIをソフト化
        atr_percentile = np.clip(row["atr"] / (row["atr"] + 10), 0, 1)
        rsi_score = (row["rsi"] - 48) / 10
        if atr_percentile > 0.7:
            return 2  # high vol
        elif rsi_score > 0:
            return 1  # trend
        return 0  # range

    def reset(self, *, seed=None, options=None):
        self.idx = 100
        obs = self._obs()
        info = {}
        return obs, info

    def _obs(self):
        row = self.data.iloc[self.idx]
        return np.array([
            row["rsi"], row["atr"],
            row["volume"], row["return"]
        ] * 3)

    def normalize_weights(self, w):
        w = np.maximum(w, 0)
        floor = 0.05
        w = np.maximum(w, floor)
        return w / np.sum(w)

    def step(self, action):
        weights = self.normalize_weights(action)
        row = self.data.iloc[self.idx]
        regime = self.detect_regime(row)
        reward = weights[regime] * row["return"]
        print({"weights": weights, "regime": regime, "reward": reward, "idx": self.idx})
        self.idx += 1
        terminated = self.idx >= len(self.data)-1
        truncated = False
        obs = self._obs()
        info = {}
        return obs, reward, terminated, truncated, info
