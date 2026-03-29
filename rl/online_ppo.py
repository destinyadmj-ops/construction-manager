from stable_baselines3 import PPO

class OnlinePPO:
    def __init__(self, env):
        self.model = PPO("MlpPolicy", env, verbose=0)
    def predict(self, obs):
        return self.model.predict(obs)[0]
    def update(self, replay_buffer):
        if len(replay_buffer.buffer) < 128:
            return
        self.model.learn(total_timesteps=256, reset_num_timesteps=False)
