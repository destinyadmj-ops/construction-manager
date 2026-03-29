import numpy as np
import gymnasium as gym
from gymnasium import spaces

class TradingEnv(gym.Env):
    def __init__(self, data_dict):
        super().__init__()
        self.symbols = list(data_dict.keys())
        self.data = data_dict
        self.step_index = 100
        self.n = len(self.symbols)
        # action: weights + entry + exit + leverage
        self.action_space = spaces.Box(low=0, high=1, shape=(self.n * 4,), dtype=np.float32)
        self.observation_space = spaces.Box(low=-np.inf, high=np.inf, shape=(self.n * 8,), dtype=np.float32)
        self.balance = 10000
        self.positions = np.zeros(self.n)
        self.entry_prices = np.zeros(self.n)
    def _get_obs(self):
        obs = []
        for sym in self.symbols:
            row = self.data[sym].iloc[self.step_index]
            obs.extend([
                row["rsi"], row["atr"], row["return"], row["volume"],
                row["close"], row["open"], row["high"], row["low"]
            ])
        return np.array(obs, dtype=np.float32)
    def step(self, action):
        weights = action[:self.n]
        entry = action[self.n:self.n*2]
        exit_ = action[self.n*2:self.n*3]
        leverage = action[self.n*3:]
        prices = np.array([self.data[sym].iloc[self.step_index]["close"] for sym in self.symbols])
        pnl = 0.0
        for i in range(self.n):
            # ENTRY
            if entry[i] > 0.6 and self.positions[i] == 0:
                self.positions[i] = weights[i] * leverage[i]
                self.entry_prices[i] = prices[i]
            # EXIT
            if exit_[i] > 0.6 and self.positions[i] != 0:
                pnl += (prices[i] - self.entry_prices[i]) * self.positions[i]
                self.positions[i] = 0
        self.balance += pnl
        self.step_index += 1
        done = self.step_index >= len(self.data[self.symbols[0]]) - 1
        reward = pnl / max(1, self.balance)
        return self._get_obs(), reward, done, False, {}
