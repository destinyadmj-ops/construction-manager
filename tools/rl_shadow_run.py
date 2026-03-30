"""Simple shadow-mode runner for RL reward integration testing.

Runs a short synthetic sequence, evaluates actions with safety_check and compute_reward,
logs reward decomposition to `logs/reward_shadow.log`.
"""
import sys, random, os, json, logging
from datetime import datetime

# ensure repo root is on path when run as script
sys.path.insert(0, os.getcwd())
from bot_v2.ai.reinforcement_learning_trader import ReinforcementLearningTrader

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('rl_shadow')

os.makedirs('logs', exist_ok=True)
logf = os.path.join('logs', 'reward_shadow.log')

rl = ReinforcementLearningTrader()
state = 's0'
prev_action = 0.0

with open(logf, 'a', encoding='utf-8') as f:
    f.write(f"--- Shadow run start {datetime.utcnow().isoformat()}Z\n")

    for t in range(20):
        # synthetic environment / info
        action = rl.decide(state).action
        # numeric mapping: buy=0.02, sell=-0.02, hold=0.0 to respect default MAX_POSITION_SIZE
        map_val = {'buy': 0.02, 'sell': -0.02, 'hold': 0.0}[action]
        info = {
            'realized_pnl': random.uniform(-0.5, 0.5),
            'pnl_std': max(0.1, random.uniform(0.1, 1.0)),
            'mtm': random.uniform(-0.2, 0.2),
            'fee': 0.0005,
            'slippage': random.uniform(0.0, 0.001),
            'liq_impact': random.uniform(0.0, 0.01),
            'prev_action': prev_action,
            'action_value': map_val,
            # allow larger synthetic position sizes for testing
            'max_position_size_override': 1.0,
            'exchange_connected': True,
            'indicators_heartbeat_age': random.choice([0.0, 0.2, 0.5]),
            'drawdown': random.uniform(0.0, 0.05),
        }

        res = rl.evaluate_action(state, action, info)
        if not res['ok']:
            line = {'t': t, 'action': action, 'ok': False, 'reason': res['reason']}
            f.write(json.dumps(line, ensure_ascii=False) + '\n')
            logger.info('t=%d action=%s rejected: %s', t, action, res['reason'])
            # skip learn when rejected
            prev_action = map_val
            continue

        comps = res['reward_components']
        # log components
        line = {'t': t, 'action': action, 'components': comps}
        f.write(json.dumps(line, ensure_ascii=False) + '\n')
        logger.info('t=%d action=%s total=%.4f', t, action, comps.get('total'))

        # simulate next state and learning
        next_state = f's{t+1}'
        rl.learn(state, action, reward=None, next_state_key=next_state, info=info)
        state = next_state
        prev_action = map_val

    f.write(f"--- Shadow run end {datetime.utcnow().isoformat()}Z\n")
print('Shadow run complete; log ->', logf)
