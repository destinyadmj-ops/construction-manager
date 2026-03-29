"""Safety checks and hard hooks for trading actions.

Provides `safety_check(state, action, info)` which returns (ok, reason).
If not ok, callers should reject the action and log the reason.
"""
from typing import Tuple
import logging
import bot_v2.config as cfg

logger = logging.getLogger('bot_v2.ai.safety')

class ActionRejected(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason

def safety_check(state: dict, action, info: dict) -> Tuple[bool, str]:
    """Perform hard safety checks before execution.

    Returns (ok:bool, reason:str). If ok is False, the caller must not execute.
    Expected `info` keys: `indicators_heartbeat_age`, `current_position`, `max_position_size_override`, `drawdown`.
    """
    hb_age = float(info.get('indicators_heartbeat_age', 0.0))
    if hb_age > cfg.HEARTBEAT_MAX_AGE:
        reason = f'indicators heartbeat stale ({hb_age}s > {cfg.HEARTBEAT_MAX_AGE}s)'
        logger.warning("Safety check failed: %s", reason)
        return False, reason

    curr_pos = float(info.get('current_position', 0.0))
    max_pos = float(info.get('max_position_size_override', cfg.MAX_POSITION_SIZE))
    intended = float(action if action is not None else 0.0)
    # simple check: resulting absolute position must not exceed max
    if abs(curr_pos + intended) > max_pos + 1e-12:
        reason = f'position limit exceeded (curr {curr_pos} + action {intended} > max {max_pos})'
        logger.warning("Safety check failed: %s", reason)
        return False, reason

    drawdown = float(info.get('drawdown', 0.0))
    if drawdown > cfg.RL_MAX_DRAWDOWN:
        reason = f'drawdown threshold exceeded ({drawdown} > {cfg.RL_MAX_DRAWDOWN})'
        logger.warning("Safety check failed: %s", reason)
        return False, reason

    # If connectivity info present
    if info.get('exchange_connected') is False:
        reason = 'exchange connectivity lost'
        logger.warning("Safety check failed: %s", reason)
        return False, reason

    return True, 'ok'
