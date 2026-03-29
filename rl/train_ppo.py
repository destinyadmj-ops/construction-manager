from stable_baselines3 import PPO
from env.regime_env import RegimeEnv
import pandas as pd

df = pd.read_csv("data/BTCUSDT.csv")

env = RegimeEnv(df)

model = PPO(
    "MlpPolicy",
    env,
    verbose=1,
    learning_rate=3e-4,
    n_steps=2048,
    batch_size=64
)

model.learn(total_timesteps=200000)

model.save("models/ppo_model")
