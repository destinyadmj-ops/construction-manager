# bot_v2 拡張実装（Phase 4-5 入口）

## 追加したコンポーネント
- `strategy/cross_exchange_arbitrage_engine.py`
  - 取引所間の最良裁定機会を算出
  - 手数料/スリッページ/レイテンシ/資金調達率のペナルティを控除した `net_edge_bps` を評価
- `market/microstructure_engine.py`
  - 板のインバランス、フロー、スプレッドから方向性スコアを生成
  - `score`, `confidence`, `regime` を返却
- `ai/reinforcement_learning_trader.py`
  - 低依存の Q-learning ベース意思決定
  - `decide` と `learn` を分離し、既存の Learning Loop に接続しやすい構成

## 統合エントリ
- `main.py`
  - デモスナップショットを生成
  - Microstructure -> Arbitrage -> RL Decision -> RL Update を1サイクル実行

## 実行
ルートを `trading-bot` にして実行:

`python -m bot_v2.main`

## 実運用へ繋ぐ際の接続点
- `MarketSnapshot` の生成元を WebSocket/Orderbook 実データへ置換
- `reward_proxy` を実 PnL / execution quality に置換
- `CrossExchangeArbitrageEngine.min_net_edge_bps` は実スプレッドと手数料体系に合わせて再調整
