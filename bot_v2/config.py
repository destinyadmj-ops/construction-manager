# config.py

# --- レバレッジ・リスク・トレーリング設定（段階的/ボラ連動/ポートフォリオ） ---
LEVERAGE = 60
RISK_PER_TRADE = 0.01
MAX_POSITION_SIZE = 0.02
MIN_POSITION_SIZE = 0.001
TRAILING_STAGE_1 = 0.015  # 1.5%
TRAILING_STAGE_2 = 0.025  # 2.5%
TRAILING_STAGE_3 = 0.035  # 3.5%

# --- PortfolioAllocator/AdvancedPositionSizer用パラメータ ---
PORTFOLIO_TARGET_VOL = 0.02  # 目標ポートフォリオ年率ボラティリティ
PORTFOLIO_MAX_DRAWDOWN = 0.03  # 最大ドローダウン許容（厳格化）
ADVANCED_SIZER_BASE_RISK = 0.01  # sizerのベースリスク

# エントリー時の口座比ベースリスク（環境変数フォールバックと整合）
ENTRY_MARGIN_BALANCE_PCT = 0.03

# --- VolatilityTrailingStop用パラメータ ---
VOLATILITY_TRAILING_ATR_MULTIPLIER = 2.0  # ATR倍率

# 動的ストップロス閾値 (ROI threshold -> SL percent)
# タプルは (min_roi, sl_pct) の順。min_roi は ROI の下限 (例: 0.8 は 80%)
# 評価は閾値が高い順に評価されます。
# Experiment variant A: slightly tighter SL at high ROI and slightly tighter mid bands
DYNAMIC_SL_THRESHOLDS = [
	(0.8, 0.09),
	(0.5, 0.12),
	(0.0, 0.18),
]

# Webhook compatibility constants
SYMBOLS = [
	"BTCUSDT",
	"ETHUSDT",
	"SOLUSDT",
	"POLYXUSDT",
	"DOGEUSDT",
	"SIRENUSDT",
	"RIVERUSDT",
	"HYPEUSDT",
	"XRPUSDT",
	"PEPEUSDT",
	"SHIBUSDT",
	"TSLAUSDT",
	"ENJUSDT",
	"SIBUSDT",
	"PIPPINUSDT",
]
DEFAULT_SYMBOL = "BTCUSDT"
ACCOUNT_BALANCE = 1000.0

# Alert B tuning (Market Regime)
ALERT_B_EMA_FAST = 20
ALERT_B_EMA_SLOW = 50
ALERT_B_BOS_LEN = 5
ALERT_B_VOL_MULTIPLIER = 1.6

# Alert C tuning (Range Rebound)
ALERT_C_EMA_FAST = 20
ALERT_C_EMA_SLOW = 50
ALERT_C_EMA_FLAT_BPS = 4.0
ALERT_C_VOL_WINDOW = 20
ALERT_C_VOL_MAX_STD = 0.0018
ALERT_C_RANGE_LOOKBACK = 20
ALERT_C_RSI_LEN = 14
ALERT_C_RSI_OVERSOLD = 35.0
ALERT_C_RSI_OVERBOUGHT = 65.0
ALERT_C_SWEEP_LOOKBACK = 20

# Doten safety
DOTEN_COOLDOWN_SECONDS = 300
DOTEN_MIN_SIZE_ONLY = True
DOTEN_MIN_SIZE = 0.01

# Alert D tuning (Trigger-separated sniper)
ALERT_D_VOL_WINDOW = 20
ALERT_D_VOL_THRESHOLD = 0.0025
ALERT_D_SESSION_START_UTC = 7
ALERT_D_SESSION_END_UTC = 17
ALERT_D_MICRO_BOS_LEN = 7
ALERT_D_RSI_LEN = 14
ALERT_D_RSI_CROSS_LEVEL = 50.0
ALERT_D_REQUIRE_ALL = True

# Initial weights (cold-start)
ALERT_A_INITIAL_WEIGHT = 1.00
ALERT_B_INITIAL_WEIGHT = 1.05
ALERT_C_INITIAL_WEIGHT = 1.10
ALERT_D_INITIAL_WEIGHT = 1.20

# Planned RR per alert
ALERT_A_PLANNED_RR = 1.3
ALERT_B_PLANNED_RR = 1.6
ALERT_C_PLANNED_RR = 1.2
ALERT_D_PLANNED_RR = 2.0

# --- RL 報酬設計パラメータ (追加) ---
# 重み（報酬成分）
RL_WEIGHT_PNL = 1.0
RL_WEIGHT_MTM = 0.1
RL_WEIGHT_COST = 1.0
RL_WEIGHT_TURN = -0.1
RL_WEIGHT_LIQ = -0.5
RL_WEIGHT_EXPO = -0.5

# 正則化ハイパーパラメータ
RL_LAMBDA_L2 = 1e-4
RL_LAMBDA_SMOOTH = 1e-3
RL_LAMBDA_KL = 1e-2
RL_LAMBDA_DD = 10.0
RL_LAMBDA_ENTROPY = 1e-2

# 安全フック閾値
HEARTBEAT_MAX_AGE = 1.0  # seconds, indicators heartbeat stale threshold
# ドローダウン閾値（デフォルトは既存の PORTFOLIO_MAX_DRAWDOWN を参照可能）
RL_MAX_DRAWDOWN = PORTFOLIO_MAX_DRAWDOWN

