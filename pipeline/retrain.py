from stable_baselines3 import SAC
from env.regime_env import RegimeEnv
from pipeline.dataset_builder import build_dataset
import os
import time

MODEL_DIR = "c:/Users/desti/trading-bot/models/"

MIN_DATA = 300

# 悪化モデル拒否用
REWARD_PATH = MODEL_DIR + "last_reward.txt"

def retrain():
    df = build_dataset()
    if len(df) < MIN_DATA:
        print("Not enough data")
        return
    env = RegimeEnv(df)
    model = SAC(
        "MlpPolicy",
        env,
        learning_rate=3e-4,
        batch_size=256,
        gamma=0.99,
        ent_coef=0.01,
        verbose=1
    )
    model.learn(total_timesteps=50000)
    # 新モデルの平均報酬計算
    new_reward = float(getattr(env, "last_eval_reward", 0))
    old_reward = 0
    if os.path.exists(REWARD_PATH):
        with open(REWARD_PATH) as f:
            old_reward = float(f.read().strip())
    if new_reward < old_reward:
        print("Model performance worsened. Skipping update.")
        return
    timestamp = int(time.time())
    path = MODEL_DIR + f"sac_model_{timestamp}"
    model.save(path)
    with open(REWARD_PATH, "w") as f:
        f.write(str(new_reward))
    print(f"Saved: {path}")
    return path
