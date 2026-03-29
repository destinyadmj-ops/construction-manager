"""Reward computation utilities for RL agents.

Provides `compute_reward(state, action, info)` which returns a dict with
component contributions and `total` reward. Designed to be deterministic
and easy to test; heavy ML-specific ops (KL, entropy) are returned as
placeholders to be filled by the training loop.
"""
from typing import Dict, Optional
import math
import logging
import bot_v2.config as cfg

logger = logging.getLogger('bot_v2.ai.reward')

def _safe_div(a, b, eps=1e-8):
    try:
        return a / (b + eps)
    except Exception:
        return 0.0

def _kl_div(p: Dict[float, float], q: Dict[float, float]) -> float:
    # simple discrete KL; expects same keys
    s = 0.0
    for k, pv in p.items():
        qv = q.get(k, 1e-12)
        if pv <= 0:
            continue
        s += pv * math.log(pv / (qv + 1e-12) + 1e-12)
    return s


def _entropy(p: Dict[float, float]) -> float:
    s = 0.0
    for v in p.values():
        if v > 0:
            s -= v * math.log(v + 1e-12)
    return s


def compute_reward(state: Dict, action, info: Dict, policy_probs: Optional[Dict[float, float]] = None, old_policy_probs: Optional[Dict[float, float]] = None) -> Dict:
    """Compute reward components and total.

    Args:
        state: environment state (read-only)
        action: agent action (numeric or vector)
        info: auxiliary info dict. Expected keys (optional):
            - realized_pnl: float
            - pnl_std: float
            - mtm: float
            - fee: float
            - slippage: float
            - liq_impact: float
            - prev_action: previous action (for turnover)
            - drawdown: current drawdown (0..1)

    Returns:
        dict with components and `total`.
    """
    realized = float(info.get('realized_pnl', 0.0))
    pnl_std = float(info.get('pnl_std', 1.0))
    mtm = float(info.get('mtm', 0.0))
    fee = float(info.get('fee', 0.0))
    slippage = float(info.get('slippage', 0.0))
    liq = float(info.get('liq_impact', 0.0))
    prev_a = info.get('prev_action', 0.0)
    curr_a = action if action is not None else 0.0
    drawdown = float(info.get('drawdown', 0.0))

    r_pnl = _safe_div(realized, pnl_std)
    r_mtm = mtm
    r_cost = -(fee + slippage)
    r_liq = -liq
    r_turn = -abs(curr_a - prev_a)
    r_expo = -abs(info.get('exposure', 0.0))

    # weighted sum
    total = (
        cfg.RL_WEIGHT_PNL * r_pnl
        + cfg.RL_WEIGHT_MTM * r_mtm
        + cfg.RL_WEIGHT_COST * r_cost
        + cfg.RL_WEIGHT_TURN * r_turn
        + cfg.RL_WEIGHT_LIQ * r_liq
        + cfg.RL_WEIGHT_EXPO * r_expo
    )

    # regularization terms (returned separately; learning loop may compute KL/entropy)
    r_l2 = -cfg.RL_LAMBDA_L2 * (float(curr_a) ** 2)
    r_smooth = -cfg.RL_LAMBDA_SMOOTH * abs(curr_a - prev_a)
    r_dd = -cfg.RL_LAMBDA_DD * max(0.0, drawdown - cfg.RL_MAX_DRAWDOWN)

    total_with_reg = total + r_l2 + r_smooth + r_dd

    # KL / Entropy placeholders (compute if policies provided)
    kl = None
    ent = None
    if policy_probs is not None:
        try:
            ent = _entropy(policy_probs)
        except Exception:
            ent = None
    if policy_probs is not None and old_policy_probs is not None:
        try:
            kl = _kl_div(policy_probs, old_policy_probs)
        except Exception:
            kl = None

    out = {
        'r_pnl': r_pnl,
        'r_mtm': r_mtm,
        'r_cost': r_cost,
        'r_liq': r_liq,
        'r_turn': r_turn,
        'r_expo': r_expo,
        'r_l2': r_l2,
        'r_smooth': r_smooth,
        'r_dd': r_dd,
        'total': total_with_reg,
        'kl': kl,
        'entropy': ent,
    }

    logger.debug('compute_reward components: %s', {k: out[k] for k in out if k in ['r_pnl','r_cost','r_turn','r_l2','r_dd']})

    return out
