from stable_baselines3 import PPO
import numpy as np

model = PPO.load("models/ppo_model")

def get_action(state):
    action, _ = model.predict(state)
    return action / (action.sum()+1e-6)
