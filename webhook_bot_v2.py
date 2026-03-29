import os
import time
import sqlite3
import traceback
import re
import threading
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from flask import Flask, request, jsonify
from dotenv import load_dotenv

from bot_v2.config import (
    SYMBOLS,
    DEFAULT_SYMBOL,
    ACCOUNT_BALANCE,
    ALERT_A_PLANNED_RR,
    ALERT_B_PLANNED_RR,
    ALERT_C_PLANNED_RR,
    ALERT_D_PLANNED_RR,
)
import bot_v2.config as _config
try:
    from bot_v2.risk.account_balance import get_balance as _get_live_balance
except Exception:
    def _get_live_balance():
        return ACCOUNT_BALANCE

try:
    from bot_v2.market.candles import get_candles
except Exception:
    def get_candles(symbol, timeframe):
        return []
try:
    from bot_v2.market.orderbook import get_orderbook
except Exception:
    def get_orderbook(*args, **kwargs):
        return {}

try:
    from bot_v2.market.tick_data import get_ticks
except Exception:
    def get_ticks(*args, **kwargs):
        return []

try:
    from bot_v2.market.funding_rate import get_funding_rate
except Exception:
    def get_funding_rate(*args, **kwargs):
        return 0.0

try:
    from bot_v2.market.open_interest import get_open_interest
except Exception:
    def get_open_interest(*args, **kwargs):
        return 0.0

try:
    from bot_v2.strategy.indicators_engine import IndicatorsEngine
except Exception:
    class IndicatorsEngine:
        def __init__(self, *args, **kwargs):
            pass

        def evaluate(self, *args, **kwargs):
            return type('IndicatorResult', (), {'score': 0.0})()
try:
    from bot_v2.strategy.market_regime_engine import MarketRegimeEngine
except Exception:
    try:
        from bot_v2.strategy.market_regime_alert_engine import MarketRegimeAlertEngine as MarketRegimeEngine
    except Exception:
        MarketRegimeEngine = None
    if MarketRegimeEngine is None:
        class MarketRegimeEngine:
            def __init__(self, *args, **kwargs):
                pass

            def evaluate(self, *args, **kwargs):
                return {'signal': None, 'selected_alert': None, 'score': 0.0, 'all_results': {}}

            def check_alert(self, *args, **kwargs):
                return {'trend_regime': 'range', 'long_alert': False, 'short_alert': False, 'confidence': 0.0, 'entry_side': None}
try:
    from bot_v2.strategy.multi_timeframe_engine import MultiTimeframeEngine
except Exception:
    class MultiTimeframeEngine:
        def __init__(self, *args, **kwargs):
            pass

        def evaluate(self, *args, **kwargs):
            return type('MultiTimeframeResult', (), {'score': 0.0})()
from bot_v2.strategy.liquidity_sweep_engine import LiquiditySweepEngine
try:
    from bot_v2.strategy.orderblock_engine import OrderBlockEngine
except Exception:
    try:
        from bot_v2.strategy.orderblock_detector import OrderBlockDetector as OrderBlockEngine
    except Exception:
        class OrderBlockEngine:
            def __init__(self, *args, **kwargs):
                pass

            def detect(self, *args, **kwargs):
                return {'bull_ob': False, 'bear_ob': False}

try:
    from bot_v2.ai.signal_weight_engine import SignalWeightEngine
except Exception:
    class SignalWeightEngine:
        def __init__(self, *args, **kwargs):
            pass

        def evaluate(self, *args, **kwargs):
            return {'score': 0.0, 'weights': {}}

try:
    from bot_v2.risk.adaptive_position_sizer import AdaptivePositionSizer
except Exception:
    try:
        from bot_v2.risk.advanced_position_sizer import AdvancedPositionSizer as AdaptivePositionSizer
    except Exception:
        class AdaptivePositionSizer:
            def __init__(self, *args, **kwargs):
                pass

            def size_position(self, *args, **kwargs):
                return 0.0

try:
    from bot_v2.risk.portfolio_risk_engine import PortfolioRiskEngine
except Exception:
    class PortfolioRiskEngine:
        def __init__(self, *args, **kwargs):
            pass

        def evaluate(self, *args, **kwargs):
            return {'risk': 0.0}

from bot_v2.risk.strategy_decision_sizer import StrategyDecisionSizer as LayeredStrategyDecisionSizer

try:
    from bot_v2.execution.trade_executor import execute_trade
except Exception:
    def execute_trade(*args, **kwargs):
        return {'status': 'dry_run'}

try:
    from bot_v2.execution.bitget_client import BitgetClient
except Exception:
    class BitgetClient:
        def __init__(self, *args, **kwargs):
            pass

        def request(self, method, path, params=None):
            normalized = str(path or '')
            if 'all-position' in normalized:
                return {'code': '00000', 'data': []}
            if 'set-leverage' in normalized:
                return {'code': '00000', 'data': {'success': True}}
            return {'code': '00000', 'data': {}}

try:
    from bot_v2.execution.order_manager import close_position
except Exception:
    def close_position(*args, **kwargs):
        return {'status': 'dry_run'}

try:
    from bot_v2.arbitrage.cross_exchange_arbitrage_engine import (
        CrossExchangeArbitrageEngine,
        VenueQuote,
    )
except Exception:
    try:
        from bot_v2.strategy.cross_exchange_arbitrage_engine import (
            CrossExchangeArbitrageEngine,
            VenueQuote,
        )
    except Exception:
        class VenueQuote:
            def __init__(self, *args, **kwargs):
                pass

        class CrossExchangeArbitrageEngine:
            def __init__(self, *args, **kwargs):
                pass

            def evaluate(self, *args, **kwargs):
                return {'signal': None, 'score': 0.0}

try:
    from bot_v2.microstructure.market_microstructure_engine import MarketMicrostructureEngine
except Exception:
    class MarketMicrostructureEngine:
        def __init__(self, *args, **kwargs):
            pass

        def evaluate(self, *args, **kwargs):
            return {'score': 0.0}

try:
    from bot_v2.reinforcement.reinforcement_learning_trader import ReinforcementLearningTrader
except Exception:
    from bot_v2.ai.reinforcement_learning_trader import ReinforcementLearningTrader
from bot_v2.ai.alert_learning_engine import AlertLearningEngine
from bot_v2.models.trade_decision import build_trade_decision as build_structured_trade_decision
from bot_v2.position.position_registry import PositionRegistry as LayeredPositionRegistry
from bot_v2.strategy.alert_bot_engine import AlertBotEngine, candles_to_df as _bots_to_df
from bot_v2.execution.position_exit_engine import PositionExitEngine
from bot_v2.risk.bot_trailing_stop import update_bot_trailing, clear_bot_peak
from bot_v2.strategy.position_lifecycle_engine import PositionLifecycleEngine, build_entry_context


@dataclass
class ManagedPosition:
    symbol: str
    strategy: str
    side: str
    entry_price: float
    size: float
    initial_size: float
    timestamp: float
    max_profit: float = 0.0
    unrealized_pnl: float = 0.0
    partial_taken: list[bool] = field(default_factory=lambda: [False, False, False])
    trade_id: int | None = None
    position_id: str = ''


load_dotenv('/home/linuxuser/.bitget_env')

DRY_RUN = str(os.getenv('DRY_RUN', 'true')).lower() in ('1', 'true', 'yes', 'on')
ENABLE_PHASE45 = str(os.getenv('ENABLE_PHASE45', 'false')).lower() in ('1', 'true', 'yes', 'on')
ENABLE_DOTEN = str(os.getenv('ENABLE_DOTEN', 'false')).lower() in ('1', 'true', 'yes', 'on')
DOTEN_KEEP_BOTH_ENABLED = str(os.getenv('DOTEN_KEEP_BOTH_ENABLED', 'true')).lower() in ('1', 'true', 'yes', 'on')
ENABLE_ORDERBLOCK = str(os.getenv('ENABLE_ORDERBLOCK', 'true')).lower() in ('1', 'true', 'yes', 'on')
PHASE45_MICRO_THRESHOLD = float(os.getenv('PHASE45_MICRO_THRESHOLD', '0.12'))
PHASE45_MICRO_BOOST = float(os.getenv('PHASE45_MICRO_BOOST', '0.25'))
PHASE45_RL_BOOST = float(os.getenv('PHASE45_RL_BOOST', '0.15'))
ORDERBLOCK_BOOST = float(os.getenv('ORDERBLOCK_BOOST', '0.35'))
RL_QTABLE_PATH = os.getenv('RL_QTABLE_PATH', '/home/linuxuser/bot_v2/data/qtable_live.json')
DUPLICATE_TTL_SECONDS = int(os.getenv('DUPLICATE_TTL_SECONDS', '45'))
ERROR_THRESHOLD = int(os.getenv('ERROR_THRESHOLD', '3'))
ERROR_WINDOW_SECONDS = int(os.getenv('ERROR_WINDOW_SECONDS', '300'))


def _resolve_runtime_db_path():
    configured = str(os.getenv('RUNTIME_DB', '') or '').strip()
    if configured:
        if os.name == 'nt' and configured.startswith('/'):
            configured = ''
        else:
            parent = os.path.dirname(configured)
            if parent:
                try:
                    os.makedirs(parent, exist_ok=True)
                except Exception:
                    configured = ''
    if configured:
        return configured
    local_dir = os.path.join(os.path.dirname(__file__), 'database')
    os.makedirs(local_dir, exist_ok=True)
    return os.path.join(local_dir, 'runtime_state.db')


RUNTIME_DB = _resolve_runtime_db_path()
MIN_ENTRY_ATR_RATIO = float(os.getenv('MIN_ENTRY_ATR_RATIO', '0.0007'))
DOTEN_MIN_SCORE = float(os.getenv('DOTEN_MIN_SCORE', '0.55'))
DOTEN_MIN_CONFIDENCE = float(os.getenv('DOTEN_MIN_CONFIDENCE', '0.75'))
DOTEN_MIN_SCORE_BY_ALERT = {
    'alert_a': float(os.getenv('DOTEN_MIN_SCORE_ALERT_A', str(DOTEN_MIN_SCORE))),
    'alert_b': float(os.getenv('DOTEN_MIN_SCORE_ALERT_B', str(DOTEN_MIN_SCORE))),
    'alert_c': float(os.getenv('DOTEN_MIN_SCORE_ALERT_C', str(DOTEN_MIN_SCORE))),
    'alert_d': float(os.getenv('DOTEN_MIN_SCORE_ALERT_D', str(DOTEN_MIN_SCORE))),
}
DOTEN_MIN_CONFIDENCE_BY_ALERT = {
    'alert_a': float(os.getenv('DOTEN_MIN_CONFIDENCE_ALERT_A', str(DOTEN_MIN_CONFIDENCE))),
    'alert_b': float(os.getenv('DOTEN_MIN_CONFIDENCE_ALERT_B', str(DOTEN_MIN_CONFIDENCE))),
    'alert_c': float(os.getenv('DOTEN_MIN_CONFIDENCE_ALERT_C', str(DOTEN_MIN_CONFIDENCE))),
    'alert_d': float(os.getenv('DOTEN_MIN_CONFIDENCE_ALERT_D', str(DOTEN_MIN_CONFIDENCE))),
}
ORDER_SIZE_SCALE = float(os.getenv('ORDER_SIZE_SCALE', '1.00'))
WEBHOOK_STALE_SECONDS = int(os.getenv('WEBHOOK_STALE_SECONDS', '900'))
MIN_ORDER_NOTIONAL_USDT = float(os.getenv('MIN_ORDER_NOTIONAL_USDT', '6.0'))
ORDER_API_MIN_INTERVAL_MS = int(os.getenv('ORDER_API_MIN_INTERVAL_MS', '900'))
DOTEN_REOPEN_DELAY_MS = int(os.getenv('DOTEN_REOPEN_DELAY_MS', '1200'))
EXCHANGE_429_COOLDOWN_SECONDS = int(os.getenv('EXCHANGE_429_COOLDOWN_SECONDS', '20'))
OPPOSITE_NOT_DOTEN_SIZE_SCALE = float(os.getenv('OPPOSITE_NOT_DOTEN_SIZE_SCALE', '0.50'))
ENTRY_MARGIN_BALANCE_PCT = float(os.getenv('ENTRY_MARGIN_BALANCE_PCT', str(getattr(_config, 'ENTRY_MARGIN_BALANCE_PCT', 0.03))))
BASE_ORDER_BALANCE_PCT = float(os.getenv('BASE_ORDER_BALANCE_PCT', '0.10'))
MIN_ENTRY_BALANCE_PCT = float(os.getenv('MIN_ENTRY_BALANCE_PCT', '0.10'))
ADDON_MAX_SAME_SIDE_DEFAULT = int(os.getenv('ADDON_MAX_SAME_SIDE', '2'))
ADDON_SCALE_LEVEL2_DEFAULT = float(os.getenv('ADDON_SCALE_LEVEL2', '0.60'))
ADDON_SCALE_LEVEL3_DEFAULT = float(os.getenv('ADDON_SCALE_LEVEL3', '0.35'))
ADDON_MAX_SAME_SIDE_BY_ALERT = {
    'alert_a': int(os.getenv('ALERT_A_ADDON_MAX_SAME_SIDE', str(ADDON_MAX_SAME_SIDE_DEFAULT))),
    'alert_b': int(os.getenv('ALERT_B_ADDON_MAX_SAME_SIDE', str(ADDON_MAX_SAME_SIDE_DEFAULT))),
    'alert_c': int(os.getenv('ALERT_C_ADDON_MAX_SAME_SIDE', str(ADDON_MAX_SAME_SIDE_DEFAULT))),
    'alert_d': int(os.getenv('ALERT_D_ADDON_MAX_SAME_SIDE', str(ADDON_MAX_SAME_SIDE_DEFAULT))),
}
ADDON_SCALE_LEVEL2_BY_ALERT = {
    'alert_a': float(os.getenv('ALERT_A_ADDON_SCALE_LEVEL2', str(ADDON_SCALE_LEVEL2_DEFAULT))),
    'alert_b': float(os.getenv('ALERT_B_ADDON_SCALE_LEVEL2', str(ADDON_SCALE_LEVEL2_DEFAULT))),
    'alert_c': float(os.getenv('ALERT_C_ADDON_SCALE_LEVEL2', str(ADDON_SCALE_LEVEL2_DEFAULT))),
    'alert_d': float(os.getenv('ALERT_D_ADDON_SCALE_LEVEL2', str(ADDON_SCALE_LEVEL2_DEFAULT))),
}
ADDON_SCALE_LEVEL3_BY_ALERT = {
    'alert_a': float(os.getenv('ALERT_A_ADDON_SCALE_LEVEL3', str(ADDON_SCALE_LEVEL3_DEFAULT))),
    'alert_b': float(os.getenv('ALERT_B_ADDON_SCALE_LEVEL3', str(ADDON_SCALE_LEVEL3_DEFAULT))),
    'alert_c': float(os.getenv('ALERT_C_ADDON_SCALE_LEVEL3', str(ADDON_SCALE_LEVEL3_DEFAULT))),
    'alert_d': float(os.getenv('ALERT_D_ADDON_SCALE_LEVEL3', str(ADDON_SCALE_LEVEL3_DEFAULT))),
}
LEARNING_ADAPTIVE_EXIT_ENABLED = str(os.getenv('LEARNING_ADAPTIVE_EXIT_ENABLED', 'true')).lower() in ('1', 'true', 'yes', 'on')
LEARNING_EXIT_MIN_CONFIDENCE = float(os.getenv('LEARNING_EXIT_MIN_CONFIDENCE', '0.72'))
LEARNING_REVERSE_MIN_CONFIDENCE = float(os.getenv('LEARNING_REVERSE_MIN_CONFIDENCE', '0.80'))
LEARNING_REVERSE_MIN_SCORE_GAP = float(os.getenv('LEARNING_REVERSE_MIN_SCORE_GAP', '0.03'))
LEARNING_REVERSE_MIN_EDGE = float(os.getenv('LEARNING_REVERSE_MIN_EDGE', '0.04'))
MONITOR_AUTOPOLL_ENABLED = str(os.getenv('MONITOR_AUTOPOLL_ENABLED', 'true')).lower() in ('1', 'true', 'yes', 'on')
MONITOR_AUTOPOLL_INTERVAL_SECONDS = int(os.getenv('MONITOR_AUTOPOLL_INTERVAL_SECONDS', '20'))
MONITOR_SCHEDULER_LEASE_SECONDS = int(os.getenv('MONITOR_SCHEDULER_LEASE_SECONDS', '45'))
MONITOR_MIN_INTERVAL_SECONDS = int(os.getenv('MONITOR_MIN_INTERVAL_SECONDS', '8'))
MONITOR_RUN_TIMEOUT_SECONDS = int(os.getenv('MONITOR_RUN_TIMEOUT_SECONDS', '25'))
MONITOR_RECONCILE_MISSING_EXCHANGE = str(os.getenv('MONITOR_RECONCILE_MISSING_EXCHANGE', 'true')).lower() in ('1', 'true', 'yes', 'on')
PROFILE_PARTIAL_PRECEDES_LIFECYCLE_CLOSE = str(os.getenv('PROFILE_PARTIAL_PRECEDES_LIFECYCLE_CLOSE', 'true')).lower() in ('1', 'true', 'yes', 'on')
PROFILE_PARTIAL_PRECEDENCE_REASONS = tuple(
    token.strip().lower()
    for token in str(os.getenv('PROFILE_PARTIAL_PRECEDENCE_REASONS', 'momentum_kill_volume_drop,time_decay_exit')).split(',')
    if token.strip()
)
POSITION_REGISTRY_SYNC_ON_STARTUP = str(os.getenv('POSITION_REGISTRY_SYNC_ON_STARTUP', 'true')).lower() in ('1', 'true', 'yes', 'on')
NEWS_FEED_ENABLED = str(os.getenv('NEWS_FEED_ENABLED', 'true')).lower() in ('1', 'true', 'yes', 'on')
NEWS_FEED_TTL_SECONDS = int(os.getenv('NEWS_FEED_TTL_SECONDS', '300'))
NEWS_FEED_TIMEOUT_SECONDS = float(os.getenv('NEWS_FEED_TIMEOUT_SECONDS', '2.2'))
LEVERAGE_AUTO_ADJUST_ENABLED = str(os.getenv('LEVERAGE_AUTO_ADJUST_ENABLED', 'true')).lower() in ('1', 'true', 'yes', 'on')
LEVERAGE_REQUIRE_SUCCESS = str(os.getenv('LEVERAGE_REQUIRE_SUCCESS', 'true')).lower() in ('1', 'true', 'yes', 'on')
LEVERAGE_MIN = int(os.getenv('LEVERAGE_MIN', '12'))
LEVERAGE_MAX = int(os.getenv('LEVERAGE_MAX', '67'))
LEVERAGE_DEFAULT = int(os.getenv('LEVERAGE_DEFAULT', '40'))
LEVERAGE_SOL_MAX = int(os.getenv('LEVERAGE_SOL_MAX', '67'))
LEVERAGE_BTC_MAX = int(os.getenv('LEVERAGE_BTC_MAX', str(LEVERAGE_MAX)))
LEVERAGE_ETH_MAX = int(os.getenv('LEVERAGE_ETH_MAX', str(LEVERAGE_MAX)))
LEVERAGE_DOGE_MAX = int(os.getenv('LEVERAGE_DOGE_MAX', str(LEVERAGE_MAX)))
LEVERAGE_POLYX_MAX = int(os.getenv('LEVERAGE_POLYX_MAX', str(LEVERAGE_MAX)))
LEVERAGE_SIREN_MAX = int(os.getenv('LEVERAGE_SIREN_MAX', '20'))
LEVERAGE_RIVER_MAX = int(os.getenv('LEVERAGE_RIVER_MAX', '20'))
LEVERAGE_HYPE_MAX = int(os.getenv('LEVERAGE_HYPE_MAX', str(LEVERAGE_MAX)))
LEVERAGE_XRP_MAX = int(os.getenv('LEVERAGE_XRP_MAX', str(LEVERAGE_MAX)))
LEVERAGE_PEPE_MAX = int(os.getenv('LEVERAGE_PEPE_MAX', str(LEVERAGE_MAX)))
LEVERAGE_SHIB_MAX = int(os.getenv('LEVERAGE_SHIB_MAX', str(LEVERAGE_MAX)))
LEVERAGE_TSLA_MAX = int(os.getenv('LEVERAGE_TSLA_MAX', str(LEVERAGE_MAX)))
LEVERAGE_ENJ_MAX = int(os.getenv('LEVERAGE_ENJ_MAX', str(LEVERAGE_MAX)))
LEVERAGE_RETRY_ON_40797 = str(os.getenv('LEVERAGE_RETRY_ON_40797', 'true')).lower() in ('1', 'true', 'yes', 'on')
LEVERAGE_40797_FALLBACK = int(os.getenv('LEVERAGE_40797_FALLBACK', '20'))
LEVERAGE_SET_EXEMPT_SYMBOLS = {
    str(token or '').strip().upper()
    for token in str(os.getenv('LEVERAGE_SET_EXEMPT_SYMBOLS', 'POLYXUSDT')).split(',')
    if str(token or '').strip()
}
MONITOR_DEFAULT_ALERT_PROFILE = str(os.getenv('MONITOR_DEFAULT_ALERT_PROFILE', 'alert_d')).strip().lower()
MONITOR_PROFILE_PRIORITY = 'learning_state'


def _parse_symbol_profile_map(raw: str) -> dict:
    mapping = {}
    allowed = {'alert_a', 'alert_b', 'alert_c', 'alert_d'}
    for token in str(raw or '').split(','):
        chunk = str(token or '').strip()
        if not chunk or ':' not in chunk:
            continue
        sym, profile = chunk.split(':', 1)
        symbol = str(sym or '').strip().upper()
        alert = str(profile or '').strip().lower()
        if alert not in allowed:
            alert = 'alert_d'
        if symbol:
            mapping[symbol] = alert
    return mapping


MONITOR_SYMBOL_PROFILE_MAP = _parse_symbol_profile_map(os.getenv('MONITOR_SYMBOL_PROFILE_MAP', ''))
DAILY_DD_GUARD_ENABLED = str(os.getenv('DAILY_DD_GUARD_ENABLED', 'true')).lower() in ('1', 'true', 'yes', 'on')
DAILY_DD_STOP_PCT = float(os.getenv('DAILY_DD_STOP_PCT', '0.05'))
VOLUME_DROP_LOOKBACK = max(3, int(os.getenv('VOLUME_DROP_LOOKBACK', '6')))
VOLUME_DROP_THRESHOLD = float(os.getenv('VOLUME_DROP_THRESHOLD', '0.55'))
ATR_EXPAND_SHORT_PERIOD = max(3, int(os.getenv('ATR_EXPAND_SHORT_PERIOD', '7')))
ATR_EXPAND_LONG_PERIOD = max(ATR_EXPAND_SHORT_PERIOD + 1, int(os.getenv('ATR_EXPAND_LONG_PERIOD', '21')))
ATR_EXPAND_RATIO_THRESHOLD = float(os.getenv('ATR_EXPAND_RATIO_THRESHOLD', '1.20'))

NEWS_FEED_URLS = [
    'https://feeds.feedburner.com/CoinDesk',
    'https://cointelegraph.com/rss',
]

_NEWS_CACHE = {'fetched_at': 0, 'items': []}
_MONITOR_SCHEDULER_STARTED_PID = 0

app = Flask(__name__)

indicators = IndicatorsEngine()
regime_engine = MarketRegimeEngine()
mtf_engine = MultiTimeframeEngine()
sweep_engine = LiquiditySweepEngine()
orderblock_engine = OrderBlockEngine()
weight_engine = SignalWeightEngine()
position_sizer = AdaptivePositionSizer()
portfolio_engine = PortfolioRiskEngine()
exchange_client = BitgetClient()

micro_engine = MarketMicrostructureEngine()
arb_engine = CrossExchangeArbitrageEngine()
rl_trader = ReinforcementLearningTrader()
alert_bot_engine = AlertBotEngine()
lifecycle_engine = PositionLifecycleEngine()
profile_exit_engine = PositionExitEngine()


def _learning_engine():
    return AlertLearningEngine()


decision_sizer = LayeredStrategyDecisionSizer(
    strategy_multiplier_resolver=lambda strategy_name: _strategy_size_multiplier(strategy_name),
    result_recorder=lambda strategy_name, profit, roi=None: _learning_engine().record_strategy_result(strategy_name, float(profit)),
    strategy_name_normalizer=lambda strategy_name: _normalize_alert_name(strategy_name),
    entry_margin_balance_pct=ENTRY_MARGIN_BALANCE_PCT,
    order_size_scale=1.0,
)
position_registry = LayeredPositionRegistry()


def _fetch_news_items(limit=24):
    now_ts = int(time.time())
    cache_age = now_ts - int(_NEWS_CACHE.get('fetched_at', 0) or 0)
    if cache_age >= 0 and cache_age <= NEWS_FEED_TTL_SECONDS:
        return list(_NEWS_CACHE.get('items') or [])

    items = []
    for url in NEWS_FEED_URLS:
        try:
            with urllib.request.urlopen(url, timeout=NEWS_FEED_TIMEOUT_SECONDS) as response:
                xml_bytes = response.read()
            root = ET.fromstring(xml_bytes)
            channel_items = root.findall('.//item')
            for node in channel_items[: max(1, int(limit))]:
                title = (node.findtext('title') or '').strip()
                description = (node.findtext('description') or '').strip()
                if title or description:
                    items.append({'title': title, 'description': description})
        except Exception:
            continue

    dedup = []
    seen = set()
    for item in items:
        key = f"{item.get('title', '')}|{item.get('description', '')[:140]}"
        if key in seen:
            continue
        seen.add(key)
        dedup.append(item)
    dedup = dedup[: max(1, int(limit))]
    _NEWS_CACHE['fetched_at'] = now_ts
    _NEWS_CACHE['items'] = dedup
    return dedup


def _news_score_from_text(text: str) -> float:
    positive_words = ('surge', 'rally', 'gain', 'approval', 'adoption', 'bull', 'breakout', 'up', 'record')
    negative_words = ('drop', 'hack', 'ban', 'lawsuit', 'liquidation', 'bear', 'down', 'crash', 'outflow')
    score = 0.0
    lower = str(text or '').lower()
    for token in positive_words:
        if token in lower:
            score += 1.0
    for token in negative_words:
        if token in lower:
            score -= 1.0
    return score


def _symbol_news_sentiment(symbol: str) -> float:
    items = _fetch_news_items(limit=30) if NEWS_FEED_ENABLED else []
    if not items:
        return 0.0

    base = str(symbol or '').replace('USDT', '').replace('USD', '').upper()
    aliases = {
        'BTC': ('btc', 'bitcoin'),
        'ETH': ('eth', 'ethereum'),
        'SOL': ('sol', 'solana'),
        'DOGE': ('doge', 'dogecoin'),
        'POLYX': ('polyx', 'polymesh'),
        'SIREN': ('siren',),
        'RIVER': ('river',),
        'HYPE': ('hype',),
        'XRP': ('xrp', 'ripple'),
        'PEPE': ('pepe',),
        'SHIB': ('shib', 'shiba'),
        'TSLA': ('tsla',),
        'ENJ': ('enj', 'enjin'),
    }
    keys = aliases.get(base, (base.lower(),))

    total = 0.0
    matched = 0
    for item in items:
        text = f"{item.get('title', '')} {item.get('description', '')}"
        lower = text.lower()
        if not any(k in lower for k in keys):
            continue
        total += _news_score_from_text(text)
        matched += 1

    if matched <= 0:
        market_total = sum(_news_score_from_text(f"{it.get('title', '')} {it.get('description', '')}") for it in items[:20])
        return max(-0.15, min(0.15, market_total / max(1, len(items[:20])) * 0.04))

    avg = total / matched
    return max(-0.20, min(0.20, avg * 0.05))


def _news_bias_for_alerts(symbol: str) -> dict:
    sentiment = _symbol_news_sentiment(symbol)
    return {
        'alert_a': sentiment * 0.40,
        'alert_b': sentiment * 0.70,
        'alert_c': sentiment * 0.35,
        'alert_d': sentiment * 0.55,
    }


def _evaluate_bots(symbol):
    try:
        c1m  = get_candles(symbol, '1m')
        c5m  = get_candles(symbol, '5m')
        c10m = get_candles(symbol, '10m')
        c15m = get_candles(symbol, '15m')
        c30m = get_candles(symbol, '30m')
        c1h  = get_candles(symbol, '1h')
        c1d  = get_candles(symbol, '1d')
        if not c15m:
            return {'signal': None, 'selected_alert': None, 'score': 0.0, 'all_results': {}}
        news_bias = _news_bias_for_alerts(symbol)
        return alert_bot_engine.evaluate(
            c1m, c5m, c10m, c15m, c30m, c1h, c1d,
            news_bias=news_bias, symbol=symbol)
    except Exception as exc:
        app.logger.warning('EVALUATE_BOTS_ERROR symbol=%s err=%s', symbol, str(exc))
        return {'signal': None, 'selected_alert': None, 'score': 0.0, 'all_results': {}}


def _get_active_bot_name(symbol, side=None):
    try:
        latest_strategy = position_registry.latest_strategy(symbol, side=side)
        if latest_strategy:
            return latest_strategy
    except Exception:
        pass
    return 'alert_d'


def _get_learning_open_alert_name(symbol, side=None):
    try:
        return position_registry.latest_strategy(symbol, side=side)
    except Exception:
        return None


def _is_order_success(resp):
    return isinstance(resp, dict) and str(resp.get('code', '')) == '00000'


def _normalize_alert_name(value):
    alert = str(value or 'alert_d').strip().lower()
    return alert if alert in ('alert_a', 'alert_b', 'alert_c', 'alert_d') else 'alert_d'


def _resolve_monitor_bot_name(symbol: str, hold_side: str, tracked_bot: str | None = None) -> tuple[str, str]:
    learned = _get_learning_open_alert_name(symbol, side=_position_signal_from_hold_side(hold_side))
    tracked = _normalize_alert_name(tracked_bot) if tracked_bot else None
    mapped_raw = MONITOR_SYMBOL_PROFILE_MAP.get(str(symbol or '').upper())
    mapped = _normalize_alert_name(mapped_raw) if mapped_raw else None

    if learned in ('alert_a', 'alert_b', 'alert_c', 'alert_d'):
        return learned, 'learning_state'
    if tracked in ('alert_a', 'alert_b', 'alert_c', 'alert_d'):
        return tracked, 'tracked_lifecycle'
    if mapped in ('alert_a', 'alert_b', 'alert_c', 'alert_d'):
        return mapped, 'symbol_profile_map'

    default_profile = _normalize_alert_name(MONITOR_DEFAULT_ALERT_PROFILE)
    return default_profile, 'default_profile'


def _strategy_metrics(alert_name):
    summary = _learning_engine().get_alert_summary()
    return summary.get(alert_name, {'weight': 1.0, 'win_rate': 0.5, 'avg_rr': 1.0, 'max_dd': 0.0})


def _alert_losing_streak(alert_name, depth=6):
    try:
        trades = _learning_engine().state.get('trades', [])
        filtered = [t for t in trades if _normalize_alert_name(t.get('alert_name') or t.get('alert')) == alert_name and t.get('result') in ('win', 'loss')]
        if not filtered:
            return 0
        recent = sorted(filtered, key=lambda t: int(t.get('trade_id', 0)), reverse=True)[: max(1, int(depth))]
        streak = 0
        for t in recent:
            if t.get('result') == 'loss':
                streak += 1
            else:
                break
        return streak
    except Exception:
        return 0


def _strategy_size_multiplier(alert_name):
    metrics = _strategy_metrics(alert_name)
    weight = _safe_float(metrics.get('weight'), 1.0)
    win_rate = _safe_float(metrics.get('win_rate'), 0.5)
    avg_rr = _safe_float(metrics.get('avg_rr'), 1.0)
    max_dd = _safe_float(metrics.get('max_dd'), 0.0)
    raw = 0.85 + (weight - 1.0) * 0.35 + (win_rate - 0.5) * 0.30 + (avg_rr - 1.0) * 0.12 - max_dd * 0.30
    if alert_name == 'alert_a':
        losing_streak = _alert_losing_streak(alert_name)
        if losing_streak > 0:
            raw *= max(0.70, 1.0 - 0.10 * min(3, losing_streak))
    return max(0.65, min(1.50, raw))


def _planned_rr_for_alert(alert_name):
    planned_rr_map = {
        'alert_a': ALERT_A_PLANNED_RR,
        'alert_b': ALERT_B_PLANNED_RR,
        'alert_c': ALERT_C_PLANNED_RR,
        'alert_d': ALERT_D_PLANNED_RR,
    }
    return float(planned_rr_map.get(_normalize_alert_name(alert_name), ALERT_D_PLANNED_RR))


def _build_trade_decision(bot_eval, signal, fallback_alert_name=None):
    return build_structured_trade_decision(bot_eval, signal, fallback_alert_name=fallback_alert_name)


def _position_signal_from_hold_side(hold_side):
    hold = str(hold_side or '').strip().lower()
    if hold in ('long', 'buy', 'open_long'):
        return 'BUY'
    if hold in ('short', 'sell', 'open_short'):
        return 'SELL'
    return None


def _candidate_for_alert(candidates, alert_name):
    normalized = _normalize_alert_name(alert_name)
    if not isinstance(candidates, list):
        return None
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        if _normalize_alert_name(candidate.get('alert')) == normalized:
            return candidate
    return None


def _learning_strength(metrics):
    if not isinstance(metrics, dict):
        return 0.0
    weight = _safe_float(metrics.get('weight'), 1.0)
    win_rate = _safe_float(metrics.get('win_rate'), 0.5)
    avg_roi = _safe_float(metrics.get('avg_roi'), 0.0)
    max_dd = _safe_float(metrics.get('max_dd'), 0.0)

    roi_term = max(-0.05, min(0.05, avg_roi))
    dd_term = max(0.0, min(0.12, max_dd))
    return float((weight * (0.60 + 0.40 * win_rate)) + roi_term - (dd_term * 0.50))


def _learning_override_decision(active_alert, hold_side, bot_eval):
    hold_signal = _position_signal_from_hold_side(hold_side)
    if hold_signal is None or not isinstance(bot_eval, dict):
        return {'action': 'hold', 'reason': 'learning_override_unavailable'}

    target_signal = str(bot_eval.get('signal') or '').upper()
    if target_signal not in ('BUY', 'SELL'):
        return {'action': 'hold', 'reason': 'learning_override_no_signal'}
    if target_signal == hold_signal:
        return {'action': 'hold', 'reason': 'learning_override_aligned'}

    target_alert = _normalize_alert_name(bot_eval.get('selected_alert'))
    confidence = _safe_float(bot_eval.get('confidence'), 0.0)
    score = _safe_float(bot_eval.get('score'), 0.0)
    thresholds = bot_eval.get('thresholds') if isinstance(bot_eval.get('thresholds'), dict) else {}
    min_required = _safe_float(thresholds.get(target_alert), 0.0)
    if score < min_required:
        return {
            'action': 'hold',
            'reason': 'learning_override_score_below_threshold',
            'target_signal': target_signal,
            'target_alert': target_alert,
            'confidence': confidence,
            'score': score,
            'required_score': min_required,
        }

    summary = _learning_engine().get_alert_summary()
    current_alert = _normalize_alert_name(active_alert)
    current_metrics = summary.get(current_alert, {}) if isinstance(summary, dict) else {}
    target_metrics = summary.get(target_alert, {}) if isinstance(summary, dict) else {}

    current_candidate = _candidate_for_alert(bot_eval.get('candidates'), current_alert) or {}
    current_score = _safe_float(current_candidate.get('score'), 0.0)
    score_gap = score - current_score

    strength_edge = _learning_strength(target_metrics) - _learning_strength(current_metrics)

    if (
        confidence >= LEARNING_REVERSE_MIN_CONFIDENCE
        and score_gap >= LEARNING_REVERSE_MIN_SCORE_GAP
        and strength_edge >= LEARNING_REVERSE_MIN_EDGE
    ):
        return {
            'action': 'reverse',
            'reason': 'learning_override_reverse',
            'target_signal': target_signal,
            'target_alert': target_alert,
            'confidence': confidence,
            'score': score,
            'score_gap': score_gap,
            'strength_edge': strength_edge,
        }

    if confidence >= LEARNING_EXIT_MIN_CONFIDENCE and strength_edge >= 0.0:
        return {
            'action': 'close',
            'reason': 'learning_override_exit',
            'target_signal': target_signal,
            'target_alert': target_alert,
            'confidence': confidence,
            'score': score,
            'score_gap': score_gap,
            'strength_edge': strength_edge,
        }

    return {
        'action': 'hold',
        'reason': 'learning_override_hold',
        'target_signal': target_signal,
        'target_alert': target_alert,
        'confidence': confidence,
        'score': score,
        'score_gap': score_gap,
        'strength_edge': strength_edge,
    }


def _entry_context_from_eval(bot_eval, signal, alert_name=None):
    if alert_name:
        selected_alert = _normalize_alert_name(alert_name)
    else:
        selected_alert = _normalize_alert_name((bot_eval or {}).get('selected_alert'))
    
    style_map = {'alert_a': 'reversal', 'alert_b': 'trend', 'alert_c': 'reversal', 'alert_d': 'breakout'}
    style = style_map.get(selected_alert, 'breakout')
    
    atr = _safe_float((bot_eval or {}).get('atr'), 0.0) if bot_eval else 0.0
    volatility = 'high' if atr > 0 else 'unknown'
    liquidity = 'sweep' if bot_eval and any(c.get('alert') == 'alert_a' for c in (bot_eval.get('candidates') or [])) else 'normal'
    return build_entry_context(
        regime=style,
        signal=f'{selected_alert}_{signal}',
        volatility=volatility,
        liquidity=liquidity,
        score=_safe_float((bot_eval or {}).get('score'), 0.0) if bot_eval else 0.0,
        confidence=_safe_float((bot_eval or {}).get('confidence'), 0.0) if bot_eval else 0.0,
    )


def _clamp(value, lo, hi):
    return max(lo, min(hi, value))


def _symbol_leverage_cap(symbol: str) -> int:
    sym = str(symbol or '').upper()
    caps = {
        'BTCUSDT': LEVERAGE_BTC_MAX,
        'ETHUSDT': LEVERAGE_ETH_MAX,
        'SOLUSDT': LEVERAGE_SOL_MAX,
        'DOGEUSDT': LEVERAGE_DOGE_MAX,
        'POLYXUSDT': LEVERAGE_POLYX_MAX,
        'SIRENUSDT': LEVERAGE_SIREN_MAX,
        'RIVERUSDT': LEVERAGE_RIVER_MAX,
        'HYPEUSDT': LEVERAGE_HYPE_MAX,
        'XRPUSDT': LEVERAGE_XRP_MAX,
        'PEPEUSDT': LEVERAGE_PEPE_MAX,
        'SHIBUSDT': LEVERAGE_SHIB_MAX,
        'TSLAUSDT': LEVERAGE_TSLA_MAX,
        'ENJUSDT': LEVERAGE_ENJ_MAX,
    }
    return max(1, int(caps.get(sym, LEVERAGE_MAX)))


def _target_leverage(symbol: str, bot_eval: dict | None, atr_ratio: float = 0.0) -> int:
    confidence = _safe_float((bot_eval or {}).get('confidence'), 0.5) if isinstance(bot_eval, dict) else 0.5
    conf_score = _clamp(confidence, 0.0, 1.0)

    if atr_ratio > 0:
        vol_score = _clamp((0.012 - atr_ratio) / 0.012, 0.0, 1.0)
    else:
        vol_score = 0.5

    symbol_cap = _symbol_leverage_cap(symbol)
    effective_min = min(max(1, int(LEVERAGE_MIN)), int(symbol_cap))
    dynamic = effective_min + (symbol_cap - effective_min) * (0.45 * conf_score + 0.55 * vol_score)
    raw_target = int(round(dynamic))

    target = _clamp(raw_target, effective_min, symbol_cap)
    if target <= 0:
        target = max(1, min(int(symbol_cap), int(LEVERAGE_DEFAULT)))
    return int(target)


def _apply_symbol_leverage(symbol: str, target_leverage: int):
    target = max(1, int(target_leverage))

    body_primary = {
        'symbol': symbol,
        'productType': 'USDT-FUTURES',
        'marginCoin': 'USDT',
        'leverage': str(target),
    }
    primary = _execute_exchange_call(
        'set_leverage',
        lambda: exchange_client.request('POST', '/api/v2/mix/account/set-leverage', body_primary),
    )
    if _is_order_success(primary):
        return primary

    body_fallback = {
        'symbol': symbol,
        'productType': 'USDT-FUTURES',
        'marginCoin': 'USDT',
        'longLeverage': str(target),
        'shortLeverage': str(target),
    }
    fallback = _execute_exchange_call(
        'set_leverage_dual',
        lambda: exchange_client.request('POST', '/api/v2/mix/account/set-leverage', body_fallback),
    )
    return fallback


def _prepare_entry_leverage(symbol: str, bot_eval: dict | None, atr_ratio: float = 0.0):
    if not LEVERAGE_AUTO_ADJUST_ENABLED:
        return {
            'enabled': False,
            'applied': False,
            'target_leverage': None,
            'response': None,
            'reason': 'disabled',
        }

    target = _target_leverage(symbol=symbol, bot_eval=bot_eval, atr_ratio=atr_ratio)
    sym = str(symbol or '').upper()
    if sym in LEVERAGE_SET_EXEMPT_SYMBOLS:
        return {
            'enabled': True,
            'applied': True,
            'target_leverage': int(target),
            'symbol_cap': int(_symbol_leverage_cap(symbol)),
            'response': {'code': 'SKIPPED', 'msg': 'symbol exempt from leverage set'},
            'reason': 'symbol_exempt',
        }
    response = _apply_symbol_leverage(symbol=symbol, target_leverage=target)
    success = _is_order_success(response)
    applied_leverage = int(target)

    if (not success) and LEVERAGE_RETRY_ON_40797:
        code = str((response or {}).get('code', ''))
        msg = str((response or {}).get('msg', '')).lower()
        if code == '40797' or 'exceeded the maximum settable leverage' in msg:
            symbol_cap = int(_symbol_leverage_cap(symbol))
            fallback_target = max(1, min(symbol_cap, LEVERAGE_40797_FALLBACK, int(target)))
            if fallback_target != int(target):
                retry_response = _apply_symbol_leverage(symbol=symbol, target_leverage=fallback_target)
                if _is_order_success(retry_response):
                    response = {
                        'code': '00000',
                        'msg': 'success_after_fallback',
                        'target_leverage': int(target),
                        'fallback_leverage': int(fallback_target),
                        'initial_response': response,
                        'retry_response': retry_response,
                    }
                    success = True
                    applied_leverage = int(fallback_target)
                else:
                    response = {
                        'code': str((retry_response or {}).get('code', code)),
                        'msg': 'fallback_failed',
                        'target_leverage': int(target),
                        'fallback_leverage': int(fallback_target),
                        'initial_response': response,
                        'retry_response': retry_response,
                    }

    return {
        'enabled': True,
        'applied': bool(success),
        'target_leverage': int(target),
        'applied_leverage': int(applied_leverage),
        'symbol_cap': int(_symbol_leverage_cap(symbol)),
        'response': response,
        'reason': 'applied' if success else 'apply_failed',
    }


def _doten_thresholds_for_alert(alert_name):
    normalized = _normalize_alert_name(alert_name)
    min_score = _safe_float(DOTEN_MIN_SCORE_BY_ALERT.get(normalized), DOTEN_MIN_SCORE)
    min_confidence = _safe_float(DOTEN_MIN_CONFIDENCE_BY_ALERT.get(normalized), DOTEN_MIN_CONFIDENCE)
    return {
        'alert_name': normalized,
        'min_score': min_score,
        'min_confidence': min_confidence,
    }


def _allow_doten_transition(bot_eval, alert_name=None):
    if not bot_eval:
        return False
    thresholds = _doten_thresholds_for_alert(alert_name or (bot_eval or {}).get('selected_alert'))
    return (
        _safe_float(bot_eval.get('score'), 0.0) >= _safe_float(thresholds.get('min_score'), DOTEN_MIN_SCORE)
        and _safe_float(bot_eval.get('confidence'), 0.0) >= _safe_float(thresholds.get('min_confidence'), DOTEN_MIN_CONFIDENCE)
    )


def _addon_sizing_rule(alert_name, same_side_count):
    normalized = _normalize_alert_name(alert_name)
    max_same_side = max(1, int(ADDON_MAX_SAME_SIDE_BY_ALERT.get(normalized, ADDON_MAX_SAME_SIDE_DEFAULT)))
    if same_side_count >= max_same_side:
        return {
            'allowed': False,
            'size_scale': 0.0,
            'reason': 'same_side_addon_limit',
            'same_side_count': int(same_side_count),
            'max_same_side': int(max_same_side),
            'normalized_alert': normalized,
        }

    if same_side_count <= 0:
        size_scale = 1.0
    elif same_side_count == 1:
        size_scale = _safe_float(ADDON_SCALE_LEVEL2_BY_ALERT.get(normalized), ADDON_SCALE_LEVEL2_DEFAULT)
    else:
        size_scale = _safe_float(ADDON_SCALE_LEVEL3_BY_ALERT.get(normalized), ADDON_SCALE_LEVEL3_DEFAULT)

    size_scale = max(0.0, min(1.0, size_scale))
    return {
        'allowed': True,
        'size_scale': size_scale,
        'reason': 'ok',
        'same_side_count': int(same_side_count),
        'max_same_side': int(max_same_side),
        'normalized_alert': normalized,
    }


def _log_webhook_block(reason, symbol, **kwargs):
    try:
        extras = ' '.join([f'{k}={v}' for k, v in kwargs.items()])
        app.logger.info('WEBHOOK_BLOCK reason=%s symbol=%s %s', reason, symbol, extras)
    except Exception:
        pass


def _close_latest_open_learning_trade(symbol, roi=0.0):
    engine = _learning_engine()
    trades = engine.state.get('trades', [])
    target = None
    for trade in trades:
        if trade.get('symbol') != symbol:
            continue
        if trade.get('result') != 'open':
            continue
        if target is None or int(trade.get('trade_id', 0)) > int(target.get('trade_id', 0)):
            target = trade
    if not target:
        return None
    trade_id = int(target.get('trade_id', 0))
    rr = float(target.get('rr') or 0.0)
    engine.close_trade(trade_id=trade_id, roi=float(roi), rr=rr)
    return trade_id


def _close_matching_learning_trades(symbol, roi=0.0, strategy_name=None, side=None):
    engine = _learning_engine()
    normalized_symbol = str(symbol or '').upper()
    normalized_strategy = _normalize_alert_name(strategy_name) if strategy_name else None
    normalized_side = str(side or '').strip().lower()
    if normalized_side in ('buy', 'long', 'open_long', 'BUY'):
        normalized_side = 'buy'
    elif normalized_side in ('sell', 'short', 'open_short', 'SELL'):
        normalized_side = 'sell'
    else:
        normalized_side = None

    targets = []
    for trade in engine.state.get('trades', []):
        if str(trade.get('symbol') or '').upper() != normalized_symbol:
            continue
        if trade.get('result') != 'open':
            continue
        trade_strategy = _normalize_alert_name(trade.get('alert_name') or trade.get('alert'))
        trade_side = str(trade.get('side') or '').strip().lower()
        if trade_side in ('long', 'open_long'):
            trade_side = 'buy'
        elif trade_side in ('short', 'open_short'):
            trade_side = 'sell'
        if normalized_strategy and trade_strategy != normalized_strategy:
            continue
        if normalized_side and trade_side != normalized_side:
            continue
        targets.append(trade)

    closed_ids = []
    for trade in sorted(targets, key=lambda item: int(item.get('trade_id', 0))):
        trade_id = int(trade.get('trade_id', 0))
        rr = float(trade.get('rr') or 0.0)
        try:
            if engine.close_trade(trade_id=trade_id, roi=float(roi), rr=rr):
                closed_ids.append(trade_id)
        except Exception:
            continue
    return closed_ids


def _find_matching_learning_trade(symbol, strategy_name=None, side=None, size=None):
    engine = _learning_engine()
    normalized_symbol = str(symbol or '').upper()
    normalized_strategy = _normalize_alert_name(strategy_name) if strategy_name else None
    normalized_side = str(side or '').strip().lower()
    if normalized_side in ('buy', 'long', 'open_long', 'BUY'):
        normalized_side = 'buy'
    elif normalized_side in ('sell', 'short', 'open_short', 'SELL'):
        normalized_side = 'sell'
    else:
        normalized_side = None

    target_size = max(0.0, _safe_float(size, 0.0)) if size is not None else None
    candidates = []
    for trade in engine.state.get('trades', []):
        if str(trade.get('symbol') or '').upper() != normalized_symbol:
            continue
        if trade.get('result') != 'open':
            continue
        trade_strategy = _normalize_alert_name(trade.get('alert_name') or trade.get('alert'))
        trade_side = str(trade.get('side') or '').strip().lower()
        if trade_side in ('long', 'open_long'):
            trade_side = 'buy'
        elif trade_side in ('short', 'open_short'):
            trade_side = 'sell'
        if normalized_strategy and trade_strategy != normalized_strategy:
            continue
        if normalized_side and trade_side != normalized_side:
            continue
        candidates.append(trade)

    if not candidates:
        return None

    if target_size is None:
        return max(candidates, key=lambda item: int(item.get('trade_id', 0) or 0))

    return min(
        candidates,
        key=lambda item: (
            abs(_safe_float(item.get('size'), 0.0) - target_size),
            -int(item.get('trade_id', 0) or 0),
        ),
    )


def _find_matching_learning_trade_id(symbol, strategy_name=None, side=None, size=None) -> int:
    trade = _find_matching_learning_trade(symbol, strategy_name=strategy_name, side=side, size=size)
    return int((trade or {}).get('trade_id', 0) or 0)


def _close_all_open_learning_trades(symbol, roi=0.0, strategy_name=None, side=None):
    closed_trade_ids = _close_matching_learning_trades(symbol=symbol, roi=roi, strategy_name=strategy_name, side=side)
    position_registry.close(symbol=symbol, strategy=strategy_name, side=side)
    return closed_trade_ids


def _close_learning_trade_by_id(trade_id: int, roi=0.0) -> bool:
    target_trade_id = int(trade_id or 0)
    if target_trade_id <= 0:
        return False
    engine = _learning_engine()
    for trade in engine.state.get('trades', []):
        if int(trade.get('trade_id', -1)) != target_trade_id:
            continue
        if trade.get('result') != 'open':
            return False
        rr = float(trade.get('rr') or 0.0)
        return bool(engine.close_trade(trade_id=target_trade_id, roi=float(roi), rr=rr))
    return False


def _apply_partial_strategy_close_state(symbol, close_size, roi=0.0, strategy_name=None, side=None):
    remaining = max(0.0, _safe_float(close_size, 0.0))
    normalized_symbol = str(symbol or '').upper()
    registry_targets = position_registry.get_all(symbol=normalized_symbol, strategy=strategy_name, side=side)
    result = {
        'closed_trade_ids': [],
        'resized_trade_ids': [],
        'registry_closed_trade_ids': [],
        'registry_reduced_trade_ids': [],
        'remaining_size': remaining,
    }
    if remaining <= 0 or not registry_targets:
        return result

    for reg in registry_targets:
        if remaining <= 0:
            break
        registry_trade_id = int(reg.get('trade_id', 0) or 0)
        current_size = max(0.0, _safe_float(reg.get('size'), 0.0))
        if registry_trade_id <= 0 or current_size <= 0:
            continue

        reduce_size = min(current_size, remaining)
        new_size = max(0.0, current_size - reduce_size)
        learning_trade_id = int(((reg.get('entry_context') or {}).get('learning_trade_id')) or registry_trade_id or 0)

        if new_size <= 1e-12:
            if position_registry.close_trade(registry_trade_id):
                result['registry_closed_trade_ids'].append(registry_trade_id)
            if _close_learning_trade_by_id(learning_trade_id, roi=roi):
                result['closed_trade_ids'].append(learning_trade_id)
        else:
            if position_registry.reduce(registry_trade_id, reduce_size):
                result['registry_reduced_trade_ids'].append(registry_trade_id)
            if _resize_learning_trade(learning_trade_id, new_size):
                result['resized_trade_ids'].append(learning_trade_id)

        remaining = max(0.0, remaining - reduce_size)

    result['remaining_size'] = remaining
    return result


def _record_open_position_and_learning(
    symbol,
    decision,
    entry_price,
    size,
    signal_bundle,
    rr_planned,
    entry_context=None,
    source='webhook_v2',
    order_id=None,
):
    context = dict(entry_context or {})
    if order_id:
        context.setdefault('order_id', str(order_id))
    context['link_status'] = 'linked_learning_trade'
    context.setdefault('entry_price', _safe_float(entry_price, 0.0))
    context.setdefault('initial_size', _safe_float(size, 0.0))
    context.setdefault('partial_taken', [False, False, False])
    context.setdefault('decision', dict(decision or {}))
    position_id = position_registry.add(
        symbol=symbol,
        strategy=decision.get('strategy'),
        side=decision.get('side'),
        entry_price=entry_price,
        size=float(size),
        signal_bundle=signal_bundle,
        rr_planned=rr_planned,
        entry_context=context,
        decision=decision,
        order_id=order_id,
        source=source,
    )
    trade_id = _learning_engine().record_trade_open(
        alert_name=_normalize_alert_name(decision.get('strategy')),
        symbol=str(symbol or '').upper(),
        side='buy' if str(decision.get('side') or '').upper() == 'BUY' else 'sell',
        size=float(size),
        signal_bundle=signal_bundle,
        rr_planned=rr_planned,
        entry_context=context,
    )
    position_registry.sync_live_position(
        symbol=symbol,
        strategy=decision.get('strategy'),
        side=decision.get('side'),
        entry_price=entry_price,
        size=float(size),
        entry_context={
            'learning_trade_id': int(trade_id),
            'link_status': 'linked_learning_trade',
            'initial_size': _safe_float(size, 0.0),
            'partial_taken': list(context.get('partial_taken') or [False, False, False]),
        },
        decision=decision,
    )
    return position_id, trade_id


def _resize_learning_trade(trade_id: int, new_size: float) -> bool:
    if int(trade_id or 0) <= 0:
        return False
    try:
        return _learning_engine().resize_open_trade(trade_id=int(trade_id), new_size=max(0.0, float(new_size)))
    except Exception:
        return False


def _extract_order_id(result):
    if not isinstance(result, dict):
        return None
    direct_data = result.get('data')
    if isinstance(direct_data, dict) and direct_data.get('orderId'):
        return str(direct_data.get('orderId'))
    nested_result = result.get('result')
    if isinstance(nested_result, dict):
        nested_data = nested_result.get('data')
        if isinstance(nested_data, dict) and nested_data.get('orderId'):
            return str(nested_data.get('orderId'))
    open_result = result.get('open') if isinstance(result.get('open'), dict) else None
    if open_result:
        return _extract_order_id(open_result)
    return None


def _normalize_order_id(value) -> str:
    order_id = str(value or '').strip()
    return order_id


def _select_registry_targets_for_close(symbol, strategy_name, side, requested_order_id=None):
    normalized_order_id = _normalize_order_id(requested_order_id)
    base_targets = position_registry.get_all(symbol=symbol, strategy=strategy_name, side=side)

    def _filter_by_order_id(items):
        matched = []
        for item in items:
            direct_order_id = _normalize_order_id(item.get('order_id'))
            context_order_id = _normalize_order_id((item.get('entry_context') or {}).get('order_id'))
            if normalized_order_id in (direct_order_id, context_order_id):
                matched.append(item)
        return matched

    if normalized_order_id:
        matched_targets = _filter_by_order_id(base_targets)
        if matched_targets:
            return matched_targets, 'order_id'
        side_targets = position_registry.get_all(symbol=symbol, side=side)
        matched_side_targets = _filter_by_order_id(side_targets)
        if matched_side_targets:
            return matched_side_targets, 'order_id_side_fallback'
    return base_targets, 'strategy_side'


def _lifecycle_stage_from_state(lifecycle, roi):
    if not isinstance(lifecycle, dict):
        return 'monitor'
    if lifecycle.get('action') == 'close':
        return 'exit_signal'
    if bool(lifecycle.get('structure_exit')):
        return 'structure_exit_signal'
    if lifecycle.get('action') == 'partial':
        stage = int(_safe_int(lifecycle.get('partial_stage_target'), 0))
        return f'partial_s{stage}' if stage > 0 else 'partial'
    if bool(lifecycle.get('runner_mode')):
        return 'runner'
    if _safe_float(roi, 0.0) > 0:
        return 'profit_hold'
    return 'entry'


def _sync_registry_position_from_exchange(symbol, bot_name, hold_side, position, lifecycle=None):
    normalized_side = _position_signal_from_hold_side(hold_side)
    if normalized_side not in ('BUY', 'SELL'):
        return None
    entry_price = _position_entry_price(position) or 0.0
    mark_price = _position_mark_price(position) or 0.0
    size = _pick_first_float(position, ('total',), 0.0) or 0.0
    unrealized_pnl = _pick_first_float(position, ('unrealizedPL', 'upl'), 0.0) or 0.0
    roi = _estimate_position_roi(position)
    lifecycle_stage = _lifecycle_stage_from_state(lifecycle, roi)
    decision = {
        'strategy': _normalize_alert_name(bot_name),
        'side': normalized_side,
        'confidence': _safe_float((lifecycle or {}).get('confidence'), 0.0),
        'score': _safe_float((lifecycle or {}).get('roi'), 0.0),
    }
    existing = position_registry.get_all(symbol=symbol, strategy=bot_name, side=normalized_side)
    current_context = dict((existing[-1] if existing else {}).get('entry_context') or {})
    if int(current_context.get('learning_trade_id') or 0) <= 0:
        matched_learning_trade_id = _find_matching_learning_trade_id(
            symbol=symbol,
            strategy_name=bot_name,
            side=normalized_side,
            size=size,
        )
        if matched_learning_trade_id > 0:
            current_context['learning_trade_id'] = matched_learning_trade_id
            current_context['link_status'] = 'linked_learning_trade'
        else:
            current_context['link_status'] = 'no_open_learning_trade_match'
    else:
        current_context['link_status'] = 'linked_learning_trade'
    current_context.setdefault('initial_size', size)
    current_context.setdefault('partial_taken', [False, False, False])
    return position_registry.sync_live_position(
        symbol=symbol,
        strategy=bot_name,
        side=normalized_side,
        entry_price=entry_price,
        size=size,
        mark_price=mark_price,
        unrealized_pnl=unrealized_pnl,
        lifecycle_stage=lifecycle_stage,
        entry_context=current_context,
        decision=decision,
    )


def _build_managed_registry_position(registry_position: dict, current_price: float):
    entry_context = dict((registry_position or {}).get('entry_context') or {})
    return ManagedPosition(
        symbol=str((registry_position or {}).get('symbol') or '').upper(),
        strategy=_normalize_alert_name((registry_position or {}).get('strategy')),
        side=str((registry_position or {}).get('side') or 'buy'),
        entry_price=_safe_float((registry_position or {}).get('entry_price'), 0.0),
        size=_safe_float((registry_position or {}).get('size'), 0.0),
        initial_size=_safe_float(entry_context.get('initial_size'), _safe_float((registry_position or {}).get('size'), 0.0)),
        timestamp=_safe_float((registry_position or {}).get('timestamp'), time.time()),
        max_profit=_safe_float((registry_position or {}).get('max_profit'), 0.0),
        unrealized_pnl=_safe_float((registry_position or {}).get('unrealized_pnl'), 0.0),
        partial_taken=list(entry_context.get('partial_taken') or [False, False, False]),
        trade_id=int((registry_position or {}).get('trade_id') or 0) or None,
        position_id=str((registry_position or {}).get('position_id') or ''),
    )


def _reconcile_registry_missing_exchange(registry_position: dict, reason: str = 'missing_exchange') -> dict:
    symbol = str((registry_position or {}).get('symbol') or '').upper()
    strategy = _normalize_alert_name((registry_position or {}).get('strategy'))
    side = str((registry_position or {}).get('side') or '').lower()
    trade_id = int((registry_position or {}).get('trade_id', 0) or 0)
    entry_context = (registry_position or {}).get('entry_context') or {}
    learning_trade_id = int(entry_context.get('learning_trade_id') or 0)
    if learning_trade_id <= 0:
        learning_trade_id = _find_matching_learning_trade_id(
            symbol=symbol,
            strategy_name=strategy,
            side=side,
            size=(registry_position or {}).get('size'),
        )

    registry_closed = False
    if trade_id > 0:
        registry_closed = bool(position_registry.close_trade(trade_id))

    learning_close_attempted = learning_trade_id > 0
    learning_closed = None
    if learning_trade_id > 0:
        learning_closed = bool(_close_learning_trade_by_id(learning_trade_id, roi=0.0))

    return {
        'action': 'registry_reconciled_missing_exchange',
        'reason': reason,
        'symbol': symbol,
        'strategy': strategy,
        'side': side,
        'trade_id': trade_id,
        'learning_trade_id': learning_trade_id,
        'learning_close_attempted': learning_close_attempted,
        'registry_closed': registry_closed,
        'learning_closed': learning_closed,
        'learning_close_reason': None if learning_close_attempted else 'no_linked_open_learning_trade',
    }


def _sync_registry_snapshot_from_exchange(exchange_positions: list[dict], trigger: str = 'manual') -> list[dict]:
    synced = []
    for pos in exchange_positions or []:
        symbol = str(pos.get('symbol') or '').upper()
        side = _normalize_hold_side(pos.get('holdSide') or pos.get('side'))
        total = _safe_float(pos.get('total'), 0.0)
        if not symbol or side not in ('BUY', 'SELL') or total <= 0:
            continue

        hold_side = 'long' if side == 'BUY' else 'short'
        learned_bot = _get_learning_open_alert_name(symbol, side=side)
        bot_name = _normalize_alert_name(learned_bot) if learned_bot else _resolve_monitor_bot_name(symbol, hold_side)[0]
        position_id = _sync_registry_position_from_exchange(symbol, bot_name, hold_side, pos, lifecycle={'action': 'hold', 'roi': _estimate_position_roi(pos)})
        synced.append({
            'symbol': symbol,
            'side': hold_side,
            'strategy': bot_name,
            'position_id': position_id,
            'size': total,
            'trigger': trigger,
        })
    return synced


def _should_prefer_profile_partial(lifecycle_reason: str, profile_partial_tuples: list[tuple]) -> bool:
    if not PROFILE_PARTIAL_PRECEDES_LIFECYCLE_CLOSE or not profile_partial_tuples:
        return False
    normalized_reason = str(lifecycle_reason or '').strip().lower()
    if not normalized_reason:
        return False
    for token in PROFILE_PARTIAL_PRECEDENCE_REASONS:
        if normalized_reason == token or normalized_reason.startswith(token):
            return True
    return False


def _perform_registry_initial_sync(trigger: str = 'manual') -> dict:
    response = exchange_client.request('GET', '/api/v2/mix/position/all-position', {'productType': 'USDT-FUTURES'})
    exchange_positions = [p for p in (response.get('data') or []) if _safe_float(p.get('total'), 0.0) > 0]
    synced = _sync_registry_snapshot_from_exchange(exchange_positions, trigger=trigger)
    return {
        'trigger': trigger,
        'synced': synced,
        'exchange_position_count': len(exchange_positions),
        'synced_count': len(synced),
    }


def _runtime_conn():
    conn = sqlite3.connect(RUNTIME_DB)
    conn.execute('PRAGMA journal_mode=WAL')
    return conn


def _init_runtime_db():
    conn = _runtime_conn()
    cur = conn.cursor()
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS recent_requests (
            fingerprint TEXT PRIMARY KEY,
            created_at INTEGER NOT NULL
        )
        '''
    )
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS runtime_errors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )
        '''
    )
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS webhook_ingress (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            last_received_at INTEGER NOT NULL,
            last_source_ua TEXT NOT NULL
        )
        '''
    )
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS decision_reason_stats (
            category TEXT NOT NULL,
            reason TEXT NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (category, reason)
        )
        '''
    )
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS execution_throttle (
            state_key TEXT PRIMARY KEY,
            next_allowed_at_ms INTEGER NOT NULL DEFAULT 0,
            cooldown_until_ms INTEGER NOT NULL DEFAULT 0,
            last_code TEXT NOT NULL DEFAULT '',
            updated_at INTEGER NOT NULL
        )
        '''
    )
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS monitor_scheduler_lease (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            owner TEXT NOT NULL,
            lease_until INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
        '''
    )
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS monitor_runtime_guard (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            running_until INTEGER NOT NULL DEFAULT 0,
            last_run_at INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL DEFAULT 0
        )
        '''
    )
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS monitor_outcome_stats (
            position_state TEXT NOT NULL,
            alert_name TEXT NOT NULL,
            action TEXT NOT NULL,
            trades INTEGER NOT NULL DEFAULT 0,
            wins INTEGER NOT NULL DEFAULT 0,
            losses INTEGER NOT NULL DEFAULT 0,
            roi_sum REAL NOT NULL DEFAULT 0,
            pnl_sum REAL NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (position_state, alert_name, action)
        )
        '''
    )
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS monitor_outcome_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            position_state TEXT NOT NULL,
            alert_name TEXT NOT NULL,
            action TEXT NOT NULL,
            roi REAL NOT NULL DEFAULT 0,
            pnl REAL NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        )
        '''
    )
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS monitor_reconcile_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            alert_name TEXT NOT NULL,
            side TEXT NOT NULL,
            action TEXT NOT NULL,
            registry_trade_id INTEGER NOT NULL DEFAULT 0,
            learning_trade_id INTEGER NOT NULL DEFAULT 0,
            learning_close_attempted INTEGER NOT NULL DEFAULT 0,
            registry_closed INTEGER NOT NULL DEFAULT 0,
            learning_closed INTEGER,
            learning_close_reason TEXT,
            created_at INTEGER NOT NULL
        )
        '''
    )
    conn.commit()
    conn.close()


_init_runtime_db()


def _normalize_symbol(value):
    if not value:
        return DEFAULT_SYMBOL
    symbol = str(value).upper()
    symbol = re.sub(r'[^A-Z0-9]', '', symbol)
    if symbol.endswith('USDTP'):
        symbol = symbol[:-1]
    if symbol.endswith('UMCBL'):
        symbol = symbol[:-5]
    if symbol.endswith('PERP'):
        symbol = symbol[:-4]
    if symbol.endswith('USDTPERP'):
        symbol = symbol[:-8]
    return symbol


def _normalize_action(value):
    if not value:
        return None
    action = str(value).strip().lower()
    if action in ('buy', 'long'):
        return 'BUY'
    if action in ('sell', 'short'):
        return 'SELL'
    if action in ('close', 'exit', 'flat'):
        return 'CLOSE'
    return None


def _extract_forced_action(payload):
    if not isinstance(payload, dict):
        return None

    strategy = payload.get('strategy') if isinstance(payload.get('strategy'), dict) else {}
    candidates = [
        payload.get('action'),
        payload.get('signal'),
        payload.get('side'),
        payload.get('direction'),
        payload.get('order_action'),
        strategy.get('action'),
        strategy.get('order_action'),
        strategy.get('side'),
    ]

    for candidate in candidates:
        normalized = _normalize_action(candidate)
        if normalized:
            return normalized

    text_fields = [payload.get('message'), payload.get('alert'), payload.get('comment'), payload.get('note')]
    text = ' '.join([str(v or '') for v in text_fields]).lower()

    if re.search(r'\b(close|exit|flat)\b', text):
        return 'CLOSE'
    if re.search(r'\b(buy|long)\b', text):
        return 'BUY'
    if re.search(r'\b(sell|short)\b', text):
        return 'SELL'
    return None


def _record_webhook_ingress(user_agent):
    now_ts = int(time.time())
    ua = str(user_agent or 'unknown')
    conn = _runtime_conn()
    cur = conn.cursor()
    cur.execute(
        'INSERT OR REPLACE INTO webhook_ingress (id, last_received_at, last_source_ua) VALUES (1, ?, ?)',
        (now_ts, ua),
    )
    conn.commit()
    conn.close()


def _get_webhook_ingress():
    conn = _runtime_conn()
    cur = conn.cursor()
    cur.execute('SELECT last_received_at, last_source_ua FROM webhook_ingress WHERE id = 1')
    row = cur.fetchone()
    conn.close()
    if not row:
        return 0, 'unknown'
    return int(row[0] or 0), str(row[1] or 'unknown')


def _is_duplicate_request(symbol, signal, size, alert_name=None):
    now_ts = int(time.time())
    cutoff = now_ts - DUPLICATE_TTL_SECONDS
    normalized_alert = _normalize_alert_name(alert_name)
    fingerprint = f'{symbol}:{signal}:{normalized_alert}:{size}'

    conn = _runtime_conn()
    cur = conn.cursor()
    cur.execute('DELETE FROM recent_requests WHERE created_at < ?', (cutoff,))
    cur.execute('SELECT created_at FROM recent_requests WHERE fingerprint = ?', (fingerprint,))
    row = cur.fetchone()

    if row and row[0] >= cutoff:
        conn.commit()
        conn.close()
        return True

    cur.execute(
        'INSERT OR REPLACE INTO recent_requests (fingerprint, created_at) VALUES (?, ?)',
        (fingerprint, now_ts),
    )
    conn.commit()
    conn.close()
    return False


def _normalize_hold_side(value):
    hold_side = str(value or '').strip().lower()
    if hold_side in ('long', 'buy', 'open_long'):
        return 'BUY'
    if hold_side in ('short', 'sell', 'open_short'):
        return 'SELL'
    return None


def _has_same_side_position(symbol, signal):
    positions = _find_open_positions(symbol)
    return any(p.get('side') == signal for p in positions)


def _find_open_positions(symbol):
    try:
        response = exchange_client.request('GET', '/api/v2/mix/position/all-position', {'productType': 'USDT-FUTURES'})
        positions = response.get('data') or []
    except Exception:
        return []

    normalized = []
    for position in positions:
        if position.get('symbol') != symbol:
            continue
        total = float(position.get('total', 0) or 0)
        if total <= 0:
            continue
        side = _normalize_hold_side(position.get('holdSide'))
        normalized.append({
            'side': side,
            'size': total,
            'entry_price': _position_entry_price(position),
            'mark_price': _position_mark_price(position),
            'roi_estimate': _estimate_position_roi(position),
            'holdSide': position.get('holdSide'),
            'raw': position,
        })
    return normalized


def _find_open_position(symbol):
    positions = _find_open_positions(symbol)
    return positions[0] if positions else None


def _registry_side_to_hold_side(side: str | None) -> str:
    normalized = str(side or '').strip().lower()
    return 'long' if normalized in ('buy', 'long', 'open_long') else 'short'


def _build_exchange_position_map(positions: list[dict]) -> dict[tuple[str, str], dict]:
    mapping = {}
    for pos in positions or []:
        sym = str(pos.get('symbol') or '').upper()
        side = _normalize_hold_side(pos.get('holdSide') or pos.get('side'))
        if not sym or side not in ('BUY', 'SELL'):
            continue
        mapping[(sym, side)] = pos
    return mapping


def _build_virtual_position(registry_pos: dict, exchange_pos: dict) -> dict:
    symbol = str((registry_pos or {}).get('symbol') or '').upper()
    side = str((registry_pos or {}).get('side') or '').lower()
    hold_side = _registry_side_to_hold_side(side)
    entry_price = _safe_float((registry_pos or {}).get('entry_price'), 0.0)
    size = _safe_float((registry_pos or {}).get('size'), 0.0)

    source = exchange_pos or {}
    leverage = max(1.0, _pick_first_float(source, ('leverage',), 1.0) or 1.0)
    mark_price = _position_mark_price(source)
    margin_size = _pick_first_float(source, ('marginSize', 'margin', 'marginAmount'), 0.0) or 0.0
    exchange_total = max(_safe_float(source.get('total'), 0.0), 0.0)
    proportional_margin = 0.0
    if exchange_total > 0 and margin_size > 0 and size > 0:
        proportional_margin = margin_size * (size / exchange_total)
    if proportional_margin <= 0 and entry_price > 0 and size > 0 and leverage > 0:
        proportional_margin = (size * entry_price) / leverage

    virtual_position = dict(source)
    virtual_position.update({
        'symbol': symbol,
        'holdSide': hold_side,
        'side': 'BUY' if hold_side == 'long' else 'SELL',
        'total': size,
        'openPriceAvg': entry_price,
        'avgOpenPrice': entry_price,
        'averageOpenPrice': entry_price,
        'openPrice': entry_price,
        'markPrice': mark_price,
        'marginSize': proportional_margin,
        'margin': proportional_margin,
        'marginAmount': proportional_margin,
        'strategy_name': _normalize_alert_name((registry_pos or {}).get('strategy')),
        'trade_id': int((registry_pos or {}).get('trade_id', 0) or 0),
        'entry_context': (registry_pos or {}).get('entry_context') or {},
        'decision': (registry_pos or {}).get('decision') or {},
    })
    if mark_price and entry_price and size > 0:
        if hold_side == 'long':
            upl = (mark_price - entry_price) * size
        else:
            upl = (entry_price - mark_price) * size
        virtual_position['unrealizedPL'] = upl
        virtual_position['upl'] = upl
    return virtual_position


def _record_runtime_error(message):
    now_ts = int(time.time())
    cutoff = now_ts - ERROR_WINDOW_SECONDS
    conn = _runtime_conn()
    cur = conn.cursor()
    cur.execute('INSERT INTO runtime_errors (message, created_at) VALUES (?, ?)', (message, now_ts))
    cur.execute('DELETE FROM runtime_errors WHERE created_at < ?', (cutoff,))
    conn.commit()
    conn.close()


def _record_reason_stat(category, reason):
    if not category or not reason:
        return
    now_ts = int(time.time())
    conn = _runtime_conn()
    cur = conn.cursor()
    cur.execute(
        '''
        INSERT INTO decision_reason_stats (category, reason, count, updated_at)
        VALUES (?, ?, 1, ?)
        ON CONFLICT(category, reason)
        DO UPDATE SET count = count + 1, updated_at = excluded.updated_at
        ''',
        (str(category), str(reason), now_ts),
    )
    conn.commit()
    conn.close()


def _top_reason_stats(category, limit=8):
    conn = _runtime_conn()
    cur = conn.cursor()
    cur.execute(
        'SELECT reason, count, updated_at FROM decision_reason_stats WHERE category = ? ORDER BY count DESC, updated_at DESC LIMIT ?',
        (str(category), int(limit)),
    )
    rows = cur.fetchall()
    conn.close()
    return [
        {'reason': str(row[0]), 'count': int(row[1] or 0), 'updated_at': int(row[2] or 0)}
        for row in rows
    ]


def _record_no_signal_stats(bot_eval):
    if not isinstance(bot_eval, dict):
        _record_reason_stat('no_signal', 'signal_missing')
        return
    reason = str(bot_eval.get('no_signal_reason') or 'signal_missing')
    _record_reason_stat('no_signal', reason)
    blocked = bot_eval.get('blocked_reasons') or {}
    if isinstance(blocked, dict):
        for alert_name, blocked_reason in blocked.items():
            _record_reason_stat('blocked_reason', f'{alert_name}:{blocked_reason}')


def _get_execution_throttle_state():
    conn = _runtime_conn()
    cur = conn.cursor()
    cur.execute(
        'SELECT next_allowed_at_ms, cooldown_until_ms, last_code, updated_at FROM execution_throttle WHERE state_key = ?',
        ('exchange_order',),
    )
    row = cur.fetchone()
    conn.close()
    if not row:
        return {'next_allowed_at_ms': 0, 'cooldown_until_ms': 0, 'last_code': '', 'updated_at': 0}
    return {
        'next_allowed_at_ms': int(row[0] or 0),
        'cooldown_until_ms': int(row[1] or 0),
        'last_code': str(row[2] or ''),
        'updated_at': int(row[3] or 0),
    }


def _decision_stats_payload(limit=8):
    now_ms = int(time.time() * 1000)
    throttle = _get_execution_throttle_state()
    return {
        'no_signal_reasons': _top_reason_stats('no_signal', limit=limit),
        'blocked_reasons': _top_reason_stats('blocked_reason', limit=limit),
        'exchange_rate_limits': _top_reason_stats('exchange_rate_limit', limit=limit),
        'exchange_throttle': {
            'next_allowed_in_ms': max(0, int(throttle.get('next_allowed_at_ms', 0)) - now_ms),
            'cooldown_remaining_ms': max(0, int(throttle.get('cooldown_until_ms', 0)) - now_ms),
            'last_code': throttle.get('last_code', ''),
            'updated_at': throttle.get('updated_at', 0),
        },
    }


def _position_margin_notional(position):
    if not isinstance(position, dict):
        return 0.0
    return _pick_first_float(position, ('marginSize', 'margin', 'marginAmount'), 0.0) or 0.0


def _record_monitor_outcome(position_state, alert_name, action, roi, pnl):
    if not action:
        return
    state = str(position_state or 'unknown')
    alert = _normalize_alert_name(alert_name)
    act = str(action)
    roi_value = _safe_float(roi, 0.0)
    pnl_value = _safe_float(pnl, 0.0)
    now_ts = int(time.time())
    win = 1 if roi_value > 0 else 0
    loss = 1 if roi_value < 0 else 0

    conn = _runtime_conn()
    cur = conn.cursor()
    cur.execute(
        '''
        INSERT INTO monitor_outcome_stats (position_state, alert_name, action, trades, wins, losses, roi_sum, pnl_sum, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
        ON CONFLICT(position_state, alert_name, action)
        DO UPDATE SET
            trades = monitor_outcome_stats.trades + 1,
            wins = monitor_outcome_stats.wins + excluded.wins,
            losses = monitor_outcome_stats.losses + excluded.losses,
            roi_sum = monitor_outcome_stats.roi_sum + excluded.roi_sum,
            pnl_sum = monitor_outcome_stats.pnl_sum + excluded.pnl_sum,
            updated_at = excluded.updated_at
        ''',
        (state, alert, act, win, loss, roi_value, pnl_value, now_ts),
    )
    cur.execute(
        'INSERT INTO monitor_outcome_events (position_state, alert_name, action, roi, pnl, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        (state, alert, act, roi_value, pnl_value, now_ts),
    )
    conn.commit()
    conn.close()


def _record_reconcile_event(symbol, strategy_name, side, reconcile_result):
    if not isinstance(reconcile_result, dict):
        return
    conn = _runtime_conn()
    cur = conn.cursor()
    cur.execute(
        '''
        INSERT INTO monitor_reconcile_events (
            symbol,
            alert_name,
            side,
            action,
            registry_trade_id,
            learning_trade_id,
            learning_close_attempted,
            registry_closed,
            learning_closed,
            learning_close_reason,
            created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''',
        (
            str(symbol or '').upper(),
            _normalize_alert_name(strategy_name),
            str(side or '').lower(),
            str(reconcile_result.get('action') or 'registry_reconciled_missing_exchange'),
            int(reconcile_result.get('trade_id', 0) or 0),
            int(reconcile_result.get('learning_trade_id', 0) or 0),
            1 if bool(reconcile_result.get('learning_close_attempted')) else 0,
            1 if bool(reconcile_result.get('registry_closed')) else 0,
            None if reconcile_result.get('learning_closed') is None else (1 if bool(reconcile_result.get('learning_closed')) else 0),
            str(reconcile_result.get('learning_close_reason') or ''),
            int(time.time()),
        ),
    )
    conn.commit()
    conn.close()


def _monitor_outcome_stats_payload(limit=64):
    conn = _runtime_conn()
    cur = conn.cursor()
    cur.execute(
        '''
        SELECT position_state, alert_name, action, trades, wins, losses, roi_sum, pnl_sum, updated_at
        FROM monitor_outcome_stats
        ORDER BY updated_at DESC, trades DESC
        LIMIT ?
        ''',
        (int(limit),),
    )
    rows = cur.fetchall()
    conn.close()

    by_bucket = []
    grouped_by_alert = {}
    for row in rows:
        state = str(row[0] or 'unknown')
        alert = _normalize_alert_name(row[1])
        action = str(row[2] or '')
        trades = int(row[3] or 0)
        wins = int(row[4] or 0)
        losses = int(row[5] or 0)
        roi_sum = float(row[6] or 0.0)
        pnl_sum = float(row[7] or 0.0)
        updated_at = int(row[8] or 0)
        win_rate = (wins / trades) if trades > 0 else 0.0
        avg_roi = (roi_sum / trades) if trades > 0 else 0.0

        bucket = {
            'position_state': state,
            'alert_name': alert,
            'action': action,
            'trades': trades,
            'wins': wins,
            'losses': losses,
            'win_rate': round(win_rate, 4),
            'avg_roi': round(avg_roi, 6),
            'roi_sum': round(roi_sum, 6),
            'pnl_sum': round(pnl_sum, 6),
            'updated_at': updated_at,
        }
        by_bucket.append(bucket)

        aggr = grouped_by_alert.setdefault(alert, {'trades': 0, 'wins': 0, 'roi_sum': 0.0})
        aggr['trades'] += trades
        aggr['wins'] += wins
        aggr['roi_sum'] += roi_sum

    optimization_hints = []
    for alert, row in grouped_by_alert.items():
        trades = int(row.get('trades', 0) or 0)
        wins = int(row.get('wins', 0) or 0)
        win_rate = (wins / trades) if trades > 0 else 0.0
        avg_roi = (float(row.get('roi_sum', 0.0) or 0.0) / trades) if trades > 0 else 0.0
        if trades < 12:
            continue

        if win_rate < 0.45:
            optimization_hints.append({
                'alert_name': alert,
                'suggestion': 'tighten_doten_gate',
                'recommended_score_delta': 0.02,
                'recommended_confidence_delta': 0.02,
                'trades': trades,
                'win_rate': round(win_rate, 4),
                'avg_roi': round(avg_roi, 6),
            })
        elif win_rate > 0.58 and avg_roi > 0:
            optimization_hints.append({
                'alert_name': alert,
                'suggestion': 'relax_doten_gate',
                'recommended_score_delta': -0.01,
                'recommended_confidence_delta': -0.01,
                'trades': trades,
                'win_rate': round(win_rate, 4),
                'avg_roi': round(avg_roi, 6),
            })

    return {
        'by_bucket': by_bucket,
        'optimization_hints': optimization_hints,
    }


def _reconcile_stats_payload(window_seconds=86400, recent_limit=6):
    cutoff = max(0, int(time.time()) - max(0, int(window_seconds)))
    conn = _runtime_conn()
    cur = conn.cursor()
    cur.execute(
        '''
        SELECT
            COUNT(*),
            SUM(CASE WHEN COALESCE(learning_close_reason, '') = 'no_linked_open_learning_trade' THEN 1 ELSE 0 END),
            SUM(CASE WHEN registry_closed = 1 THEN 1 ELSE 0 END),
            SUM(CASE WHEN learning_closed = 1 THEN 1 ELSE 0 END)
        FROM monitor_reconcile_events
        WHERE created_at >= ?
        ''',
        (cutoff,),
    )
    summary_row = cur.fetchone() or (0, 0, 0, 0)
    cur.execute(
        '''
        SELECT symbol, alert_name, side, action, registry_trade_id, learning_trade_id, learning_close_attempted, registry_closed, learning_closed, learning_close_reason, created_at
        FROM monitor_reconcile_events
        WHERE created_at >= ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
        ''',
        (cutoff, int(recent_limit)),
    )
    rows = cur.fetchall()
    conn.close()
    return {
        'window_seconds': int(window_seconds),
        'events': int(summary_row[0] or 0),
        'no_linked_open_learning_trade': int(summary_row[1] or 0),
        'registry_closed': int(summary_row[2] or 0),
        'learning_closed': int(summary_row[3] or 0),
        'recent_events': [
            {
                'symbol': str(row[0] or ''),
                'alert_name': _normalize_alert_name(row[1]),
                'side': str(row[2] or ''),
                'action': str(row[3] or ''),
                'registry_trade_id': int(row[4] or 0),
                'learning_trade_id': int(row[5] or 0),
                'learning_close_attempted': bool(row[6]),
                'registry_closed': bool(row[7]),
                'learning_closed': None if row[8] is None else bool(row[8]),
                'learning_close_reason': str(row[9] or ''),
                'created_at': int(row[10] or 0),
            }
            for row in rows
        ],
    }


def _is_exchange_429(resp) -> bool:
    if not isinstance(resp, dict):
        return False
    code = str(resp.get('code', '') or '')
    message = str(resp.get('msg', '') or resp.get('message', '') or '').lower()
    return code == '429' or 'too many requests' in message


def _is_local_rate_limit_block(resp) -> bool:
    return isinstance(resp, dict) and str(resp.get('code', '')) == 'RATE_LIMITED_LOCAL'


def _is_rate_limited_response(resp) -> bool:
    return _is_local_rate_limit_block(resp) or _is_exchange_429(resp)


def _set_exchange_cooldown(last_code: str, cooldown_seconds: int):
    now_ms = int(time.time() * 1000)
    cooldown_until_ms = now_ms + max(0, int(cooldown_seconds)) * 1000
    conn = _runtime_conn()
    conn.execute('BEGIN IMMEDIATE')
    cur = conn.cursor()
    cur.execute(
        '''
        INSERT INTO execution_throttle (state_key, next_allowed_at_ms, cooldown_until_ms, last_code, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(state_key)
        DO UPDATE SET cooldown_until_ms = MAX(execution_throttle.cooldown_until_ms, excluded.cooldown_until_ms),
                      last_code = excluded.last_code,
                      updated_at = excluded.updated_at
        ''',
        ('exchange_order', now_ms, cooldown_until_ms, str(last_code or ''), int(time.time())),
    )
    conn.commit()
    conn.close()


def _reserve_exchange_slot(interval_ms: int = None):
    now_ms = int(time.time() * 1000)
    interval = max(0, int(interval_ms or ORDER_API_MIN_INTERVAL_MS))

    conn = _runtime_conn()
    conn.execute('BEGIN IMMEDIATE')
    cur = conn.cursor()
    cur.execute(
        'SELECT next_allowed_at_ms, cooldown_until_ms FROM execution_throttle WHERE state_key = ?',
        ('exchange_order',),
    )
    row = cur.fetchone()
    next_allowed_at_ms = int(row[0] or 0) if row else 0
    cooldown_until_ms = int(row[1] or 0) if row else 0

    if cooldown_until_ms > now_ms:
        conn.commit()
        conn.close()
        return {
            'allowed': False,
            'reason': 'exchange_rate_limit_cooldown',
            'retry_after_ms': cooldown_until_ms - now_ms,
        }

    execute_at_ms = max(now_ms, next_allowed_at_ms)
    wait_ms = max(0, execute_at_ms - now_ms)
    cur.execute(
        '''
        INSERT INTO execution_throttle (state_key, next_allowed_at_ms, cooldown_until_ms, last_code, updated_at)
        VALUES (?, ?, 0, '', ?)
        ON CONFLICT(state_key)
        DO UPDATE SET next_allowed_at_ms = excluded.next_allowed_at_ms,
                      updated_at = excluded.updated_at
        ''',
        ('exchange_order', execute_at_ms + interval, int(time.time())),
    )
    conn.commit()
    conn.close()

    if wait_ms > 0:
        time.sleep(wait_ms / 1000.0)

    return {'allowed': True, 'wait_ms': wait_ms, 'scheduled_at_ms': execute_at_ms}


def _execute_exchange_call(label: str, fn, interval_ms: int = None):
    slot = _reserve_exchange_slot(interval_ms=interval_ms)
    if not slot.get('allowed'):
        retry_after_ms = int(slot.get('retry_after_ms', 0) or 0)
        _record_reason_stat('exchange_rate_limit', f'{label}:local_cooldown')
        return {
            'code': 'RATE_LIMITED_LOCAL',
            'msg': 'exchange cooldown active',
            'label': label,
            'retry_after_ms': retry_after_ms,
        }

    try:
        response = fn()
    except Exception as exc:
        text = str(exc)
        if '429' in text or 'too many requests' in text.lower():
            _set_exchange_cooldown('429', EXCHANGE_429_COOLDOWN_SECONDS)
            _record_reason_stat('exchange_rate_limit', f'{label}:exception_429')
        raise

    if _is_exchange_429(response):
        _set_exchange_cooldown('429', EXCHANGE_429_COOLDOWN_SECONDS)
        _record_reason_stat('exchange_rate_limit', f'{label}:429')
        _record_runtime_error(f'exchange_429:{label}')
        app.logger.warning('EXCHANGE_429 label=%s response=%s', label, response)
    return response


def _rate_limit_http_response(symbol, action, result):
    retry_after_ms = int((result or {}).get('retry_after_ms', 0) or 0)
    return jsonify({
        'status': 'blocked',
        'reason': 'exchange_rate_limit',
        'symbol': symbol,
        'action': action,
        'retry_after_ms': retry_after_ms,
        'result': result,
    }), 200


def _recent_error_summary():
    now_ts = int(time.time())
    cutoff = now_ts - ERROR_WINDOW_SECONDS
    conn = _runtime_conn()
    cur = conn.cursor()
    cur.execute('DELETE FROM runtime_errors WHERE created_at < ?', (cutoff,))
    cur.execute('SELECT COUNT(*), MAX(created_at) FROM runtime_errors')
    count, latest_ts = cur.fetchone()
    last_error = None
    if latest_ts:
        cur.execute('SELECT message, created_at FROM runtime_errors ORDER BY id DESC LIMIT 1')
        row = cur.fetchone()
        if row:
            last_error = {'message': row[0], 'timestamp': row[1]}
    conn.commit()
    conn.close()
    return int(count or 0), last_error


def _safe_float(value, default=0.0):
    try:
        return float(value)
    except Exception:
        return default


def _safe_int(value, default=0):
    try:
        return int(float(value))
    except Exception:
        return default


def _base_size_from_balance_pct(mark_price: float, fallback_candles=None) -> tuple[float, str]:
    mark = _safe_float(mark_price, 0.0)
    live_balance = _safe_float(_get_live_balance(), 0.0)
    pct = max(0.0, min(1.0, BASE_ORDER_BALANCE_PCT))
    target_notional = live_balance * pct

    if mark > 0 and target_notional > 0:
        return (target_notional / mark), 'balance_pct'

    try:
        fallback = float(position_sizer.calculate(_get_live_balance(), fallback_candles or []))
        if fallback > 0:
            return fallback, 'adaptive_fallback'
    except Exception:
        pass
    return 0.0, 'unavailable'


def _min_entry_size_from_balance_pct(mark_price: float) -> tuple[float, float, float]:
    mark = _safe_float(mark_price, 0.0)
    live_balance = _safe_float(_get_live_balance(), 0.0)
    min_pct = max(0.0, min(1.0, MIN_ENTRY_BALANCE_PCT))
    min_notional = live_balance * min_pct
    if mark > 0 and min_notional > 0:
        return (min_notional / mark), min_notional, min_pct
    return 0.0, 0.0, min_pct


def _entry_size_from_margin_pct(mark_price: float, leverage: float) -> tuple[float, float, float, float]:
    mark = _safe_float(mark_price, 0.0)
    live_balance = _safe_float(_get_live_balance(), 0.0)
    pct = max(0.0, min(1.0, ENTRY_MARGIN_BALANCE_PCT))
    target_margin = live_balance * pct
    lev = max(1.0, _safe_float(leverage, 1.0))
    if mark > 0 and target_margin > 0:
        return (target_margin * lev / mark), target_margin, pct, live_balance
    return 0.0, target_margin, pct, live_balance


def _pick_first_float(mapping, keys, default=None):
    if not isinstance(mapping, dict):
        return default
    for key in keys:
        value = mapping.get(key)
        if value in (None, ''):
            continue
        try:
            parsed = float(value)
        except Exception:
            continue
        if parsed > 0:
            return parsed
    return default


def _position_entry_price(position):
    return _pick_first_float(position, ('openPriceAvg', 'avgOpenPrice', 'averageOpenPrice', 'openPrice', 'breakEvenPrice'))


def _position_mark_price(position):
    return _pick_first_float(position, ('markPrice', 'marketPrice', 'lastPr', 'indexPrice'))


def _estimate_position_roi(position):
    if not isinstance(position, dict):
        return None
    entry_price = _position_entry_price(position)
    mark_price = _position_mark_price(position)
    side = _normalize_hold_side(position.get('holdSide') or position.get('side'))
    if entry_price and mark_price and side == 'BUY':
        return (mark_price - entry_price) / entry_price
    if entry_price and mark_price and side == 'SELL':
        return (entry_price - mark_price) / entry_price
    upl = _pick_first_float(position, ('unrealizedPL', 'upl'), None)
    margin = _pick_first_float(position, ('marginSize', 'margin', 'marginAmount'), None)
    if upl is not None and margin and margin > 0:
        return upl / margin
    return None


def _resolve_close_roi(payload, open_pos):
    if isinstance(payload, dict) and payload.get('close_roi') not in (None, ''):
        return _safe_float(payload.get('close_roi'), 0.0)
    estimated = _estimate_position_roi(open_pos)
    return float(estimated) if estimated is not None else 0.0


def _simple_atr(candles, period=14):
    if not candles or len(candles) < period + 1:
        return 0.0
    trs = []
    prev_close = _safe_float(candles[0][4], 0.0)
    for row in candles[1:]:
        high = _safe_float(row[2], 0.0)
        low = _safe_float(row[3], 0.0)
        close = _safe_float(row[4], 0.0)
        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        trs.append(tr)
        prev_close = close
    if not trs:
        return 0.0
    slice_vals = trs[-period:]
    return sum(slice_vals) / len(slice_vals)


def _candle_volume(row):
    if not isinstance(row, (list, tuple)) or len(row) <= 5:
        return 0.0
    return _safe_float(row[5], 0.0)


def _is_volume_drop(candles):
    if not candles or len(candles) < (VOLUME_DROP_LOOKBACK + 1):
        return False
    recent = candles[-1]
    prev = candles[-(VOLUME_DROP_LOOKBACK + 1):-1]
    current_vol = _candle_volume(recent)
    prev_vols = [_candle_volume(c) for c in prev]
    prev_vols = [v for v in prev_vols if v > 0]
    if current_vol <= 0 or not prev_vols:
        return False
    baseline = sum(prev_vols) / len(prev_vols)
    if baseline <= 0:
        return False
    return (current_vol / baseline) <= max(0.01, VOLUME_DROP_THRESHOLD)


def _is_atr_expanding(candles):
    if not candles or len(candles) < (ATR_EXPAND_LONG_PERIOD + 1):
        return False
    short_atr = _simple_atr(candles, period=ATR_EXPAND_SHORT_PERIOD)
    long_atr = _simple_atr(candles, period=ATR_EXPAND_LONG_PERIOD)
    if short_atr <= 0 or long_atr <= 0:
        return False
    return (short_atr / long_atr) >= max(1.0, ATR_EXPAND_RATIO_THRESHOLD)


def _log_exit_event(strategy, roi, reason, symbol=None, action=None):
    app.logger.info(
        'EXIT_EVENT strategy=%s symbol=%s action=%s roi=%s exit_reason=%s',
        str(strategy or 'unknown'),
        str(symbol or ''),
        str(action or ''),
        _safe_float(roi, 0.0),
        str(reason or ''),
    )


def _utc_day_start_ts(now_ts: int) -> int:
    now = int(now_ts)
    return now - (now % 86400)


def _current_daily_drawdown_ratio() -> float:
    now_ts = int(time.time())
    start_ts = _utc_day_start_ts(now_ts)
    conn = _runtime_conn()
    cur = conn.cursor()
    cur.execute(
        'SELECT COALESCE(SUM(pnl), 0) FROM monitor_outcome_events WHERE created_at >= ? AND pnl < 0',
        (start_ts,),
    )
    row = cur.fetchone()
    conn.close()
    loss_abs = abs(_safe_float((row[0] if row else 0.0), 0.0))
    live_balance = _safe_float(_get_live_balance(), 0.0)
    if live_balance <= 0:
        return 0.0
    return loss_abs / live_balance


def _learning_summary_payload(recent_limit=8):
    engine = _learning_engine()
    state = engine.state
    trades = list(state.get('trades', []))
    return {
        'summary': engine.get_alert_summary(),
        'recent_trades': trades[-recent_limit:],
    }


def _build_phase45_context(symbol):
    try:
        orderbook = get_orderbook(symbol) or {}
        bids = orderbook.get('bids') or []
        asks = orderbook.get('asks') or []

        best_bid = 0.0
        best_ask = 0.0
        top_bid_qty = 0.0
        top_ask_qty = 0.0

        if bids:
            first_bid = bids[0]
            if isinstance(first_bid, (list, tuple)) and len(first_bid) >= 2:
                best_bid = _safe_float(first_bid[0])
                top_bid_qty = _safe_float(first_bid[1])
            elif isinstance(first_bid, dict):
                best_bid = _safe_float(first_bid.get('price') or first_bid.get('bidPrice'))
                top_bid_qty = _safe_float(first_bid.get('size') or first_bid.get('qty') or first_bid.get('bidSize'))

        if asks:
            first_ask = asks[0]
            if isinstance(first_ask, (list, tuple)) and len(first_ask) >= 2:
                best_ask = _safe_float(first_ask[0])
                top_ask_qty = _safe_float(first_ask[1])
            elif isinstance(first_ask, dict):
                best_ask = _safe_float(first_ask.get('price') or first_ask.get('askPrice'))
                top_ask_qty = _safe_float(first_ask.get('size') or first_ask.get('qty') or first_ask.get('askSize'))

        if best_bid <= 0 or best_ask <= 0:
            try:
                ticks_for_px = get_ticks(symbol) or []
                if ticks_for_px:
                    px = ticks_for_px[0]
                    if isinstance(px, dict):
                        last_px = _safe_float(px.get('price') or px.get('last') or px.get('close'))
                        if last_px > 0:
                            best_bid = last_px * 0.9999
                            best_ask = last_px * 1.0001
            except Exception:
                pass

        mid = (best_bid + best_ask) / 2.0 if best_bid > 0 and best_ask > 0 else 0.0
        spread_bps = ((best_ask - best_bid) / mid * 10000.0) if mid > 0 else 0.0

        total_top = top_bid_qty + top_ask_qty
        imbalance = ((top_bid_qty - top_ask_qty) / total_top) if total_top > 0 else 0.0
        top_depth_ratio = (top_bid_qty / top_ask_qty) if top_ask_qty > 0 else 1.0

        ticks = get_ticks(symbol) or []
        buy_count = 0
        total_count = 0
        for item in ticks[:80]:
            side = ''
            if isinstance(item, dict):
                side = str(item.get('side', '')).lower()
            elif isinstance(item, (list, tuple)) and len(item) >= 2:
                side = str(item[1]).lower()
            if side:
                total_count += 1
                if side in ('buy', 'bid'):
                    buy_count += 1
        aggressive_buy_ratio = (buy_count / total_count) if total_count > 0 else 0.5

        funding = get_funding_rate(symbol)
        funding_rate = _safe_float(funding.get('fundingRate', 0) if isinstance(funding, dict) else 0)

        micro = micro_engine.evaluate(
            spread_bps=spread_bps,
            imbalance=imbalance,
            aggressive_buy_ratio=aggressive_buy_ratio,
            top_depth_ratio=top_depth_ratio,
        )

        ref_bid = best_bid if best_bid > 0 else 1.0
        ref_ask = best_ask if best_ask > 0 else ref_bid * 1.0002
        venue_quotes = {
            'bitget': VenueQuote('bitget', ref_bid, ref_ask, 6.0, 1.2, 35.0),
            'synthetic_ref': VenueQuote('synthetic_ref', ref_bid * 1.0002, ref_ask * 1.0002, 6.0, 1.2, 45.0),
        }
        arb = arb_engine.best(venue_quotes, funding_rate_8h=funding_rate)

        state_key = f"{micro.regime}|{'up' if micro.score > 0.1 else 'down' if micro.score < -0.1 else 'flat'}"
        rl_decision = rl_trader.decide(state_key)

        reward_proxy = micro.score * 0.4
        if arb and arb.executable:
            reward_proxy += min(arb.net_edge_bps / 10.0, 1.0)
        rl_trader.learn(state_key, rl_decision.action, reward_proxy, state_key)

        return {
            'micro': {'score': micro.score, 'confidence': micro.confidence, 'regime': micro.regime},
            'arb': None if not arb else {
                'buy_venue': arb.buy_venue,
                'sell_venue': arb.sell_venue,
                'net_edge_bps': arb.net_edge_bps,
                'executable': arb.executable,
            },
            'rl': {
                'action': rl_decision.action,
                'expected_value': rl_decision.expected_value,
                'exploration': rl_decision.exploration,
            },
        }
    except Exception as exc:
        app.logger.warning('PHASE45_CONTEXT_FALLBACK symbol=%s err=%s', symbol, str(exc))
        return {
            'micro': {'score': 0.0, 'confidence': 0.0, 'regime': 'fallback'},
            'arb': None,
            'rl': {'action': 'hold', 'expected_value': 0.0, 'exploration': False},
        }


def generate_signal(symbol):
    return _evaluate_bots(symbol).get('signal')


@app.get('/healthz')
def healthz():
    _start_monitor_autopoll()
    recent_error_count, last_runtime_error = _recent_error_summary()
    learning = _learning_summary_payload(recent_limit=4)
    reconcile = _reconcile_stats_payload(window_seconds=86400, recent_limit=6)
    now_ts = int(time.time())
    last_webhook_received_at, last_webhook_source_ua = _get_webhook_ingress()
    since_last_webhook = None
    if last_webhook_received_at > 0:
        since_last_webhook = max(0, now_ts - last_webhook_received_at)
    ingress_status = 'unknown' if since_last_webhook is None else ('stale' if since_last_webhook > WEBHOOK_STALE_SECONDS else 'ok')
    payload = {
        'status': 'ok' if recent_error_count < ERROR_THRESHOLD else 'degraded',
        'dry_run': DRY_RUN,
        'phase45_enabled': ENABLE_PHASE45,
        'feature_flags': {
            'doten': ENABLE_DOTEN,
            'orderblock': ENABLE_ORDERBLOCK,
        },
        'phase45_config': {
            'micro_threshold': PHASE45_MICRO_THRESHOLD,
            'micro_boost': PHASE45_MICRO_BOOST,
            'rl_boost': PHASE45_RL_BOOST,
        },
        'symbols': SYMBOLS,
        'webhook_ingress': {
            'status': ingress_status,
            'stale_seconds_threshold': WEBHOOK_STALE_SECONDS,
            'last_received_at_unix': last_webhook_received_at,
            'seconds_since_last_webhook': since_last_webhook,
            'last_source_ua': last_webhook_source_ua,
        },
        'recent_error_count': recent_error_count,
        'last_runtime_error': last_runtime_error,
        'learning_summary': learning['summary'],
        'reconcile_stats': reconcile,
        'decision_stats': _decision_stats_payload(limit=6),
    }
    status_code = 200 if recent_error_count < ERROR_THRESHOLD else 503
    return jsonify(payload), status_code


@app.get('/learning-summary')
def learning_summary():
    payload = _learning_summary_payload(recent_limit=12)
    return jsonify({'status': 'ok', **payload}), 200


@app.get('/decision-stats')
def decision_stats():
    return jsonify({'status': 'ok', **_decision_stats_payload(limit=12)}), 200


@app.get('/reconcile-stats')
def reconcile_stats():
    window_seconds = max(0, _safe_int(request.args.get('window_seconds'), 86400))
    recent_limit = max(1, _safe_int(request.args.get('recent_limit'), 12))
    return jsonify({'status': 'ok', **_reconcile_stats_payload(window_seconds=window_seconds, recent_limit=recent_limit)}), 200


@app.post('/webhook')
def webhook():
    _start_monitor_autopoll()
    _record_webhook_ingress(request.headers.get('User-Agent'))

    payload = request.get_json(silent=True) or {}
    symbol = _normalize_symbol(payload.get('ticker') or payload.get('symbol') or DEFAULT_SYMBOL)
    forced_action = _extract_forced_action(payload)

    if symbol not in SYMBOLS:
        _log_webhook_block('symbol_not_allowed', symbol)
        return jsonify({'status': 'ignored', 'reason': 'symbol_not_allowed', 'symbol': symbol}), 200

    try:
        phase45_context = _build_phase45_context(symbol) if ENABLE_PHASE45 else None

        if forced_action == 'CLOSE':
            requested_strategy = _normalize_alert_name(payload.get('alert_name') or payload.get('strategy')) if (payload.get('alert_name') or payload.get('strategy')) else None
            requested_order_id = _normalize_order_id(payload.get('order_id') or payload.get('orderId'))
            open_pos = _find_open_position(symbol)
            if not open_pos or not open_pos.get('side'):
                _log_webhook_block('no_open_position', symbol, action='CLOSE')
                return jsonify({'status': 'blocked', 'reason': 'no_open_position', 'symbol': symbol}), 200

            close_side = 'buy' if open_pos['side'] == 'BUY' else 'sell'
            scoped_side = _position_signal_from_hold_side((open_pos.get('raw') or {}).get('holdSide'))
            registry_targets, close_target_source = _select_registry_targets_for_close(
                symbol=symbol,
                strategy_name=requested_strategy,
                side=scoped_side,
                requested_order_id=requested_order_id,
            )
            target_registry_size = sum(_safe_float(item.get('size'), 0.0) for item in registry_targets)
            close_size_value = _safe_float(payload.get('size'), 0.0) or target_registry_size or _safe_float(open_pos.get('size'), 0.0)
            close_size = str(close_size_value)
            if _safe_float(close_size, 0.0) <= 0:
                _log_webhook_block('invalid_close_size', symbol, close_size=close_size)
                return jsonify({'status': 'error', 'reason': 'invalid_close_size', 'symbol': symbol, 'size': close_size}), 500

            if DRY_RUN:
                result = {
                    'dry_run': True,
                    'symbol': symbol,
                    'action': 'CLOSE',
                    'close_plan': {'side': close_side, 'size': close_size},
                }
                return jsonify({'status': 'ok', 'symbol': symbol, 'action': 'CLOSE', 'dry_run': True, 'result': result}), 200

            result = _execute_exchange_call('close', lambda: close_position(symbol, close_side, close_size))
            if _is_rate_limited_response(result):
                return _rate_limit_http_response(symbol, 'CLOSE', result)
            closed_trade_ids = []
            partial_close_meta = None
            close_roi_used = _resolve_close_roi(payload, open_pos.get('raw') or open_pos)
            if _is_order_success(result):
                hold_side = str((open_pos.get('raw') or {}).get('holdSide', '')).lower()
                bot_name = requested_strategy or _get_active_bot_name(symbol, side=_position_signal_from_hold_side(hold_side))
                is_partial_strategy_close = (
                    bool(requested_strategy or requested_order_id)
                    and target_registry_size > 0
                    and close_size_value > 0
                    and close_size_value + 1e-12 < target_registry_size
                )
                if is_partial_strategy_close:
                    partial_close_meta = _apply_partial_strategy_close_state(
                        symbol=symbol,
                        close_size=close_size_value,
                        roi=close_roi_used,
                        strategy_name=bot_name,
                        side=scoped_side,
                    )
                    closed_trade_ids = list(partial_close_meta.get('closed_trade_ids') or [])
                else:
                    closed_trade_ids = _close_all_open_learning_trades(
                        symbol=symbol,
                        roi=close_roi_used,
                        strategy_name=bot_name,
                        side=scoped_side,
                    )

                aggregate_notional = _position_margin_notional(open_pos.get('raw') or open_pos)
                aggregate_size = max(0.0, _safe_float(open_pos.get('size'), 0.0))
                realized_ratio = max(0.0, min(1.0, close_size_value / aggregate_size)) if aggregate_size > 0 else 1.0
                realized_pnl = aggregate_notional * _safe_float(close_roi_used, 0.0) * realized_ratio
                decision_sizer.update_result(bot_name, realized_pnl, roi=close_roi_used)
                if not is_partial_strategy_close:
                    clear_bot_peak(symbol, bot_name, hold_side)
                    lifecycle_engine.clear_state(symbol, bot_name, hold_side)
            response = {
                'status': 'ok',
                'symbol': symbol,
                'action': 'CLOSE',
                'dry_run': False,
                'closed_trade_ids': closed_trade_ids,
                'close_target_source': close_target_source,
                'requested_order_id': requested_order_id or None,
                'close_roi_used': close_roi_used,
                'partial_close_meta': partial_close_meta,
                'result': result,
                'learning_summary': _learning_summary_payload(recent_limit=4)['summary'],
            }
            return jsonify(response), 200

        bot_eval = None
        if forced_action:
            signal = forced_action
        else:
            bot_eval = _evaluate_bots(symbol)
            signal = bot_eval.get('signal')

        if not signal:
            _log_webhook_block('no_signal', symbol, forced_action=forced_action)
            _record_no_signal_stats(bot_eval)
            response = {'status': 'no_signal', 'symbol': symbol,
                        'bot_score': bot_eval.get('score', 0.0) if bot_eval else None,
                        'candidates': bot_eval.get('candidates', []) if bot_eval else [],
                        'no_signal_reason': bot_eval.get('no_signal_reason') if bot_eval else 'signal_missing',
                        'blocked_reasons': bot_eval.get('blocked_reasons', {}) if bot_eval else {},
                        'thresholds': bot_eval.get('thresholds', {}) if bot_eval else {},
                        'news_bias': bot_eval.get('news_bias', {}) if bot_eval else {}}
            if phase45_context:
                response['phase45'] = phase45_context
            return jsonify(response), 200

        if bot_eval and bot_eval.get('selected_alert'):
            selected_alert = _normalize_alert_name(bot_eval['selected_alert'])
        else:
            selected_alert = _normalize_alert_name(payload.get('alert_name'))
        decision = _build_trade_decision(bot_eval, signal, fallback_alert_name=selected_alert)
        selected_alert = decision['strategy']

        if DAILY_DD_GUARD_ENABLED and forced_action != 'CLOSE':
            daily_dd_ratio = _current_daily_drawdown_ratio()
            if daily_dd_ratio >= max(0.0, DAILY_DD_STOP_PCT):
                _log_webhook_block('daily_dd_guard', symbol, daily_dd_ratio=daily_dd_ratio, threshold=DAILY_DD_STOP_PCT)
                return jsonify({
                    'status': 'blocked',
                    'reason': 'daily_dd_guard',
                    'symbol': symbol,
                    'daily_dd_ratio': daily_dd_ratio,
                    'daily_dd_threshold': DAILY_DD_STOP_PCT,
                }), 200

        candles = get_candles(symbol, '5m')
        if not candles:
            _log_webhook_block('no_candles', symbol)
            return jsonify({'status': 'error', 'reason': 'no_candles', 'symbol': symbol}), 500

        last_close = _safe_float(candles[-1][4], 0.0) if candles and len(candles[-1]) > 4 else 0.0
        atr_value = _safe_float((bot_eval or {}).get('atr'), 0.0)
        atr_ratio = (atr_value / last_close) if last_close > 0 and atr_value > 0 else 0.0
        if not forced_action and atr_ratio > 0 and atr_ratio < MIN_ENTRY_ATR_RATIO:
            _log_webhook_block('low_volatility_filter', symbol, atr_ratio=atr_ratio, min_required=MIN_ENTRY_ATR_RATIO)
            return jsonify({
                'status': 'blocked',
                'reason': 'low_volatility_filter',
                'symbol': symbol,
                'atr_ratio': atr_ratio,
                'min_required': MIN_ENTRY_ATR_RATIO,
            }), 200

        est_mark = _safe_float(payload.get('mark_price') or payload.get('price') or last_close, 0.0)
        target_leverage_for_size = _target_leverage(symbol=symbol, bot_eval=bot_eval, atr_ratio=atr_ratio)
        live_balance = _safe_float(_get_live_balance(), 0.0)
        size_plan = decision_sizer.get_position_size(
            strategy_name=decision['strategy'],
            balance=live_balance,
            mark_price=est_mark,
            leverage=target_leverage_for_size,
        )
        base_size = _safe_float(size_plan.get('base_size'), 0.0)
        target_margin_notional = _safe_float(size_plan.get('target_margin_notional'), 0.0)
        target_margin_pct = _safe_float(size_plan.get('entry_margin_balance_pct'), 0.0)
        raw_size = payload.get('size')
        size_basis = 'margin_pct_5' if raw_size is None else 'margin_pct_5(payload_size_ignored)'
        size_multiplier = _safe_float(size_plan.get('strategy_multiplier'), 1.0)
        order_size_scale_applied = _safe_float(size_plan.get('order_size_scale'), 1.0)
        size = _safe_float(size_plan.get('size'), 0.0)
        min_size_floor = 0.0
        min_notional_floor = 0.0
        min_pct_floor = target_margin_pct
        min_floor_applied = False
        app.logger.info(
            'WEBHOOK_SIZE symbol=%s alert=%s signal=%s base_size=%s strategy_multiplier=%s order_size_scale=%s final_size=%s entry_margin_pct=%s target_margin=%s target_leverage=%s',
            symbol,
            selected_alert,
            signal,
            base_size,
            size_multiplier,
            order_size_scale_applied,
            size,
            target_margin_pct,
            target_margin_notional,
            target_leverage_for_size,
        )
        if size <= 0:
            _log_webhook_block('invalid_size', symbol, base_size=base_size, strategy_multiplier=size_multiplier, order_size_scale=ORDER_SIZE_SCALE, final_size=size)
            return jsonify({'status': 'error', 'reason': 'invalid_size', 'size': size}), 500

        est_notional = size * est_mark if est_mark > 0 else 0.0
        if est_notional > 0 and est_notional < MIN_ORDER_NOTIONAL_USDT:
            _log_webhook_block(
                'min_notional_guard',
                symbol,
                est_notional=est_notional,
                min_notional=MIN_ORDER_NOTIONAL_USDT,
                size=size,
                mark_price=est_mark,
            )
            return jsonify({
                'status': 'blocked',
                'reason': 'min_notional_guard',
                'symbol': symbol,
                'size': size,
                'estimated_notional': est_notional,
                'min_notional': MIN_ORDER_NOTIONAL_USDT,
            }), 200

        # 実ポジション数を渡してポートフォリオリスクを正しくチェック
        _live_positions = []
        try:
            _pos_resp = exchange_client.request('GET', '/api/v2/mix/position/all-position', {'productType': 'USDT-FUTURES'})
            _live_positions = [p for p in (_pos_resp.get('data') or []) if float(p.get('total', 0) or 0) > 0]
        except Exception:
            pass
        if not portfolio_engine.allow_trade(_live_positions):
            _log_webhook_block('portfolio_risk', symbol, open_positions=len(_live_positions))
            return jsonify({'status': 'blocked', 'reason': 'portfolio_risk', 'symbol': symbol}), 200
        if _is_duplicate_request(symbol, signal, size, alert_name=selected_alert):
            app.logger.warning('DUPLICATE_REQUEST_BLOCK symbol=%s signal=%s alert=%s size=%s', symbol, signal, selected_alert, size)
            return jsonify({'status': 'blocked', 'reason': 'duplicate_request', 'symbol': symbol, 'signal': signal, 'alert_name': selected_alert, 'size': size}), 200

        open_positions = _find_open_positions(symbol)
        strategy_same_side_positions = position_registry.get_all(symbol=symbol, strategy=selected_alert, side=signal)
        same_side_positions = [p for p in open_positions if p.get('side') == signal]
        opposite_positions = [p for p in open_positions if p.get('side') and p.get('side') != signal]
        has_same_side = bool(same_side_positions)
        has_opposite_side = bool(opposite_positions)
        if has_same_side and has_opposite_side:
            position_state = 'mixed'
        elif has_opposite_side:
            position_state = 'opposite_only'
        elif has_same_side:
            position_state = 'same_only'
        else:
            position_state = 'none'

        size_adjustment_meta = {
            'addon_scale': 1.0,
            'opposite_not_doten_scale': 1.0,
            'base_size_before_adjustments': size,
        }

        addon_rule = _addon_sizing_rule(selected_alert, len(strategy_same_side_positions))
        if position_state in ('same_only', 'mixed'):
            if not addon_rule.get('allowed'):
                _log_webhook_block(
                    'same_side_addon_limit',
                    symbol,
                    alert=selected_alert,
                    same_side_count=addon_rule.get('same_side_count'),
                    max_same_side=addon_rule.get('max_same_side'),
                )
                return jsonify({
                    'status': 'blocked',
                    'reason': 'same_side_addon_limit',
                    'symbol': symbol,
                    'signal': signal,
                    'position_state': position_state,
                    'addon_rule': addon_rule,
                }), 200

            addon_scale = max(0.0, min(1.0, _safe_float(addon_rule.get('size_scale'), 1.0)))
            size_adjustment_meta['addon_scale'] = addon_scale
            size = size * addon_scale

        doten_thresholds = _doten_thresholds_for_alert(selected_alert)
        doten_gate_passed = bool(forced_action is not None or _allow_doten_transition(bot_eval, selected_alert))
        should_try_doten = bool(has_opposite_side and ENABLE_DOTEN and doten_gate_passed)
        doten_skipped_reason = None
        if has_opposite_side and not ENABLE_DOTEN:
            doten_skipped_reason = 'doten_disabled'
        elif has_opposite_side and not doten_gate_passed:
            doten_skipped_reason = 'doten_gate_not_met'
            opposite_scale = max(0.0, min(1.0, _safe_float(OPPOSITE_NOT_DOTEN_SIZE_SCALE, 0.5)))
            size_adjustment_meta['opposite_not_doten_scale'] = opposite_scale
            size = size * opposite_scale

        if size <= 0:
            _log_webhook_block('invalid_size_after_adjustments', symbol, final_size=size, position_state=position_state)
            return jsonify({'status': 'blocked', 'reason': 'invalid_size_after_adjustments', 'symbol': symbol, 'size': size}), 200

        est_notional = size * est_mark if est_mark > 0 else 0.0
        if est_notional > 0 and est_notional < MIN_ORDER_NOTIONAL_USDT:
            _log_webhook_block(
                'min_notional_guard',
                symbol,
                est_notional=est_notional,
                min_notional=MIN_ORDER_NOTIONAL_USDT,
                size=size,
                mark_price=est_mark,
            )
            return jsonify({
                'status': 'blocked',
                'reason': 'min_notional_guard',
                'symbol': symbol,
                'size': size,
                'estimated_notional': est_notional,
                'min_notional': MIN_ORDER_NOTIONAL_USDT,
                'position_state': position_state,
                'size_adjustment_meta': size_adjustment_meta,
            }), 200

        leverage_meta = {'enabled': LEVERAGE_AUTO_ADJUST_ENABLED, 'applied': False, 'target_leverage': None}
        if should_try_doten:
            opposite_primary = max(opposite_positions, key=lambda p: _safe_float(p.get('size'), 0.0))
            opposite_side = str(opposite_primary.get('side') or '').upper()
            opposite_size_total = sum(
                _safe_float(p.get('size'), 0.0)
                for p in opposite_positions
                if str(p.get('side') or '').upper() == opposite_side
            )
            close_side = 'buy' if opposite_side == 'BUY' else 'sell'
            close_size = str(opposite_size_total or size)
            if DRY_RUN:
                result = {
                    'dry_run': True,
                    'symbol': symbol,
                    'signal': signal,
                    'size': size,
                    'doten': True,
                    'doten_mode': 'keep_both' if DOTEN_KEEP_BOTH_ENABLED else 'close_then_open',
                    'close_plan': {'side': close_side, 'size': close_size},
                }
            else:
                open_result = None
                close_result = None
                used_keep_both = bool(DOTEN_KEEP_BOTH_ENABLED)
                if used_keep_both:
                    leverage_meta = _prepare_entry_leverage(symbol=symbol, bot_eval=bot_eval, atr_ratio=atr_ratio)
                    if LEVERAGE_REQUIRE_SUCCESS and not leverage_meta.get('applied'):
                        return jsonify({
                            'status': 'blocked',
                            'reason': 'leverage_apply_failed',
                            'symbol': symbol,
                            'signal': signal,
                            'leverage_meta': leverage_meta,
                        }), 200
                    open_result = _execute_exchange_call(
                        'doten_keep_both_open',
                        lambda: execute_trade(symbol, signal, size),
                        interval_ms=ORDER_API_MIN_INTERVAL_MS,
                    )
                    if not _is_order_success(open_result):
                        used_keep_both = False

                if not used_keep_both:
                    close_result = _execute_exchange_call('doten_close', lambda: close_position(symbol, close_side, close_size))
                    if _is_order_success(close_result):
                        close_roi = _resolve_close_roi(payload, opposite_primary.get('raw') if opposite_primary else opposite_primary)
                        close_pnl = _position_margin_notional(opposite_primary.get('raw') or opposite_primary) * _safe_float(close_roi, 0.0)
                        _close_all_open_learning_trades(
                            symbol=symbol,
                            roi=close_roi,
                            strategy_name=_get_active_bot_name(symbol, side=opposite_side),
                            side=opposite_side,
                        )
                        decision_sizer.update_result(_get_active_bot_name(symbol, side=opposite_side), close_pnl, roi=close_roi)
                        leverage_meta = _prepare_entry_leverage(symbol=symbol, bot_eval=bot_eval, atr_ratio=atr_ratio)
                        if LEVERAGE_REQUIRE_SUCCESS and not leverage_meta.get('applied'):
                            return jsonify({
                                'status': 'blocked',
                                'reason': 'leverage_apply_failed',
                                'symbol': symbol,
                                'signal': signal,
                                'leverage_meta': leverage_meta,
                            }), 200
                        open_result = _execute_exchange_call(
                            'doten_open',
                            lambda: execute_trade(symbol, signal, size),
                            interval_ms=ORDER_API_MIN_INTERVAL_MS + DOTEN_REOPEN_DELAY_MS,
                        )
                result = {
                    'doten': True,
                    'doten_mode': 'keep_both' if used_keep_both else 'close_then_open',
                    'existing_side': opposite_side,
                    'close': close_result,
                    'open': open_result,
                }
        elif DRY_RUN:
            result = {
                'dry_run': True,
                'symbol': symbol,
                'signal': signal,
                'size': size,
                'entry_decision': 'alert_direct_entry',
                'position_state': position_state,
                'doten_skipped_reason': doten_skipped_reason,
            }
        else:
            leverage_meta = _prepare_entry_leverage(symbol=symbol, bot_eval=bot_eval, atr_ratio=atr_ratio)
            if LEVERAGE_REQUIRE_SUCCESS and not leverage_meta.get('applied'):
                return jsonify({
                    'status': 'blocked',
                    'reason': 'leverage_apply_failed',
                    'symbol': symbol,
                    'signal': signal,
                    'leverage_meta': leverage_meta,
                }), 200
            result = _execute_exchange_call('open', lambda: execute_trade(symbol, signal, size))

        if _is_rate_limited_response(result):
            return _rate_limit_http_response(symbol, signal, result)
        if isinstance(result, dict) and result.get('doten'):
            if _is_rate_limited_response(result.get('close')):
                return _rate_limit_http_response(symbol, 'DOTEN_CLOSE', result.get('close'))
            if result.get('doten_mode') == 'close_then_open' and result.get('open') is None and not _is_order_success(result.get('close')):
                return jsonify({
                    'status': 'blocked',
                    'reason': 'doten_close_failed',
                    'symbol': symbol,
                    'signal': signal,
                    'result': result,
                }), 200
            if _is_rate_limited_response(result.get('open')):
                return _rate_limit_http_response(symbol, 'DOTEN_OPEN', result.get('open'))

        trade_opened = False
        if not DRY_RUN:
            if isinstance(result, dict) and result.get('doten'):
                trade_opened = _is_order_success(result.get('open'))
            else:
                trade_opened = _is_order_success(result)

        if trade_opened:
            entry_context = _entry_context_from_eval(bot_eval, signal, alert_name=selected_alert)
            opened_position_id, opened_trade_id = _record_open_position_and_learning(
                symbol=symbol,
                entry_price=est_mark,
                size=float(size),
                decision=decision,
                signal_bundle=[decision['side'], decision['strategy'], 'webhook_v2'],
                rr_planned=_planned_rr_for_alert(decision['strategy']),
                entry_context=entry_context,
                source='webhook_v2',
                order_id=_extract_order_id(result),
            )
        else:
            opened_position_id = None
            opened_trade_id = None

        app.logger.info('TRADE_DECISION symbol=%s signal=%s size=%s result=%s', symbol, signal, size, result)
        response = {
            'status': 'ok',
            'symbol': symbol,
            'signal': signal,
            'alert_name': selected_alert,
            'decision': decision,
            'size': size,
            'position_state': position_state,
            'doten_skipped_reason': doten_skipped_reason,
            'doten_thresholds': doten_thresholds,
            'size_adjustment_meta': size_adjustment_meta,
            'addon_rule': addon_rule,
            'size_meta': {
                'base_size': base_size,
                'size_basis': size_basis,
                'balance_pct': BASE_ORDER_BALANCE_PCT,
                'entry_margin_balance_pct': target_margin_pct,
                'live_balance': live_balance,
                'target_margin_notional': target_margin_notional,
                'target_leverage_for_size': target_leverage_for_size,
                'estimated_mark_price': est_mark,
                'estimated_base_notional': (base_size * est_mark) if est_mark > 0 else None,
                'estimated_margin_from_size': ((base_size * est_mark) / target_leverage_for_size) if est_mark > 0 and target_leverage_for_size > 0 else None,
                'multiplier': size_multiplier,
                'order_size_scale': order_size_scale_applied,
                'min_entry_balance_pct': min_pct_floor,
                'min_entry_notional_floor': min_notional_floor if min_notional_floor > 0 else None,
                'min_entry_size_floor': min_size_floor if min_size_floor > 0 else None,
                'min_entry_floor_applied': min_floor_applied,
                'leverage': leverage_meta,
            },
            'dry_run': DRY_RUN,
            'result': result,
            'opened_position_id': opened_position_id,
            'opened_trade_id': opened_trade_id,
            'learning_summary': _learning_summary_payload(recent_limit=4)['summary'],
        }
        if bot_eval:
            response['bot_eval'] = {
                'selected_alert': selected_alert,
                'score': bot_eval.get('score', 0.0),
                'confidence': bot_eval.get('confidence', 0.0),
                'atr': bot_eval.get('atr'),
                'candidates': bot_eval.get('candidates', []),
                'news_bias': bot_eval.get('news_bias', {}),
            }
        if phase45_context:
            response['phase45'] = phase45_context
        return jsonify(response), 200

    except Exception as exc:
        _record_runtime_error(str(exc))
        app.logger.error('WEBHOOK_ERROR %s', str(exc))
        app.logger.error(traceback.format_exc())
        return jsonify({'status': 'error', 'message': str(exc)}), 500


@app.post('/monitor')
def monitor():
    _start_monitor_autopoll()

    guard = _acquire_monitor_run_guard()
    if not guard.get('allowed'):
        return jsonify({
            'status': 'ok',
            'updated': [],
            'errors': [],
            'skipped': guard.get('reason'),
            'guard': guard,
            'outcome_stats': _monitor_outcome_stats_payload(limit=48),
        }), 200

    updated = []
    errors = []

    try:
        response = exchange_client.request('GET', '/api/v2/mix/position/all-position', {'productType': 'USDT-FUTURES'})
        exchange_positions = [p for p in (response.get('data') or []) if _safe_float(p.get('total'), 0.0) > 0]
    except Exception as exc:
        return jsonify({'status': 'error', 'updated': [], 'errors': [{'scope': 'positions', 'error': str(exc)}], 'guard': guard}), 500

    exchange_position_map = _build_exchange_position_map(exchange_positions)
    registry_positions = position_registry.get_all()
    symbol_side_counts = {}
    for reg in registry_positions:
        reg_symbol = str(reg.get('symbol') or '').upper()
        reg_hold_side = _registry_side_to_hold_side(reg.get('side'))
        if not reg_symbol:
            continue
        symbol_side_counts[(reg_symbol, reg_hold_side)] = symbol_side_counts.get((reg_symbol, reg_hold_side), 0) + 1

    for reg in registry_positions:
        sym = str(reg.get('symbol') or '').upper()
        if not sym:
            continue
        try:
            reg_side = str(reg.get('side') or '').lower()
            hold_side = _registry_side_to_hold_side(reg_side)
            exchange_side = 'BUY' if hold_side == 'long' else 'SELL'
            exchange_pos = exchange_position_map.get((sym, exchange_side))
            if not exchange_pos:
                reconcile_result = None
                if MONITOR_RECONCILE_MISSING_EXCHANGE:
                    reconcile_result = _reconcile_registry_missing_exchange(reg, reason='exchange_position_not_found')
                    _record_reconcile_event(sym, reg.get('strategy'), reg_side, reconcile_result)
                updated.append({
                    'symbol': sym,
                    'side': hold_side,
                    'action': 'registry_position_missing_exchange_reconciled' if reconcile_result else 'registry_position_missing_exchange',
                    'bot_name': reg.get('strategy'),
                    'registry_position': {
                        'trade_id': reg.get('trade_id'),
                        'strategy': reg.get('strategy'),
                        'decision': reg.get('decision') or {},
                        'size': reg.get('size'),
                        'entry_price': reg.get('entry_price'),
                        'link_status': ((reg.get('entry_context') or {}).get('link_status')),
                    },
                    'reconcile': reconcile_result,
                })
                continue

            pos = _build_virtual_position(reg, exchange_pos)
            total = float(pos.get('total', 0) or 0)
            if total <= 0:
                continue
            entry_price = _position_entry_price(pos)
            if not entry_price:
                updated.append({'symbol': sym, 'side': hold_side, 'skipped': 'missing_entry_price', 'bot_name': reg.get('strategy')})
                continue

            bot_name = _normalize_alert_name(reg.get('strategy'))
            monitor_profile_source = 'position_registry'
            roi = _estimate_position_roi(pos)
            same_count = int(symbol_side_counts.get((sym, hold_side), 0))
            opposite_count = sum(
                int(count)
                for (bucket_sym, bucket_side), count in symbol_side_counts.items()
                if bucket_sym == sym and bucket_side != hold_side
            )
            position_state = 'mixed' if opposite_count > 0 else 'same_only'
            margin_notional = _position_margin_notional(pos)

            c5m = get_candles(sym, '5m') or []
            c15m = get_candles(sym, '15m') or []
            df5 = _bots_to_df(c5m) if c5m else None
            df15 = _bots_to_df(c15m) if c15m else None
            atr_value = _simple_atr(c5m)
            volume_drop = _is_volume_drop(c5m)
            atr_expanding = _is_atr_expanding(c5m)

            lifecycle = lifecycle_engine.evaluate(
                symbol=sym,
                bot_name=bot_name,
                position=pos,
                atr_value=atr_value,
                volume_drop=volume_drop,
                atr_expanding=atr_expanding,
                entry_context=reg.get('entry_context') or {},
            )
            _sync_registry_position_from_exchange(sym, bot_name, hold_side, pos, lifecycle=lifecycle)
            current_mark_price = _position_mark_price(pos) or entry_price
            managed_pos = _build_managed_registry_position(reg, current_mark_price)
            profile_exit = profile_exit_engine.evaluate_detail(managed_pos, current_mark_price)
            profile_actions = list(profile_exit.get('profile_actions') or [])
            profile_partial_actions = [item for item in profile_actions if str(item.get('kind') or '').endswith('partial')]
            profile_partial_tuples = [item for item in (profile_exit.get('actions') or []) if item[0] == 'partial']
            profile_trailing_action = next((item for item in profile_actions if item.get('kind') == 'trailing_close'), None)
            profile_has_close = any(action_name == 'close' for action_name, _ in (profile_exit.get('actions') or []))
            prefer_profile_partial = _should_prefer_profile_partial(lifecycle.get('reason'), profile_partial_tuples)
            monitor_detail = {
                'position_state': position_state,
                'monitor_profile_source': monitor_profile_source,
                'link_status': ((reg.get('entry_context') or {}).get('link_status') or 'unknown'),
                'same_side_count': same_count,
                'opposite_side_count': opposite_count,
                'lifecycle': lifecycle,
                'decision': reg.get('decision') or {},
                'registry_position': {
                    'trade_id': reg.get('trade_id'),
                    'strategy': bot_name,
                    'side': reg_side,
                    'size': total,
                    'entry_price': entry_price,
                    'link_status': ((reg.get('entry_context') or {}).get('link_status') or 'unknown'),
                },
                'tp_detail': {
                    'action': lifecycle.get('action'),
                    'reason': lifecycle.get('reason'),
                    'partial_ratio': lifecycle.get('partial_ratio'),
                    'partial_stage_target': lifecycle.get('partial_stage_target'),
                    'profile_actions': profile_actions,
                    'profile_partial_precedence': bool(prefer_profile_partial),
                },
                'sl_detail': {
                    'hybrid_stop': lifecycle.get('hybrid_stop'),
                    'stop_loss_price': lifecycle.get('stop_price'),
                },
                'structure_detail': {
                    'should_exit': bool(lifecycle.get('structure_exit')),
                    'reason': lifecycle.get('structure_reason'),
                    'consecutive_weak_bos': lifecycle.get('consecutive_weak_bos'),
                },
                'trailing_detail': {
                    'stop_price': None,
                    'trail_ratio': None,
                    'triggered': False,
                    'profile_trail_ratio': profile_trailing_action.get('ratio') if profile_trailing_action else None,
                    'profile_triggered': bool(profile_trailing_action and profile_has_close),
                },
                'volatility_detail': {
                    'volume_drop': bool(volume_drop),
                    'atr_expanding': bool(atr_expanding),
                    'runner_mode': bool(lifecycle.get('runner_mode')),
                },
                'doten_detail': {
                    'enabled': ENABLE_DOTEN,
                    'keep_both_enabled': DOTEN_KEEP_BOTH_ENABLED,
                },
            }

            if lifecycle.get('action') == 'close' and not prefer_profile_partial and not DRY_RUN:
                close_side = 'sell' if hold_side == 'long' else 'buy'
                close_res = close_position(sym, close_side, str(total))
                if _is_order_success(close_res):
                    realized_roi = lifecycle.get('roi', roi or 0.0)
                    realized_pnl = margin_notional * _safe_float(realized_roi, 0.0)
                    _record_monitor_outcome(position_state, bot_name, 'lifecycle_close', realized_roi, realized_pnl)
                    _log_exit_event(bot_name, realized_roi, lifecycle.get('reason'), symbol=sym, action='lifecycle_close')
                    _close_all_open_learning_trades(sym, roi=realized_roi, strategy_name=bot_name, side=reg_side)
                    decision_sizer.update_result(bot_name, realized_pnl, roi=realized_roi)
                    clear_bot_peak(sym, bot_name, hold_side)
                    lifecycle_engine.clear_state(sym, bot_name, hold_side)
                    updated.append({'symbol': sym, 'side': hold_side, 'action': 'lifecycle_close', 'bot_name': bot_name, 'exit_reason': lifecycle.get('reason'), 'roi': realized_roi, 'realized_pnl_est': realized_pnl, **monitor_detail})
                    continue

            if bool(lifecycle.get('structure_exit')) and not DRY_RUN:
                close_side = 'sell' if hold_side == 'long' else 'buy'
                close_res = close_position(sym, close_side, str(total))
                if _is_order_success(close_res):
                    realized_roi = lifecycle.get('roi', roi or 0.0)
                    realized_pnl = margin_notional * _safe_float(realized_roi, 0.0)
                    _record_monitor_outcome(position_state, bot_name, 'structure_close', realized_roi, realized_pnl)
                    _log_exit_event(bot_name, realized_roi, lifecycle.get('structure_reason'), symbol=sym, action='structure_close')
                    _close_all_open_learning_trades(sym, roi=realized_roi, strategy_name=bot_name, side=reg_side)
                    decision_sizer.update_result(bot_name, realized_pnl, roi=realized_roi)
                    clear_bot_peak(sym, bot_name, hold_side)
                    lifecycle_engine.clear_state(sym, bot_name, hold_side)
                    updated.append({'symbol': sym, 'side': hold_side, 'action': 'structure_close', 'bot_name': bot_name, 'exit_reason': lifecycle.get('structure_reason'), 'roi': realized_roi, 'realized_pnl_est': realized_pnl, **monitor_detail})
                    continue

            if profile_has_close and lifecycle.get('action') != 'close' and not bool(lifecycle.get('structure_exit')) and not DRY_RUN:
                close_side = 'sell' if hold_side == 'long' else 'buy'
                close_res = close_position(sym, close_side, str(total))
                if _is_order_success(close_res):
                    realized_roi = profile_exit.get('pnl_pct', roi or 0.0)
                    realized_pnl = margin_notional * _safe_float(realized_roi, 0.0)
                    profile_reason = str(profile_exit.get('reason') or 'profile_exit_close')
                    outcome_action = 'profile_trailing_close' if profile_trailing_action else 'profile_exit_close'
                    _record_monitor_outcome(position_state, bot_name, outcome_action, realized_roi, realized_pnl)
                    _log_exit_event(bot_name, realized_roi, profile_reason, symbol=sym, action=outcome_action)
                    _close_all_open_learning_trades(sym, roi=realized_roi, strategy_name=bot_name, side=reg_side)
                    decision_sizer.update_result(bot_name, realized_pnl, roi=realized_roi)
                    clear_bot_peak(sym, bot_name, hold_side)
                    lifecycle_engine.clear_state(sym, bot_name, hold_side)
                    updated.append({'symbol': sym, 'side': hold_side, 'action': outcome_action, 'bot_name': bot_name, 'exit_reason': profile_reason, 'roi': realized_roi, 'realized_pnl_est': realized_pnl, 'profile_exit_eval': profile_exit, **monitor_detail})
                    continue

            trail_result = update_bot_trailing(sym, pos, entry_price, bot_name, structure_stop_price=_safe_float(lifecycle.get('hybrid_stop'), 0.0), runner_mode=bool(lifecycle.get('runner_mode')), disable_trailing=bool(atr_expanding))
            monitor_detail['trailing_detail'] = {
                'stop_price': trail_result.get('stop_price'),
                'trail_ratio': trail_result.get('trail_ratio'),
                'triggered': bool(trail_result.get('triggered')),
                'disabled': bool(trail_result.get('disabled')),
                'profile_trail_ratio': profile_trailing_action.get('ratio') if profile_trailing_action else None,
                'profile_triggered': bool(profile_trailing_action and profile_has_close),
            }
            if trail_result.get('triggered'):
                actual_roi = trail_result.get('roi', roi or 0.0)
                realized_pnl = margin_notional * _safe_float(actual_roi, 0.0)
                _record_monitor_outcome(position_state, bot_name, 'trailing_stop_triggered', actual_roi, realized_pnl)
                _log_exit_event(bot_name, actual_roi, 'trailing_stop_triggered', symbol=sym, action='trailing_stop_triggered')
                _close_all_open_learning_trades(sym, roi=actual_roi, strategy_name=bot_name, side=reg_side)
                decision_sizer.update_result(bot_name, realized_pnl, roi=actual_roi)
                clear_bot_peak(sym, bot_name, hold_side)
                lifecycle_engine.clear_state(sym, bot_name, hold_side)
                updated.append({'symbol': sym, 'side': hold_side, 'action': 'trailing_stop_triggered', 'bot_name': bot_name, 'roi': actual_roi, 'stop_price': trail_result.get('stop_price'), 'realized_pnl_est': realized_pnl, **monitor_detail})
                continue

            if lifecycle.get('action') == 'partial' and not DRY_RUN:
                partial_ratio = _safe_float(lifecycle.get('partial_ratio'), 0.0)
                partial_size = max(0.0, total * partial_ratio)
                if partial_size > 0:
                    close_side = 'sell' if hold_side == 'long' else 'buy'
                    partial_res = close_position(sym, close_side, str(partial_size))
                    if _is_order_success(partial_res):
                        target_stage = int(_safe_int(lifecycle.get('partial_stage_target'), 0))
                        if target_stage > 0:
                            lifecycle_engine.set_partial_stage(sym, bot_name, hold_side, target_stage)
                        else:
                            lifecycle_engine.set_partial_taken(sym, bot_name, hold_side)
                        position_registry.reduce(int(reg.get('trade_id') or 0), partial_size)
                        learning_trade_id = int(((reg.get('entry_context') or {}).get('learning_trade_id') or 0))
                        _resize_learning_trade(learning_trade_id, max(0.0, _safe_float(reg.get('size'), 0.0) - partial_size))
                        realized_roi = lifecycle.get('roi', roi or 0.0)
                        realized_pnl = margin_notional * _safe_float(realized_roi, 0.0) * max(0.0, min(1.0, partial_ratio))
                        _record_monitor_outcome(position_state, bot_name, 'partial_tp', realized_roi, realized_pnl)
                        _log_exit_event(bot_name, realized_roi, lifecycle.get('reason'), symbol=sym, action='partial_tp')
                        decision_sizer.update_result(bot_name, realized_pnl, roi=realized_roi)
                        updated.append({'symbol': sym, 'side': hold_side, 'action': 'partial_tp', 'bot_name': bot_name, 'partial_size': partial_size, 'partial_stage': target_stage if target_stage > 0 else None, 'reason': lifecycle.get('reason'), 'roi': realized_roi, 'realized_pnl_est': realized_pnl, **monitor_detail})

            if profile_partial_tuples and lifecycle.get('action') != 'partial' and not DRY_RUN:
                updated_partial = list(managed_pos.partial_taken or [False, False, False])
                partial_stage, (_, partial_ratio) = next(enumerate(profile_partial_tuples, start=1))
                base_size = max(_safe_float((reg.get('entry_context') or {}).get('initial_size'), total), total)
                partial_size = max(0.0, min(total, base_size * _safe_float(partial_ratio, 0.0)))
                if partial_size > 0:
                    close_side = 'sell' if hold_side == 'long' else 'buy'
                    partial_res = close_position(sym, close_side, str(partial_size))
                    if not _is_order_success(partial_res):
                        errors.append({'symbol': sym, 'strategy': bot_name, 'error': f'profile_partial_exec_failed:{partial_res}'})
                    else:
                        reg_entry_context = dict(reg.get('entry_context') or {})
                        reg_entry_context['initial_size'] = max(_safe_float(reg_entry_context.get('initial_size'), total), total)
                        reg_entry_context['partial_taken'] = updated_partial
                        position_registry.reduce(int(reg.get('trade_id') or 0), partial_size)
                        position_registry.sync_live_position(
                            symbol=sym,
                            strategy=bot_name,
                            side=reg_side,
                            entry_price=entry_price,
                            size=max(0.0, total - partial_size),
                            mark_price=_position_mark_price(pos) or entry_price,
                            unrealized_pnl=_pick_first_float(pos, ('unrealizedPL', 'upl'), 0.0) or 0.0,
                            entry_context=reg_entry_context,
                            decision=reg.get('decision') or {},
                        )
                        learning_trade_id = int(((reg.get('entry_context') or {}).get('learning_trade_id') or 0))
                        _resize_learning_trade(learning_trade_id, max(0.0, _safe_float(reg.get('size'), 0.0) - partial_size))
                        realized_roi = profile_exit.get('pnl_pct', roi or 0.0)
                        realized_pnl = margin_notional * _safe_float(realized_roi, 0.0) * max(0.0, min(1.0, _safe_float(partial_ratio, 0.0)))
                        _record_monitor_outcome(position_state, bot_name, 'profile_partial_tp', realized_roi, realized_pnl)
                        _log_exit_event(bot_name, realized_roi, profile_exit.get('reason'), symbol=sym, action='profile_partial_tp')
                        decision_sizer.update_result(bot_name, realized_pnl, roi=realized_roi)
                        updated.append({'symbol': sym, 'side': hold_side, 'action': 'profile_partial_tp', 'bot_name': bot_name, 'partial_size': partial_size, 'partial_stage': partial_stage, 'reason': profile_exit.get('reason'), 'roi': realized_roi, 'realized_pnl_est': realized_pnl, **monitor_detail})

            exit_eval = {'should_exit': False, 'reason': 'skipped', 'confidence': 0.0}
            try:
                if df5 is not None and df15 is not None:
                    exit_eval = alert_bot_engine.evaluate_exit(bot_name, df5, df15, pos)
            except Exception as ex:
                exit_eval = {'should_exit': False, 'reason': f'eval_error:{ex}', 'confidence': 0.0}
            if exit_eval.get('should_exit') and float(exit_eval.get('confidence', 0)) >= 0.75 and not DRY_RUN:
                close_side = 'sell' if hold_side == 'long' else 'buy'
                try:
                    close_res = close_position(sym, close_side, str(total))
                    if _is_order_success(close_res):
                        realized_roi = roi or 0.0
                        realized_pnl = margin_notional * _safe_float(realized_roi, 0.0)
                        _record_monitor_outcome(position_state, bot_name, 'bot_exit_executed', realized_roi, realized_pnl)
                        _log_exit_event(bot_name, realized_roi, exit_eval.get('reason'), symbol=sym, action='bot_exit_executed')
                        _close_all_open_learning_trades(sym, roi=realized_roi, strategy_name=bot_name, side=reg_side)
                        decision_sizer.update_result(bot_name, realized_pnl, roi=realized_roi)
                        clear_bot_peak(sym, bot_name, hold_side)
                        lifecycle_engine.clear_state(sym, bot_name, hold_side)
                        updated.append({'symbol': sym, 'side': hold_side, 'action': 'bot_exit_executed', 'bot_name': bot_name, 'exit_reason': exit_eval.get('reason'), 'roi': realized_roi, 'realized_pnl_est': realized_pnl, 'stop_price': trail_result.get('stop_price'), 'bot_exit_eval': exit_eval, **monitor_detail})
                        continue
                except Exception as ex:
                    errors.append({'symbol': sym, 'strategy': bot_name, 'error': f'bot_exit_exec:{ex}'})

            learning_override = {'action': 'hold', 'reason': 'disabled'}
            learning_eval = None
            if LEARNING_ADAPTIVE_EXIT_ENABLED and c5m and c15m:
                try:
                    c1h = get_candles(sym, '1h') or []
                    if c1h:
                        news_bias = _news_bias_for_alerts(sym)
                        learning_eval = alert_bot_engine.evaluate(c5m, c15m, c1h, news_bias=news_bias, symbol=sym)
                        learning_override = _learning_override_decision(bot_name, hold_side, learning_eval)
                except Exception as ex:
                    learning_override = {'action': 'hold', 'reason': f'learning_override_error:{ex}'}

            learning_action = str(learning_override.get('action') or 'hold')
            if learning_action in ('close', 'reverse') and not DRY_RUN:
                reverse_signal = str(learning_override.get('target_signal') or '').upper() if learning_action == 'reverse' else ''
                reverse_alert = _normalize_alert_name(learning_override.get('target_alert')) if learning_action == 'reverse' else None

                if learning_action == 'reverse' and DOTEN_KEEP_BOTH_ENABLED and reverse_signal in ('BUY', 'SELL'):
                    reverse_leverage = _prepare_entry_leverage(symbol=sym, bot_eval=learning_eval, atr_ratio=0.0)
                    if LEVERAGE_REQUIRE_SUCCESS and not reverse_leverage.get('applied'):
                        updated.append({'symbol': sym, 'side': hold_side, 'action': 'learning_reverse_leverage_blocked', 'bot_name': bot_name, 'learning_override': learning_override, 'leverage_meta': reverse_leverage, **monitor_detail})
                        continue
                    keep_both_open_res = _execute_exchange_call('learning_override_keep_both_open', lambda: execute_trade(sym, reverse_signal, total), interval_ms=ORDER_API_MIN_INTERVAL_MS)
                    if _is_rate_limited_response(keep_both_open_res):
                        updated.append({'symbol': sym, 'side': hold_side, 'action': 'learning_reverse_keep_both_blocked', 'bot_name': bot_name, 'learning_override': learning_override, 'result': keep_both_open_res, **monitor_detail})
                        continue
                    if _is_order_success(keep_both_open_res):
                        entry_context = _entry_context_from_eval(learning_eval, reverse_signal, alert_name=reverse_alert)
                        _record_open_position_and_learning(symbol=sym, decision={'strategy': reverse_alert, 'side': reverse_signal, 'confidence': _safe_float((learning_eval or {}).get('confidence'), 0.0), 'score': _safe_float((learning_eval or {}).get('score'), 0.0)}, entry_price=_safe_float(_position_mark_price(pos), entry_price), size=float(total), signal_bundle=[reverse_signal, reverse_alert, 'learning_override_keep_both'], rr_planned=_planned_rr_for_alert(reverse_alert), entry_context=entry_context, source='learning_override_keep_both', order_id=_extract_order_id(keep_both_open_res))
                        updated.append({'symbol': sym, 'side': hold_side, 'action': 'learning_reverse_keep_both_executed', 'doten_mode': 'keep_both', 'bot_name': bot_name, 'from_alert': bot_name, 'to_alert': reverse_alert, 'reverse_signal': reverse_signal, 'learning_override': learning_override, **monitor_detail})
                        continue

                close_side = 'sell' if hold_side == 'long' else 'buy'
                close_res = _execute_exchange_call('learning_override_close', lambda: close_position(sym, close_side, str(total)))
                if _is_rate_limited_response(close_res):
                    updated.append({'symbol': sym, 'side': hold_side, 'action': 'learning_override_blocked', 'bot_name': bot_name, 'result': close_res, **monitor_detail})
                    continue

                if _is_order_success(close_res):
                    close_roi = roi or 0.0
                    close_pnl = margin_notional * _safe_float(close_roi, 0.0)
                    _close_all_open_learning_trades(sym, roi=close_roi, strategy_name=bot_name, side=reg_side)
                    decision_sizer.update_result(bot_name, close_pnl, roi=close_roi)
                    clear_bot_peak(sym, bot_name, hold_side)
                    lifecycle_engine.clear_state(sym, bot_name, hold_side)

                    if learning_action == 'reverse' and reverse_signal in ('BUY', 'SELL'):
                        reverse_leverage = _prepare_entry_leverage(symbol=sym, bot_eval=learning_eval, atr_ratio=0.0)
                        if LEVERAGE_REQUIRE_SUCCESS and not reverse_leverage.get('applied'):
                            updated.append({'symbol': sym, 'side': hold_side, 'action': 'learning_reverse_leverage_blocked', 'bot_name': bot_name, 'learning_override': learning_override, 'leverage_meta': reverse_leverage, **monitor_detail})
                            continue
                        open_res = _execute_exchange_call('learning_override_open', lambda: execute_trade(sym, reverse_signal, total), interval_ms=ORDER_API_MIN_INTERVAL_MS + DOTEN_REOPEN_DELAY_MS)
                        if _is_rate_limited_response(open_res):
                            updated.append({'symbol': sym, 'side': hold_side, 'action': 'learning_reverse_open_blocked', 'bot_name': bot_name, 'learning_override': learning_override, 'result': open_res, **monitor_detail})
                            continue
                        if _is_order_success(open_res):
                            _record_monitor_outcome(position_state, bot_name, 'learning_reverse_executed', close_roi, close_pnl)
                            entry_context = _entry_context_from_eval(learning_eval, reverse_signal, alert_name=reverse_alert)
                            _record_open_position_and_learning(symbol=sym, decision={'strategy': reverse_alert, 'side': reverse_signal, 'confidence': _safe_float((learning_eval or {}).get('confidence'), 0.0), 'score': _safe_float((learning_eval or {}).get('score'), 0.0)}, entry_price=_safe_float(_position_mark_price(pos), entry_price), size=float(total), signal_bundle=[reverse_signal, reverse_alert, 'learning_override'], rr_planned=_planned_rr_for_alert(reverse_alert), entry_context=entry_context, source='learning_override', order_id=_extract_order_id(open_res))
                            updated.append({'symbol': sym, 'side': hold_side, 'action': 'learning_reverse_executed', 'doten_mode': 'close_then_open', 'bot_name': bot_name, 'from_alert': bot_name, 'to_alert': reverse_alert, 'reverse_signal': reverse_signal, 'roi': close_roi, 'realized_pnl_est': close_pnl, 'learning_override': learning_override, **monitor_detail})
                            continue

                    _record_monitor_outcome(position_state, bot_name, 'learning_adaptive_close', close_roi, close_pnl)
                    updated.append({'symbol': sym, 'side': hold_side, 'action': 'learning_adaptive_close', 'bot_name': bot_name, 'roi': close_roi, 'realized_pnl_est': close_pnl, 'learning_override': learning_override, **monitor_detail})
                    continue

            updated.append({'symbol': sym, 'side': hold_side, 'size': total, 'bot_name': bot_name, 'entry_price': entry_price, 'mark_price': _position_mark_price(pos), 'roi_estimate': roi, 'stop_price': trail_result.get('stop_price'), 'trail_ratio': trail_result.get('trail_ratio'), **monitor_detail, 'bot_exit_eval': exit_eval, 'learning_override': learning_override})
        except Exception as exc:
            errors.append({'symbol': sym, 'strategy': reg.get('strategy'), 'error': str(exc)})

    registry_payload = [
        {
            'trade_id': int(item.get('trade_id', 0) or 0),
            'symbol': item.get('symbol'),
            'strategy': item.get('strategy'),
            'side': item.get('side'),
            'size': item.get('size'),
            'entry_price': item.get('entry_price'),
            'decision': item.get('decision') or {},
        }
        for item in registry_positions
    ]

    return jsonify({
        'status': 'ok',
        'updated': updated,
        'errors': errors,
        'guard': guard,
        'registry_positions': registry_payload,
        'exchange_position_count': len(exchange_positions),
        'outcome_stats': _monitor_outcome_stats_payload(limit=48),
    }), 200


@app.post('/state/sync')
def state_sync():
    _start_monitor_autopoll()
    try:
        payload = _perform_registry_initial_sync(trigger='api')
        return jsonify({'status': 'ok', **payload}), 200
    except Exception as exc:
        _record_runtime_error(str(exc))
        app.logger.error('STATE_SYNC_ERROR %s', str(exc))
        return jsonify({'status': 'error', 'message': str(exc)}), 500


def _acquire_monitor_run_guard():
    now_ts = int(time.time())
    min_interval = max(0, int(MONITOR_MIN_INTERVAL_SECONDS))
    run_timeout = max(5, int(MONITOR_RUN_TIMEOUT_SECONDS))

    conn = _runtime_conn()
    try:
        conn.execute('BEGIN IMMEDIATE')
        cur = conn.cursor()
        cur.execute('SELECT running_until, last_run_at FROM monitor_runtime_guard WHERE id = 1')
        row = cur.fetchone()

        running_until = int(row[0] or 0) if row else 0
        last_run_at = int(row[1] or 0) if row else 0

        if running_until > now_ts:
            conn.commit()
            return {
                'allowed': False,
                'reason': 'already_running',
                'running_until': running_until,
                'last_run_at': last_run_at,
            }

        if last_run_at > 0 and (now_ts - last_run_at) < min_interval:
            conn.commit()
            return {
                'allowed': False,
                'reason': 'min_interval',
                'running_until': running_until,
                'last_run_at': last_run_at,
            }

        cur.execute(
            'INSERT OR REPLACE INTO monitor_runtime_guard (id, running_until, last_run_at, updated_at) VALUES (1, ?, ?, ?)',
            (now_ts + run_timeout, now_ts, now_ts),
        )
        conn.commit()
        return {
            'allowed': True,
            'reason': 'run',
            'running_until': now_ts + run_timeout,
            'last_run_at': now_ts,
        }
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return {'allowed': True, 'reason': 'guard_error'}
    finally:
        conn.close()


def _try_acquire_monitor_lease(owner: str) -> bool:
    now_ts = int(time.time())
    lease_until = now_ts + max(5, MONITOR_SCHEDULER_LEASE_SECONDS)
    conn = _runtime_conn()
    try:
        conn.execute('BEGIN IMMEDIATE')
        cur = conn.cursor()
        cur.execute('SELECT owner, lease_until FROM monitor_scheduler_lease WHERE id = 1')
        row = cur.fetchone()
        current_owner = str(row[0]) if row else ''
        current_lease_until = int(row[1] or 0) if row else 0

        if (not row) or (current_lease_until < now_ts) or (current_owner == owner):
            cur.execute(
                'INSERT OR REPLACE INTO monitor_scheduler_lease (id, owner, lease_until, updated_at) VALUES (1, ?, ?, ?)',
                (owner, lease_until, now_ts),
            )
            conn.commit()
            return True

        conn.commit()
        return False
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return False
    finally:
        conn.close()


def _monitor_autopoll_loop(owner: str):
    interval = max(5, MONITOR_AUTOPOLL_INTERVAL_SECONDS)
    while True:
        try:
            if _try_acquire_monitor_lease(owner):
                req = urllib.request.Request('http://127.0.0.1:5001/monitor', data=b'', method='POST')
                with urllib.request.urlopen(req, timeout=25) as response:
                    _ = response.read()
        except Exception as exc:
            app.logger.warning('MONITOR_AUTOPOLL_ERROR owner=%s err=%s', owner, str(exc))
        time.sleep(interval)


def _start_monitor_autopoll():
    global _MONITOR_SCHEDULER_STARTED_PID
    if not MONITOR_AUTOPOLL_ENABLED:
        return

    current_pid = os.getpid()
    if _MONITOR_SCHEDULER_STARTED_PID == current_pid:
        return

    owner = f'worker-{current_pid}'
    thread = threading.Thread(
        target=_monitor_autopoll_loop,
        args=(owner,),
        daemon=True,
        name='monitor-autopoll',
    )
    thread.start()
    _MONITOR_SCHEDULER_STARTED_PID = current_pid
    app.logger.info(
        'MONITOR_AUTOPOLL_STARTED owner=%s interval=%s lease=%s',
        owner,
        MONITOR_AUTOPOLL_INTERVAL_SECONDS,
        MONITOR_SCHEDULER_LEASE_SECONDS,
    )


_start_monitor_autopoll()

if POSITION_REGISTRY_SYNC_ON_STARTUP:
    try:
        _perform_registry_initial_sync(trigger='startup')
    except Exception as exc:
        app.logger.warning('STATE_SYNC_STARTUP_ERROR %s', str(exc))

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001)
