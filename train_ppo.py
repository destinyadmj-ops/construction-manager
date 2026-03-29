from stable_baselines3 import PPO, SAC
from trading_env import TradingEnv
from data_loader import load_csv
from feature_builder import add_indicators

SYMBOLS = ["BTCUSDT", "ETHUSDT", "DOGEUSDT"]

data_dict = {}
for s in SYMBOLS:
    df = load_csv(s)
    df = add_indicators(df)
    data_dict[s] = df

env = TradingEnv(data_dict)


# --- PPO or SAC 切替 ---
USE_SAC = True
if USE_SAC:
    model = SAC(
        "MlpPolicy",
        env,
        learning_rate=3e-4,
        gamma=0.99,
        ent_coef=0.01,  # 探索強化
        buffer_size=200000,
        batch_size=256,
        tau=0.01,
        verbose=1
    )
else:
    model = PPO(
        "MlpPolicy",
        env,
        verbose=1,
        learning_rate=3e-4,
        gamma=0.99,
        n_steps=2048,
        batch_size=64
    )

model.learn(total_timesteps=100000)

model.save("c:/Users/desti/trading-bot/ppo_model")
