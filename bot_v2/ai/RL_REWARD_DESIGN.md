**RL 報酬設計ドキュメント**

作成日: 2026-03-30
作成者: 自動生成 (assistant)

目的
- 本ドキュメントは `bot_v2` の強化学習制御器に適用する報酬関数設計、正則化項、及び安全フックを定義する。運用リスクを低減しつつ学習効率を確保することを目的とする。

設計原則
- 報酬は主に実現損益を反映するが、取引コスト・流動性・ドローダウンなどのリスク指標を明示的にペナルティとして組み込む。
- ハード制約（即時拒否）とソフト制約（学習による回避）の二層構造を採用する。
- ハイパーパラメータは運用で調整可能にし、設定は `bot_v2/config.py` または `runtime_state.db` で管理する。

1. 報酬成分（1ステップ r_t）

- 実現損益 (PnL)
  - 定義: ステップ内に確定した損益 ΔP
  - 正規化: 過去窓のPnL標準偏差 σ_P で割る
  - 式: $r_{pnl}=\frac{\Delta P}{\sigma_P + \epsilon}$

- 未実現評価変化 (MTM)
  - 定義: 時刻 t の評価値変化
  - 補助的に短期の価格感度を学習させるために使用

- 取引コスト (cost)
  - 手数料、スリッページ、スプレッド推定を負の項で差し引く
  - 式: $r_{cost} = -(fee + slippage\_est)$

- 流動性インパクト (liq)
  - 約定量と市場深さからインパクトを評価しペナルティ

- 取引頻度ペナルティ (turnover)
  - 過度な頻度を抑制: $r_{turn} = -\lambda_{turn} |a_t - a_{t-1}|$

- エクスポージャー/レバレッジペナルティ (expo)
  - 総露出やロング/ショートの偏りに対する負担

総合式（重み付き和）:
$$
r_t = w_{pnl} r_{pnl} + w_{mtm} r_{mtm} + w_{cost} r_{cost} + w_{turn} r_{turn} + w_{liq} r_{liq} + w_{expo} r_{expo}
$$

2. 正則化項

- L2アクション正則化 (ポジションサイズ抑制)
  $$R_{L2} = -\lambda_{L2} \|a_t\|^2$$

- アクションスムーズネス
  $$R_{smooth} = -\lambda_s |a_t - a_{t-1}|$$

- KLペナルティ（ポリシー急変抑止、オフライン更新時）
  $$R_{KL} = -\lambda_{KL} D_{KL}(\pi_{new}||\pi_{old})$$

- ドローダウン抑制
  $$R_{dd} = -\lambda_{dd} \max(0, DD_t - DD_{thresh})$$

- エントロピー（探索維持、学習時のみ）
  $$R_{entropy} = \lambda_H H(\pi(\cdot|s_t))$$

合成報酬（学習時）:
$$
R^{total}_t = r_t + R_{L2} + R_{smooth} + R_{KL} + R_{dd} + R_{entropy}
$$

3. 安全フック（ハード / ソフト）

- ハード制約（取引前チェック）
  - 指標ハートビート stale -> 取引拒否（`indicators_monitor` と共用）
  - 最大ポジション上限: `MAX_POSITION` を超える注文はクリップまたは拒否
  - 最大ドローダウン閾値超過 -> `ExecutionOptimizer.pause()` をトリガー
  - 取引所接続エラーや認証失敗 -> 全注文拒否 + オペアラート

- ソフト制約
  - 上記の正則化を報酬に組み込み学習で回避

- エスカレーション
  - 重大なハード停止はSlack/メールで即時通知
  - 連続的なheartbeat stale や N 回の監査アラートで運用チャンネルに切替

4. 実装案

- ファイル/モジュール
  - `bot_v2/ai/reward.py` : `compute_reward(state, action, info)` を実装
  - `bot_v2/ai/safety.py` : `safety_check(state, action)` を実装（ハードチェック）
  - `bot_v2/config.py` : 重み・λ・閾値を追加

- インタフェース
  - 学習ループ/実行ループから `compute_reward` を呼ぶ。`info` に手数料・スリッページ推定・流動性指標を渡す。
  - 取引実行直前に `safety_check` を呼び、拒否時は `ActionRejected` を返してログと監査DBに記録。

5. 初期ハイパーパラメータ（出発点）
- $w_{pnl}=1.0, w_{mtm}=0.1, w_{cost}=-1.0, w_{turn}=-0.1$
- $\lambda_{L2}=1e-4, \lambda_s=1e-3, \lambda_{dd}=10.0, \lambda_H=1e-2$

6. モニタリングと回帰テスト
- 監査ログに以下を記録: 報酬各成分、正則化寄与、`safety_check` 結果、ActionRejected の理由
- 定期テスト: モック環境でコスト上昇・流動性低下・heartbeat stale を注入し、報酬/アクションの変化と安全フック動作を検証

7. ロールアウト手順
- ステージングで 1) 学習有効/実行無効 2) shadow-mode（学習済みポリシーを実運用に適用し非執行で比較） 3) フェーズドロールアウト (徐々に資金/サイズを増やす)

8. 単体テスト/サンプルスクリプト
- 小さなユニット: `tests/test_reward_components.py` を用意し、コスト増加で総報酬が低下することなどを検証

付録: 参考式・用語
- PnL: realized profit and loss
- MTM: mark-to-market
- DD: drawdown

----
ファイル実装やテストスケルトンを希望する場合は次に進めます。生成先: `bot_v2/ai/reward.py`, `bot_v2/ai/safety.py`, `tests/test_reward_components.py`。
