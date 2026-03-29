from dataclasses import dataclass
from typing import Dict, Iterable, Tuple
import random
import logging

from bot_v2.ai.reward import compute_reward
from bot_v2.ai.safety import safety_check

logger = logging.getLogger('bot_v2.ai.rltrader')


@dataclass(frozen=True)
class RLDecision:
    action: str
    expected_value: float
    exploration: bool


class ReinforcementLearningTrader:
    def __init__(
        self,
        actions: Iterable[str] = ("buy", "sell", "hold"),
        alpha: float = 0.08,
        gamma: float = 0.92,
        epsilon: float = 0.12,
        epsilon_decay: float = 0.999,
        epsilon_min: float = 0.03,
        seed: int = 7,
    ) -> None:
        self.actions = tuple(actions)
        self.alpha = alpha
        self.gamma = gamma
        self.epsilon = epsilon
        self.epsilon_decay = epsilon_decay
        self.epsilon_min = epsilon_min
        self._rng = random.Random(seed)
        self._q_table: Dict[str, Dict[str, float]] = {}

    def decide(self, state_key: str) -> RLDecision:
        self._ensure_state(state_key)
        explore = self._rng.random() < self.epsilon
        if explore:
            action = self._rng.choice(self.actions)
        else:
            action = max(self._q_table[state_key], key=self._q_table[state_key].get)

        expected_value = self._q_table[state_key][action]
        return RLDecision(action=action, expected_value=expected_value, exploration=explore)

    def evaluate_action(self, state_key: str, action: str, info: Dict) -> Dict:
        """Evaluate an action: run safety_check and compute reward components.

        Returns dict with keys: ok(bool), reason(if rejected), reward_components(dict)
        """
        # safety check
        ok, reason = safety_check({}, action, info)
        if not ok:
            logger.warning('Action rejected by safety_check: %s', reason)
            return {'ok': False, 'reason': reason, 'reward_components': None}

        # compute reward components (map discrete action to numeric for simple L2)
        # If caller supplies numeric mapping in info use it, else try simple mapping
        action_value = info.get('action_value') if info.get('action_value') is not None else 0.0
        reward_components = compute_reward({}, action_value, info)
        return {'ok': True, 'reason': 'ok', 'reward_components': reward_components}

    def learn(
        self,
        state_key: str,
        action: str,
        reward: float = None,
        next_state_key: str = None,
        info: dict = None,
    ) -> None:
        self._ensure_state(state_key)
        # allow integration: if reward is not provided, compute via reward.compute_reward
        if info is None:
            info = {}
        # ensure next state exists for Q-learning backup (if provided)
        if next_state_key is not None:
            self._ensure_state(next_state_key)

        current_q = self._q_table[state_key][action]

        # compute reward via RL reward module if not provided
        if reward is None:
            try:
                # map discrete action to numeric value (caller may supply action_value in info)
                action_value = info.get('action_value') if info.get('action_value') is not None else 0.0
                from bot_v2.ai.reward import compute_reward

                comp = compute_reward({}, action_value, info)
                reward_val = float(comp.get('total', 0.0))
            except Exception:
                reward_val = 0.0
        else:
            reward_val = float(reward)

        if next_state_key is not None:
            max_next_q = max(self._q_table[next_state_key].values())
        else:
            max_next_q = 0.0

        updated_q = current_q + self.alpha * (
            reward_val + self.gamma * max_next_q - current_q
        )
        self._q_table[state_key][action] = updated_q
        self.epsilon = max(self.epsilon_min, self.epsilon * self.epsilon_decay)

    def state_action_values(self, state_key: str) -> Dict[str, float]:
        self._ensure_state(state_key)
        return dict(self._q_table[state_key])

    def _ensure_state(self, state_key: str) -> None:
        if state_key in self._q_table:
            return
        self._q_table[state_key] = {action: 0.0 for action in self.actions}
