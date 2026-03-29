import time
from stable_baselines3 import SAC

MODEL_PATH = "c:/Users/desti/trading-bot/models/current_model"

class MultiAgent:
    def __init__(self):
        self.model = SAC.load(MODEL_PATH)
        self.last_load = time.time()

    def reload_if_updated(self):
        # 60秒ごとチェック
        if time.time() - self.last_load > 60:
            self.model = SAC.load(MODEL_PATH)
            self.last_load = time.time()
            print("MODEL RELOADED")

    def act(self, state):
        self.reload_if_updated()
        action, _ = self.model.predict(state)
        return action
