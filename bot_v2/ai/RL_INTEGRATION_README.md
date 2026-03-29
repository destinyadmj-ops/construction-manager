RL Integration README

目的
- `ReinforcementLearningTrader` に `bot_v2.ai.reward.compute_reward` と `bot_v2.ai.safety.safety_check` を統合する手順と利用例を示す。

概要
- `reinforcement_learning_trader.evaluate_action()` は実行前チェック（安全フック）と報酬成分計算を行うユーティリティです。
- 学習ループ内で `learn()` を呼ぶ際、`reward` を明示的に渡さない場合は `learn(..., info=...)` が `compute_reward` を呼んで自動的に報酬を計算します。

使い方（実行ループ例）

1) 事前に `info` を組み立てる（例: 手数料、スリッページ、直近PnL標準偏差、heartbeat age 等）

```python
from bot_v2.ai.reinforcement_learning_trader import ReinforcementLearningTrader

rl = ReinforcementLearningTrader()
state = 's1'
action = 'buy'  # or 'sell','hold'
info = {
    'realized_pnl': 0.0,
    'pnl_std': 0.5,
    'fee': 0.001,
    'slippage': 0.0005,
    'indicators_heartbeat_age': 0.2,
    'prev_action': 0.0,
    'action_value': 1.0,  # numeric mapping used by reward.compute_reward
}

# evaluate (safety + reward components)
res = rl.evaluate_action(state, action, info)
if not res['ok']:
    # action rejected by safety
    print('Rejected:', res['reason'])
else:
    # execute market order (or simulated)
    # after environment step, call learn()
    next_state = 's2'
    # do not pass reward: learn() will call compute_reward using info
    rl.learn(state, action, reward=None, next_state_key=next_state, info=info)
```

注意点
- `info['action_value']` は離散アクションを数値化するためのヒントです。実運用ではポジションサイズ等を渡してください。
- `safety_check` はハード制約（heartbeat stale、position limit、drawdown、接続）を即時拒否します。学習中もこれを通すことで安全性が担保されます。
- KL・エントロピー等は `compute_reward` でプレースホルダとして返されます。ポリシー型学習（PPO等）では学習ループ側でそれらを用いて正則化してください。

テスト
- `tests/test_reward_components.py` に基本動作テストが含まれています。`python -m unittest tests.test_reward_components -v` で実行してください。

次のステップ
- 実装をステージングでshadow-modeテストし、報酬分解ログを監査ログに追加することを推奨します。
