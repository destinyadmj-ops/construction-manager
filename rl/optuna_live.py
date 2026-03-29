import optuna

def objective(trial):
    lr = trial.suggest_float("lr", 1e-5, 1e-3)
    gamma = trial.suggest_float("gamma", 0.9, 0.999)
    score = run_backtest(lr, gamma)
    return score

study = optuna.create_study(direction="maximize")

def optimize_step():
    study.optimize(objective, n_trials=1)
