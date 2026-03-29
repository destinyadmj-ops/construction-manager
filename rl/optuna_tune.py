import optuna
from stable_baselines3 import SAC
from trading_env import TradingEnv
from data_loader import load_csv
from feature_builder import add_indicators

SYMBOLS = ["BTCUSDT", "ETHUSDT", "DOGEUSDT"]

def make_env():
    data_dict = {}
    for s in SYMBOLS:
        df = load_csv(s)
        df = add_indicators(df)
        data_dict[s] = df
    return TradingEnv(data_dict)

def evaluate_model(model, env, n_eval=1000):
    obs, _ = env.reset()
    total_reward = 0
    for _ in range(n_eval):
        action, _ = model.predict(obs)
        obs, reward, terminated, truncated, _ = env.step(action)
        total_reward += reward
        if terminated or truncated:
            obs, _ = env.reset()
    return total_reward / n_eval

def objective(trial):
    lr = trial.suggest_float("lr", 1e-5, 1e-3)
    gamma = trial.suggest_float("gamma", 0.95, 0.999)
    ent_coef = trial.suggest_float("ent_coef", 0.001, 0.05)
    env = make_env()
    model = SAC(
        "MlpPolicy",
        env,
        learning_rate=lr,
        gamma=gamma,
        ent_coef=ent_coef,
        buffer_size=200000,
        batch_size=256,
        tau=0.01,
        verbose=1
    )
    model.learn(50000)
    reward = evaluate_model(model, env)
    return reward

if __name__ == "__main__":
    study = optuna.create_study(direction="maximize")
    study.optimize(objective, n_trials=20)
    print(study.best_params)
