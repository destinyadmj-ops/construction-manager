import numpy as np

def mean_variance_weights(returns):
    mu = np.mean(returns, axis=0)
    cov = np.cov(returns.T)
    inv_cov = np.linalg.pinv(cov)
    w = inv_cov @ mu
    w = w / np.sum(w)
    return w
