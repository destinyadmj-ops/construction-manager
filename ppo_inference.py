from stable_baselines3 import PPO
import numpy as np

model = PPO.load("c:/Users/desti/trading-bot/ppo_model")

def get_weights(state_vector):
    action, _ = model.predict(state_vector)
    weights = action / (np.sum(action) + 1e-6)
    return weights
