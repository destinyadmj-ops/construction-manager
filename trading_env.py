try:
    import gymnasium as gym
except ImportError as e:
    print(f"[WARN] import error: {e}. 必要なパッケージをpip install gymnasium してください。")
import numpy as np

class TradingEnv(gym.Env):
    def __init__(self, data_dict):
        super().__init__()
        self.symbols = list(data_dict.keys())
        self.data = data_dict
        self.step_index = 100
        self.action_space = gym.spaces.Box(
            low=0, high=1, shape=(len(self.symbols),), dtype=np.float32
        )
        self.observation_space = gym.spaces.Box(
            low=-10, high=10, shape=(len(self.symbols)*6,), dtype=np.float32
        )
        self.balance = 1000
        self.equity = 1.0
        self.peak = 1.0

    def _normalize_action(self, action):
        exp = np.exp(action)
        return exp / (np.sum(exp) + 1e-8)
    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        self.step_index = 100
        self.balance = 1000
        self.equity = 1.0
        self.peak = 1.0
        obs = self._get_obs()
        info = {}
        return obs, info
    def _get_obs(self):
        obs = []
        for s in self.symbols:
            df = self.data[s]
            row = df.iloc[self.step_index]
            obs.extend([
                row["rsi"], row["atr"],
                row["return"],
                row["volume"],
                row["close"],
                row["open"]
            ])
        return np.array(obs, dtype=np.float32)
    def step(self, action):
        action = self._normalize_action(action)
        returns = []
        for i, s in enumerate(self.symbols):
            df = self.data[s]
            price_now = df.iloc[self.step_index]["close"]
            price_prev = df.iloc[self.step_index - 1]["close"]
            ret = (price_now - price_prev) / price_prev
            returns.append(ret * action[i])
        returns = np.array(returns)
        portfolio_return = np.sum(returns)
        risk = np.std(returns) + 1e-6
        sharpe = portfolio_return / risk if risk > 0 else 0.0

        # DDペナルティ
        self.equity *= (1 + portfolio_return)
        self.peak = max(self.peak, self.equity)
        dd = (self.peak - self.equity) / self.peak if self.peak > 0 else 0.0
        reward = sharpe - dd * 0.5

        self.balance *= (1 + portfolio_return)
        self.step_index += 1
        obs = self._get_obs()
        terminated = self.step_index >= len(self.data[self.symbols[0]]) - 1
        truncated = False
        info = {}
        return obs, reward, terminated, truncated, info
