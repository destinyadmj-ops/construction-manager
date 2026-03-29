import os
import logging
import numpy as np
import pandas as pd
import time
import requests
import json
from dataclasses import asdict, is_dataclass
import threading

# safe_json が実行時に受け取るオブジェクトの型を一度だけログするためのセット
_safe_json_seen_types = set()

# 完全安全なJSON変換（プロ仕様: 軽量・循環参照はNone返却）
def safe_json(obj, _visited=None):
    try:
        if _visited is None:
            _visited = set()

        # 実行時に渡されるオブジェクトの型情報を一度だけログする（本番での型収集用）
        try:
            type_key = (type(obj).__module__, type(obj).__name__)
        except Exception:
            type_key = ("<unknown>", "<unknown>")
        if type_key not in _safe_json_seen_types:
            _safe_json_seen_types.add(type_key)
            try:
                obj_repr = repr(obj)
            except Exception:
                obj_repr = '<unreprable>'
            logging.debug(f"safe_json seen type={type_key} repr={obj_repr[:200]}")
            # 1) リモート送信先が指定されていれば非同期で送信
            def _send_type_log_remote(tkey, orepr):
                try:
                    endpoint = os.getenv('SAFE_JSON_LOG_ENDPOINT') or os.getenv('SLACK_WEBHOOK_URL')
                    if not endpoint:
                        raise RuntimeError('no endpoint')
                    payload = {
                        'timestamp': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
                        'type': f"{tkey[0]}.{tkey[1]}",
                        'repr': orepr[:1000]
                    }
                    # 非同期で送るために短時間のタイムアウトで POST
                    try:
                        requests.post(endpoint, json=payload, timeout=2)
                    except Exception:
                        # Slack webhook expects JSON with 'text'
                        try:
                            requests.post(endpoint, json={"text": str(payload)}, timeout=2)
                        except Exception:
                            pass
                except Exception:
                    # リモート送信が使えない場合はファイルにフォールバック
                    try:
                        log_dir = os.path.join(os.path.dirname(__file__), '..', 'logs')
                        os.makedirs(log_dir, exist_ok=True)
                        log_path = os.path.join(log_dir, 'safe_json_types.log')
                        entry = {
                            'timestamp': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
                            'type': f"{tkey[0]}.{tkey[1]}",
                            'repr': orepr[:200].replace('\n', ' ')
                        }
                        with open(log_path, 'a', encoding='utf-8') as f:
                            f.write(json.dumps(entry, ensure_ascii=False) + '\n')
                    except Exception:
                        logging.debug("safe_json: failed to write type log file", exc_info=True)

            try:
                t = threading.Thread(target=_send_type_log_remote, args=(type_key, obj_repr), daemon=True)
                t.start()
            except Exception:
                logging.debug("safe_json: failed to start type log thread", exc_info=True)

        obj_id = id(obj)
        if obj_id in _visited:
            return None
        _visited.add(obj_id)

        if obj is None:
            return None
        if isinstance(obj, (str, int, float, bool)):
            return obj

        if isinstance(obj, dict):
            return {str(k): safe_json(v, _visited) for k, v in obj.items()}

        if isinstance(obj, (list, tuple, set)):
            return [safe_json(v, _visited) for v in obj]

        if is_dataclass(obj):
            # is_dataclass は dataclass のクラス/インスタンス両方で True を返すため、クラスは文字列化して扱う
            if isinstance(obj, type):
                return str(obj)
            try:
                return {k: safe_json(v, _visited) for k, v in asdict(obj).items()}
            except Exception:
                try:
                    return {k: safe_json(v, _visited) for k, v in vars(obj).items()}
                except Exception:
                    return str(obj)

        if hasattr(obj, "__dict__"):
            return {k: safe_json(v, _visited) for k, v in vars(obj).items()}

        # 未対応の型は文字列に変換
        return str(obj)

    except Exception as e:
        try:
            obj_repr = repr(obj)
        except Exception:
            obj_repr = '<unreprable object>'
        logging.exception(f"safe_json error for object type={type(obj)} repr={obj_repr[:200]}: {e}")
        return None
SLACK_WEBHOOK_URL = os.getenv('SLACK_WEBHOOK_URL')
LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO').upper()
logging.basicConfig(level=LOG_LEVEL, format='[%(asctime)s] %(levelname)s %(message)s')

def notify_slack(message: str):
    if SLACK_WEBHOOK_URL:
        try:
            requests.post(SLACK_WEBHOOK_URL, json={"text": message}, timeout=5)
        except Exception as e:
            logging.error(f"Slack通知失敗: {e}")

def critical_stop(reason: str):
    logging.critical(f"[CRITICAL STOP] {reason}")
    notify_slack(f"[CRITICAL STOP] {reason}")
    raise SystemExit(f"[CRITICAL STOP] {reason}")
from typing import Optional
from bot_v2.portfolio_utils import normalize_weights
from bot_v2.portfolio_utils import compute_size, should_exit, partial_take_profit, compute_reward, apply_slippage, DataValidator
from bot_v2.datafeed.trades_db import record_trade
from env.trading_env import TradingEnv
from env.regime_env import RegimeEnv
from rl.replay_buffer import ReplayBuffer
from rl.online_ppo import OnlinePPO
from reward_engine import RewardEngine
from pnl_tracker import PnLTracker
from shared_state import publish_weights, get_weights as get_dist_weights, publish_pnl, get_all_pnl, heartbeat, is_master
from rl.optuna_live import optimize_step
from trailing_utils import dynamic_trailing

def load_data(symbols, n_bars=500):
    # 仮: 各シンボルごとにダミー時系列を生成
    data = {}
    for sym in symbols:
        df = pd.DataFrame({
            'rsi': 50 + np.random.randn(n_bars),
            'atr': 100 + 10 * np.random.randn(n_bars),
            'return': np.random.randn(n_bars) * 0.001,
            'volume': np.abs(1000 + 100 * np.random.randn(n_bars)),
            'close': 68000 + np.random.randn(n_bars).cumsum(),
            'open': 68000 + np.random.randn(n_bars).cumsum(),
            'high': 68100 + np.random.randn(n_bars).cumsum(),
            'low': 67900 + np.random.randn(n_bars).cumsum(),
        })
        data[sym] = df
    return data


def compute_score(row):
    return row.get("rsi", 50) / 100

def adjust_by_regime(w, regime):
    return w

def risk_force_hook(bitget, symbol, manager):
    return {"status": "ok"}

def record_rejected_signal(**kwargs):
    try:
        from bot_v2.datafeed.rejected_signals_db import record_rejected_signal as _db_record
        # map expected args
        symbol = kwargs.get('symbol')
        alert_name = kwargs.get('alert_name')
        side = kwargs.get('side')
        score = float(kwargs.get('score', 0.0))
        threshold = float(kwargs.get('threshold', 0.0))
        reason = str(kwargs.get('reason', 'unknown'))
        extra = kwargs.get('extra')
        try:
            _db_record(symbol=symbol, alert_name=alert_name, side=side, score=score, threshold=threshold, reason=reason, extra=extra)
        except Exception as e:
            print(f"[record_rejected_signal] DB record failed: {e}")
    except Exception:
        # best-effort: do not raise from monitoring/decision path
        return


from bot_v2.ai.reinforcement_learning_trader import ReinforcementLearningTrader
from bot_v2.market.microstructure_engine import MarketMicrostructureEngine
from bot_v2.models.market_snapshot import MarketSnapshot, OrderBookFeatures, VenueQuote
from bot_v2.strategy.cross_exchange_arbitrage_engine import CrossExchangeArbitrageEngine


from bot_v2.filters.funding_rate_filter import FundingRateFilter
from bot_v2.analytics.liquidation_map import LiquidationMapEngine
from bot_v2.risk.monte_carlo_risk_engine import MonteCarloRiskEngine
from bot_v2.datafeed.websocket_market_data import WebsocketMarketData
from bot_v2.datafeed.price_feed import PriceFeed
from bot_v2.bitget_futures_client import BitgetFuturesClient
from bot_v2.position.position_manager import PositionManager, Position as ManagedPosition
from bot_v2.execution.position_exit_engine import PositionExitEngine
from bot_v2.execution.order_utils import extract_fill_price
from bot_v2.execution.time_exit import TimeExit
from bot_v2.risk.advanced_position_sizer import AdvancedPositionSizer
from bot_v2.risk.meta_allocator import MetaAllocator
from bot_v2.execution.execution_optimizer import ExecutionOptimizer
from bot_v2.risk.execution_tracker import ExecutionTracker
from bot_v2.config import (
    ALERT_B_EMA_FAST,
    ALERT_B_EMA_SLOW,
    ALERT_B_BOS_LEN,
    ALERT_B_VOL_MULTIPLIER,
    ALERT_C_EMA_FAST,
    ALERT_C_EMA_SLOW,
    ALERT_C_EMA_FLAT_BPS,
    ALERT_C_VOL_WINDOW,
    ALERT_C_VOL_MAX_STD,
    ALERT_C_RANGE_LOOKBACK,
    ALERT_C_RSI_LEN,
    ALERT_C_RSI_OVERSOLD,
    ALERT_C_RSI_OVERBOUGHT,
    ALERT_C_SWEEP_LOOKBACK,
    ALERT_D_VOL_WINDOW,
    ALERT_D_VOL_THRESHOLD,
    ALERT_D_SESSION_START_UTC,
    ALERT_D_SESSION_END_UTC,
    ALERT_D_MICRO_BOS_LEN,
    ALERT_D_RSI_LEN,
    ALERT_D_RSI_CROSS_LEVEL,
    ALERT_D_REQUIRE_ALL,
    ALERT_A_INITIAL_WEIGHT,
    ALERT_B_INITIAL_WEIGHT,
    ALERT_C_INITIAL_WEIGHT,
    ALERT_D_INITIAL_WEIGHT,
    ALERT_A_PLANNED_RR,
    ALERT_B_PLANNED_RR,
    ALERT_C_PLANNED_RR,
    ALERT_D_PLANNED_RR,
    DOTEN_COOLDOWN_SECONDS,
    DOTEN_MIN_SIZE_ONLY,
    DOTEN_MIN_SIZE,
)
from bot_v2.strategy.orderblock_detector import OrderBlockDetector
from bot_v2.strategy.smc_alert_engine import SMCAlertEngine
from bot_v2.strategy.market_regime_alert_engine import MarketRegimeAlertEngine
from bot_v2.strategy.liquidity_sweep_engine import LiquiditySweepEngine
from bot_v2.strategy.range_rebound_alert_engine import RangeReboundAlertEngine
from bot_v2.strategy.trigger_separated_alert_engine import TriggerSeparatedAlertEngine
from bot_v2.ai.alert_learning_engine import AlertLearningEngine

import os
import pandas as pd
import numpy as np
from bot_v2.datafeed import indicators_engine

############################################################
# === RL統合用 ===
# TODO: 責務分離（WebSocket, RL, 発注, リスク, DB, アラート, PPO推論）
############################################################
import sys
sys.path.append('.')  # ルート直下のppo_inference.pyをimport可能に
try:
    from ppo_inference import get_weights
except ImportError:
    get_weights = None  # fallback

def build_rl_features(df):
    # シンプル特徴量例: RSI, ATR, Volume, Close
    rsi = float(df.iloc[-1]["rsi"]) if "rsi" in df.columns else 50.0
    atr = float(df.iloc[-1]["atr"]) if "atr" in df.columns else 0.0
    volume = float(df.iloc[-1]["volume"]) if "volume" in df.columns else 0.0
    close = float(df.iloc[-1]["close"]) if "close" in df.columns else 0.0
    return np.array([rsi * 0.01, atr * 0.1, volume * 0.00001, close * 0.00001], dtype=np.float32)


def build_demo_snapshot() -> MarketSnapshot:
    features = OrderBookFeatures(
        spread_bps=5.4,
        imbalance=0.31,
        top_depth_ratio=1.08,
        aggressive_buy_ratio=0.62,
    )
    venue_quotes = {
        "bitget": VenueQuote(
            venue="bitget",
            bid=68250.0,
            ask=68252.0,
            taker_fee_bps=6.0,
            maker_fee_bps=2.0,
            est_slippage_bps=1.4,
            latency_ms=38,
        ),
        "bybit": VenueQuote(
            venue="bybit",
            bid=68256.5,
            ask=68258.0,
            taker_fee_bps=5.5,
            maker_fee_bps=2.0,
            est_slippage_bps=1.2,
            latency_ms=44,
        ),
    }
    return MarketSnapshot(
        symbol="BTCUSDT",
        mid_price=68253.25,
        funding_rate_8h=0.00008,
        volatility_1m=0.0022,
        features=features,
        venue_quotes=venue_quotes,
    )


def build_state_key(snapshot: MarketSnapshot, micro_score: float) -> str:
    trend = "up" if micro_score > 0.1 else "down" if micro_score < -0.1 else "flat"
    vol = "high" if snapshot.volatility_1m > 0.003 else "normal"
    funding = "pos" if snapshot.funding_rate_8h >= 0 else "neg"
    return f"{trend}|{vol}|{funding}"


def _normalize_order_symbol(symbol: str) -> str:
    return symbol.replace("_UMCBL", "")


def _place_entry_order(bitget: BitgetFuturesClient, symbol: str, action: str, size: float):
    side = "buy" if action == "buy" else "sell"
    return bitget.place_order(
        symbol=_normalize_order_symbol(symbol),
        product_type="USDT-FUTURES",
        margin_mode="crossed",
        margin_coin="USDT",
        side=side,
        trade_side="open",
        size=size,
        order_type="market",
    )


def _place_close_order(bitget: BitgetFuturesClient, symbol: str, side: str, size: float):
    # sideがNoneの場合はデフォルトで'sell'を使う
    side_str = side if side is not None else "sell"
    return bitget.place_order(
        symbol=_normalize_order_symbol(symbol),
        product_type="USDT-FUTURES",
        margin_mode="crossed",
        margin_coin="USDT",
        side=side_str,
        trade_side="close",
        size=size,
        order_type="market",
    )


def _to_position_side(hold_side: str | None):
    normalized = str(hold_side or "").lower()
    if normalized in ("long", "buy", "open_long"):
        return "buy"
    if normalized in ("short", "sell", "open_short"):
        return "sell"
    return None


def _close_side_for_position(position_side: str | None):
    if position_side == "buy":
        return "sell"
    if position_side == "sell":
        return "buy"
    return "sell"  # デフォルトでsell


def _is_success(resp: dict | None):
    return str((resp or {}).get("code", "")) == "00000"


def _get_open_position(symbol: str, strategy: Optional[str] = None, side: Optional[str] = None):
    """PositionManager/Registry経由でオープンポジションを取得"""
    manager = PositionManager()
    open_positions = manager.get_all()
    for pos in open_positions:
        if pos.symbol == _normalize_order_symbol(symbol) and (strategy is None or pos.strategy == strategy) and (side is None or pos.side == side):
            if not getattr(pos, 'closed', False):
                return {
                    "symbol": pos.symbol,
                    "size": pos.size,
                    "hold_side": pos.side,
                    "side": pos.side,
                }
    return None


def run_position_manager_cycle(
    bitget: BitgetFuturesClient,
    symbol: str,
    strategy: str,
    side: str,
    balance: float = 1000.0,
    mark_price: float = 68000.0,
    use_price_feed: bool = False,
):
    alert_learning = AlertLearningEngine(
        initial_weights={
            'alert_a': ALERT_A_INITIAL_WEIGHT,
            'alert_b': ALERT_B_INITIAL_WEIGHT,
            'alert_c': ALERT_C_INITIAL_WEIGHT,
            'alert_d': ALERT_D_INITIAL_WEIGHT,
        }
    )
    import bot_v2.config as _config
    sizer = AdvancedPositionSizer(
        base_risk=float(os.getenv('ENTRY_MARGIN_BALANCE_PCT', str(getattr(_config, 'ENTRY_MARGIN_BALANCE_PCT', 0.03)))),
        min_alloc=float(os.getenv('ADVANCED_SIZER_MIN_ALLOC', '0.12')),
        max_alloc=float(os.getenv('ADVANCED_SIZER_MAX_ALLOC', '0.50')),
    )
    for name in ('alert_a', 'alert_b', 'alert_c', 'alert_d'):
        sizer.register(name)
    leverage = float(os.getenv('LEVERAGE_DEFAULT', '40'))
    learning_summary = alert_learning.get_alert_summary()
    rl_bias_map = {
        name: max(0.7, min(1.3, 0.85 + float((learning_summary.get(name) or {}).get('win_rate', 0.5))))
        for name in ('alert_a', 'alert_b', 'alert_c', 'alert_d')
    }
    size_plan = sizer.get_size(strategy, balance, rl_bias_map=rl_bias_map)
    risk_budget = float(size_plan.get('size', 0.0))
    size = (risk_budget * leverage / mark_price) if mark_price > 0 and leverage > 0 else 0.0
    if size <= 0:
        return {'status': 'invalid_size', 'size_plan': size_plan}

    entry_resp = _place_entry_order(bitget, symbol, side, size)
    if not _is_success(entry_resp):
        return {'status': 'entry_failed', 'entry_resp': entry_resp, 'size_plan': size_plan}

    manager = PositionManager()
    exit_engine = PositionExitEngine()
    time_exit = TimeExit(float(os.getenv('POSITION_MAX_HOLD_SECONDS', '1800')))
    price_feed = None
    runtime_price = mark_price
    if use_price_feed:
        price_feed = PriceFeed(symbols=[_normalize_order_symbol(symbol)])
        price_feed.start()
        runtime_price = price_feed.wait_for_price(symbol, timeout=5.0) or mark_price
    fill_price = extract_fill_price(entry_resp) or runtime_price
    # 既存ポジションがなければ新規追加
    existing = [p for p in manager.get_all() if p.symbol == _normalize_order_symbol(symbol) and p.side == side and not getattr(p, 'closed', False)]
    if not existing:
        pos = ManagedPosition(
            symbol=_normalize_order_symbol(symbol),
            strategy=strategy,
            side=side,
            entry_price=fill_price,
            size=size,
        )
        manager.add(pos)
    else:
        pos = existing[0]
    manager.update_pnl({pos.symbol: runtime_price})
    detail = {'actions': [('close', 1.0)], 'reason': 'time_exit'} if time_exit.should_exit(pos) else exit_engine.evaluate_detail(pos, runtime_price)
    actions = detail.get('actions', [])
    if not actions:
        if price_feed is not None:
            price_feed.stop()
        return {'status': 'open', 'actions': [], 'detail': detail, 'size_plan': size_plan, 'entry_resp': entry_resp, 'price': runtime_price}

    executions = []
    partial_stage = 0
    for action_index, (action_name, ratio) in enumerate(actions):
        if action_name == 'partial':
            close_size = min(pos.size, max(0.0, pos.size * float(ratio)))
            partial_index = partial_stage
            partial_stage += 1
        else:
            close_size = pos.size
            partial_index = None
        if close_size <= 0:
            continue
        close_side = _close_side_for_position(pos.side)
        # No positionエラー防止: クローズ前に存在確認
        if not any(p.symbol == pos.symbol and p.side == pos.side and not getattr(p, 'closed', False) for p in manager.get_all()):
            continue
        close_resp = _place_close_order(bitget, symbol, close_side, close_size)
        execution = {'action': action_name, 'ratio': ratio, 'close_size': close_size, 'close_resp': close_resp}
        if _is_success(close_resp):
            realized_profit = pos.unrealized_pnl * (close_size / max(pos.size, 1e-12))
            sizer.update(pos.strategy, realized_profit, balance=balance)
            alert_learning.record_strategy_result(pos.strategy, float(realized_profit))
            if action_name == 'partial':
                manager.reduce(pos, close_size, partial_index=partial_index)
            else:
                manager.remove(pos)
            execution['profit'] = realized_profit
        executions.append(execution)

    if price_feed is not None:
        price_feed.stop()
    return {
        'status': 'closed' if any(item.get('action') == 'close' and _is_success(item.get('close_resp')) for item in executions) else 'managed',
        'actions': actions,
        'detail': detail,
        'size_plan': size_plan,
        'entry_resp': entry_resp,
        'executions': executions,
        'price': runtime_price,
    }


def run_position_manager_exit_iteration(
    bitget: BitgetFuturesClient,
    manager: PositionManager,
    price_feed: PriceFeed,
    strategy_result_recorder,
):
    open_positions = list(manager.get_all())
    if not open_positions:
        return []

    price_map = {}
    for pos in open_positions:
        live_price = price_feed.get_price(pos.symbol)
        if live_price is not None:
            price_map[pos.symbol] = live_price

    manager.update_pnl(price_map)
    exit_engine = PositionExitEngine()
    time_exit = TimeExit(float(os.getenv('POSITION_MAX_HOLD_SECONDS', '1800')))
    results = []
    for pos in list(manager.get_all()):
        current_price = price_map.get(pos.symbol)
        if current_price is None:
            continue
        detail = {'actions': [('close', 1.0)], 'reason': 'time_exit'} if time_exit.should_exit(pos) else exit_engine.evaluate_detail(pos, current_price)
        actions = detail.get('actions', [])
        partial_stage = 0
        for stage_index, (action_name, ratio) in enumerate(actions):
            if action_name == 'partial':
                close_size = min(pos.size, max(0.0, pos.size * float(ratio)))
                partial_index = partial_stage
                partial_stage += 1
            else:
                close_size = pos.size
                partial_index = None
            if close_size <= 0:
                continue
            close_side = _close_side_for_position(pos.side)
            # No positionエラー防止: クローズ前に存在確認
            if not any(p.symbol == pos.symbol and p.side == pos.side and not getattr(p, 'closed', False) for p in manager.get_all()):
                continue
            close_resp = _place_close_order(bitget, pos.symbol, close_side, close_size)
            if not _is_success(close_resp):
                results.append({'symbol': pos.symbol, 'action': action_name, 'status': 'close_failed', 'response': close_resp, 'detail': detail})
                continue
            realized_profit = pos.unrealized_pnl * (close_size / max(pos.size, 1e-12))
            strategy_result_recorder(pos.strategy, realized_profit)
            # --- トレード履歴DBに記録 ---
            try:
                record_trade(
                    symbol=pos.symbol,
                    side=pos.side,
                    entry_price=getattr(pos, 'entry_price', None) or 0.0,
                    exit_price=current_price,
                    size=close_size,
                    pnl=realized_profit,
                    exit_reason=detail.get('reason', action_name),
                    extra={"partial_index": partial_index, "strategy": getattr(pos, 'strategy', None)}
                )
            except Exception as e:
                print(f"[trade_log_error] {e}")
            if action_name == 'partial':
                manager.reduce(pos, close_size, partial_index=partial_index)
            else:
                manager.remove(pos)
            results.append({'symbol': pos.symbol, 'action': action_name, 'status': 'ok', 'close_size': close_size, 'profit': realized_profit, 'detail': detail})
    return results


def main() -> None:
    global funding_rate, snapshot, market_data
    try:
        # === [Layer 1: DataFeed] ===
        # Websocketでリアルタイムデータ取得
        ws_url = "wss://ws.bitget.com/mix/v2/stream"
        subscribe_msg = {
            "op": "subscribe",
            "args": [
                {"instType": "UMCBL", "channel": "ticker", "instId": "BTCUSDT_UMCBL"},
                {"instType": "UMCBL", "channel": "books1", "instId": "BTCUSDT_UMCBL"}
            ]
        }
        ws_data = WebsocketMarketData(ws_url, subscribe_msg)
        ws_data.start()
        import time
        time.sleep(2)  # データ蓄積待ち
        ws_data.stop()
        market_data = ws_data.data[-1] if ws_data.data else {}

        # === [Layer 2: MarketSnapshot] ===
        snapshot = build_demo_snapshot()
        # Funding Rate取得例（仮: デモ値）
        funding_rate = snapshot.funding_rate_8h
    except Exception as e:
        logging.error(f"[運用監視] main()で例外発生: {e}", exc_info=True)
        notify_slack(f"[運用監視] main()で例外発生: {e}")
        critical_stop(f"main()で例外発生: {e}")

    # === [Sharpe/Regime/Execution/約定トラッキング初期化] ===
    allocator = MetaAllocator()
    executor = ExecutionOptimizer()
    if executor.is_paused():
        logging.critical('[運用監視] ExecutionOptimizerは一時停止状態です。発注を停止します。')
        notify_slack('[運用監視] ExecutionOptimizerがpausedです。運用を確認してください。')
        # 全エントリ停止
        allow_entry = False
    tracker = ExecutionTracker()

    # === [Layer 3: Engine Initialization] ===
    micro_engine = MarketMicrostructureEngine()
    arb_engine = CrossExchangeArbitrageEngine()
    rl_trader = ReinforcementLearningTrader()
    funding_filter = FundingRateFilter()
    liquidation_map = LiquidationMapEngine()
    monte_carlo = MonteCarloRiskEngine()
    alert_learning = AlertLearningEngine(
        initial_weights={
            "alert_a": ALERT_A_INITIAL_WEIGHT,
            "alert_b": ALERT_B_INITIAL_WEIGHT,
            "alert_c": ALERT_C_INITIAL_WEIGHT,
            "alert_d": ALERT_D_INITIAL_WEIGHT,
        }
    )
    reward_engine = RewardEngine()
    # --- Bitget APIクライアント初期化 ---
    api_key = os.getenv("EXCHANGE_API_KEY", "")
    api_secret = os.getenv("EXCHANGE_API_SECRET", "")
    passphrase = os.getenv("EXCHANGE_PASSPHRASE", "")
    bitget = BitgetFuturesClient(api_key, api_secret, passphrase)


    # === [Layer 4: Entry Condition/Scoring/資金配分] ===
    allow_entry = funding_filter.allow_entry(funding_rate)
    positions = []  # ← 実データで置換
    liq_bins = liquidation_map.build_map(positions)
    liq_heatmap = liquidation_map.to_heatmap(liq_bins)
    returns = [0.01, -0.005, 0.002, 0.003, -0.004] * 20
    risk_stats = monte_carlo.simulate(returns)

    # --- DataValidatorでWS監視 ---
    validator = DataValidator(timeout=5)
    entry_symbols = ["BTCUSDT_UMCBL"]  # 実運用時は複数シンボル対応
    features_list = []
    scores = []
    regimes = []
    for symbol in entry_symbols:
        # 仮: market_dataから特徴量生成
        row = {
            "rsi": market_data.get("rsi", 50),
            "atr": market_data.get("atr", 100),
            "close": market_data.get("close", 68000),
            "volume": market_data.get("volume", 1000),
            "return": market_data.get("return", 0.0),
        }
        features_list.append(row)
        scores.append(compute_score(row))
        # regime例: trend/range/other
        regimes.append(market_data.get("regime", "trend"))
        validator.update(symbol)

    weights = normalize_weights(scores)
    # regime補正
    weights = [adjust_by_regime(w, regimes[idx]) for idx, w in enumerate(weights)]
    balance = float(os.getenv("ACCOUNT_BALANCE", "1000.0"))
    volatility = market_data.get("volatility", 0.01)
    sizes = [compute_size(balance, w, volatility) for w in weights]

    # --- Arb: raw（ロジック/学習用）とjson（ログ/出力用）を分離 ---
    best_arb_raw = arb_engine.best(snapshot)
    # net_edge_bps はオブジェクト属性か dict のキーとして来る可能性があるため両対応で安全取得
    if best_arb_raw:
        if isinstance(best_arb_raw, dict):
            arb_score = float(best_arb_raw.get('net_edge_bps', 0.0) or 0.0)
        else:
            arb_score = float(getattr(best_arb_raw, 'net_edge_bps', 0.0) or 0.0)
    else:
        arb_score = 0.0
    best_arb_json = safe_json(best_arb_raw) if best_arb_raw else {}

    # --- エントリー判定・発注（スリッページ補正/WS監視） ---
    entry_results = []
    for idx, symbol in enumerate(entry_symbols):
        weight = weights[idx]
        size = sizes[idx]
        # WSデータがstaleならweight=0
        if validator.is_stale(symbol):
            weight = 0
        if weight > 0.02:
            side = "buy"  # 仮: RL/裁定/シグナルで決定
            price = market_data.get("close", 68000)
            price_slip = apply_slippage(price, side)
            order_resp = _place_entry_order(bitget, symbol, side, size)
            entry_results.append({"symbol": symbol, "side": side, "size": size, "weight": weight, "order_resp": order_resp, "price_slip": price_slip})
        else:
            entry_results.append({"symbol": symbol, "side": "skip", "reason": "weight_low_or_stale"})

    # --- Exit/部分利確/報酬設計 ---
    # 仮: 最後のエントリー結果からweight/sizeを取得
    last_entry = next((e for e in reversed(entry_results) if e.get("side") != "skip"), None)
    if last_entry:
        weight = last_entry["weight"]
        size = last_entry["size"]
        prev_weight = weight  # 本来は履歴管理
        pnl = market_data.get("pnl", 0.0)
        holding_time = market_data.get("holding_time", 10)
        exit_flag, exit_reason = should_exit(weight, prev_weight, pnl, holding_time)
        position = {"size": size, "tp1": False, "tp2": False}
        position = partial_take_profit(position, pnl)
    else:
        exit_flag, exit_reason, position = None, None, None
    turnover = market_data.get("turnover", 0.0)
    reward = compute_reward(returns, turnover)
    # --- RL状態(obs)・報酬設計の拡張 ---
    # obs: [特徴量..., weight, unrealized_pnl, holding_time]
    obs = []
    if last_entry:
        obs.extend([
            last_entry.get("weight", 0.0),
            market_data.get("unrealized_pnl", 0.0),
            market_data.get("holding_time", 10)
        ])
    # RL学習ループ例（PPO/SAC等に渡す想定）
    # rl_trader.learn(obs, action, reward, next_obs) など

    print({
        "entry_results": entry_results,
        "exit_flag": exit_flag,
        "exit_reason": exit_reason,
        "position": position,
        "reward": reward,
        "obs": obs
    })

    # === [Layer 5: Liquidity/Spread/Orderbook] ===
    min_liquidity = 10000  # USDT換算
    min_spread_bps = 2.0
    # 仮: 板厚・スプレッド条件を満たすとする
    sufficient_liquidity = True
    sufficient_spread = snapshot.features.spread_bps < min_spread_bps

    # === [Layer 6: Alert/Signal Decision] ===
    # 仮: market_dataからDataFrame生成（本番はリアルタイムデータで置換）
    # 必要なカラム: ['open', 'high', 'low', 'close', 'volume']
    # デモ用: 直近50本のダミーデータ
    np.random.seed(42)
    n_bars = 50
    df = pd.DataFrame({
        'open': 68200 + np.random.randn(n_bars).cumsum(),
        'high': 68210 + np.random.randn(n_bars).cumsum(),
        'low': 68190 + np.random.randn(n_bars).cumsum(),
        'close': 68205 + np.random.randn(n_bars).cumsum(),
        'volume': np.abs(100 + 10 * np.random.randn(n_bars)),
    })

    # OrderBlockアラート
    ob_detector = OrderBlockDetector()
    ob_result = ob_detector.detect(df)
    bull_ob_alert = bool(ob_result['bull_ob'])
    bear_ob_alert = bool(ob_result['bear_ob'])
    block_order_alert = bool(bull_ob_alert or bear_ob_alert)
    # SMCアラート
    smc_engine = SMCAlertEngine()
    smc_result = smc_engine.check_alert(df)
    smc_long_alert = bool(smc_result["long_alert"])
    smc_short_alert = bool(smc_result["short_alert"])
    smc_trigger_alert = smc_result['long_alert'] or smc_result['short_alert']
    # Alert A: OB + SMC trigger
    alert_a_long = bool(bull_ob_alert and smc_long_alert)
    alert_a_short = bool(bear_ob_alert and smc_short_alert)
    alert_a_trigger = bool(alert_a_long or alert_a_short)
    alert_a_side = "buy" if alert_a_long else "sell" if alert_a_short else None
    alert_a_confidence = 1.0 if alert_a_trigger else 0.0
    # Alert B: Market Regime -> Strategy Selection -> Entry
    regime_engine = MarketRegimeAlertEngine(
        ema_fast=ALERT_B_EMA_FAST,
        ema_slow=ALERT_B_EMA_SLOW,
        bos_len=ALERT_B_BOS_LEN,
        vol_multiplier=ALERT_B_VOL_MULTIPLIER,
    )
    alert_b_result = regime_engine.check_alert(df, smc_result=smc_result)
    alert_b_trigger = bool(alert_b_result["long_alert"] or alert_b_result["short_alert"])
    alert_b_side = alert_b_result.get("entry_side")
    alert_b_confidence = float(alert_b_result.get("confidence", 0.0))
    # Alert C: Range market rebound
    sweep_engine = LiquiditySweepEngine(lookback=ALERT_C_SWEEP_LOOKBACK)
    sweep_result = sweep_engine.detect(df)
    range_engine = RangeReboundAlertEngine(
        ema_fast=ALERT_C_EMA_FAST,
        ema_slow=ALERT_C_EMA_SLOW,
        ema_flat_bps=ALERT_C_EMA_FLAT_BPS,
        vol_window=ALERT_C_VOL_WINDOW,
        vol_max_std=ALERT_C_VOL_MAX_STD,
        range_lookback=ALERT_C_RANGE_LOOKBACK,
        rsi_len=ALERT_C_RSI_LEN,
        rsi_oversold=ALERT_C_RSI_OVERSOLD,
        rsi_overbought=ALERT_C_RSI_OVERBOUGHT,
    )
    alert_c_result = range_engine.check_alert(df, ob_result=ob_result, sweep_result=sweep_result)
    alert_c_trigger = bool(alert_c_result.get("long_alert") or alert_c_result.get("short_alert"))
    alert_c_side = alert_c_result.get("entry_side")
    alert_c_confidence = float(alert_c_result.get("confidence", 0.0))

    # === 指標値をindicators_engineで必ず保存 ===
    indicators_payload = {
        'ATR': None,  # 必要ならcalculate_atr(df)等で算出
        'RSI': alert_c_result.get('rsi') if 'rsi' in alert_c_result else None,
        'volatility': alert_c_result.get('ret_std') if 'ret_std' in alert_c_result else None,
        'ema_fast': alert_b_result.get('ema_fast') if 'ema_fast' in alert_b_result else None,
        'ema_slow': alert_b_result.get('ema_slow') if 'ema_slow' in alert_b_result else None,
        'symbol': snapshot.symbol,
    }
    indicators_engine.update_indicators(indicators_payload)

    # === 指標heartbeatチェック（短縮） ===
    try:
        indicators_ok = indicators_engine.heartbeat_check()
        if not indicators_ok:
            logging.warning("[監視] indicators_engine heartbeat stale — blocking new entries until indicators recovered")
            notify_slack("[監視] indicators.json/DBがstaleです。新規エントリを一時停止します。")
            # 明示的にallow_entryをFalseにして新規発注を止める
            allow_entry = False
    except Exception as e:
        logging.error(f"[監視] indicators heartbeat check failed: {e}")
        notify_slack(f"[監視] indicators heartbeat check failed: {e}")
        allow_entry = False

    if alert_b_result.get("trend_regime") in ("trend_up", "trend_down"):
        market_regime = "trend"
    elif alert_c_result.get("market_regime") == "range":
        market_regime = "range"
    else:
        market_regime = "range"

    alert_d_vol_window = int(os.getenv("ALERT_D_VOL_WINDOW", str(ALERT_D_VOL_WINDOW)))
    alert_d_vol_threshold = float(os.getenv("ALERT_D_VOL_THRESHOLD", str(ALERT_D_VOL_THRESHOLD)))
    alert_d_session_start = int(os.getenv("ALERT_D_SESSION_START_UTC", str(ALERT_D_SESSION_START_UTC)))
    alert_d_session_end = int(os.getenv("ALERT_D_SESSION_END_UTC", str(ALERT_D_SESSION_END_UTC)))
    alert_d_micro_bos_len = int(os.getenv("ALERT_D_MICRO_BOS_LEN", str(ALERT_D_MICRO_BOS_LEN)))
    alert_d_rsi_len = int(os.getenv("ALERT_D_RSI_LEN", str(ALERT_D_RSI_LEN)))
    alert_d_rsi_cross = float(os.getenv("ALERT_D_RSI_CROSS_LEVEL", str(ALERT_D_RSI_CROSS_LEVEL)))
    alert_d_require_all = str(os.getenv("ALERT_D_REQUIRE_ALL", str(ALERT_D_REQUIRE_ALL))).lower() in ("1", "true", "yes", "on")

    alert_d_engine = TriggerSeparatedAlertEngine(
        vol_window=alert_d_vol_window,
        vol_threshold=alert_d_vol_threshold,
        session_start_utc=alert_d_session_start,
        session_end_utc=alert_d_session_end,
        micro_bos_len=alert_d_micro_bos_len,
        rsi_len=alert_d_rsi_len,
        rsi_cross_level=alert_d_rsi_cross,
        require_all=alert_d_require_all,
    )
    alert_d_result = alert_d_engine.check_alert(
        df=df,
        market_regime=market_regime,
        ob_result=ob_result,
        sweep_result=sweep_result,
        smc_result=smc_result,
    )
    alert_d_trigger = bool(alert_d_result.get("long_alert") or alert_d_result.get("short_alert"))
    alert_d_side = alert_d_result.get("entry_side")
    alert_d_confidence = float(alert_d_result.get("confidence", 0.0))

    # === [Layer 7: RL/Arb/State/Reward] ===
    micro_signal = micro_engine.evaluate(snapshot.features)
    try:
        best_arb_raw = arb_engine.best(snapshot)
        best_arb = best_arb_raw if isinstance(best_arb_raw, dict) else {}
    except Exception as e:
        logging.error(f"[arb_engine error] {e}")
        best_arb = {}
    state_key = build_state_key(snapshot, micro_signal.score)
    rl_decision = rl_trader.decide(state_key)


    # --- RL学習フィードバック（完全版） ---
    # ※エントリー後のpnlでrewardを計算（下のエントリー/決済直後で実施）

    # === [Layer 8: Entry Decision/Alert Comparison] ===
    entry_symbols = [
        "BTCUSDT_UMCBL",
        "ETHUSDT_UMCBL",
        "SOLUSDT_UMCBL",
        "POLYXUSDT_UMCBL",
        "DOGEUSDT_UMCBL",
        "SIRENUSDT_UMCBL",
        "RIVERUSDT_UMCBL",
        "HYPEUSDT_UMCBL",
        "XRPUSDT_UMCBL",
        "PEPEUSDT_UMCBL",
        "SHIBUSDT_UMCBL",
        "TSLAUSDT_UMCBL",
        "ENJUSDT_UMCBL",
        "SIBUSDT_UMCBL",
        "PIPPINUSDT_UMCBL",
    ]
    entry_results = []
    alert_comparisons = []
    signal_bundle = [
        f"rl_action:{rl_decision.action}",
        f"micro_score:{micro_signal.score:.4f}",
        f"funding_allow:{allow_entry}",
        f"alert_a:{alert_a_trigger}",
        f"alert_b:{alert_b_trigger}",
        f"alert_b_strategy:{alert_b_result.get('strategy')}",
        f"alert_b_confidence:{float(alert_b_result.get('confidence', 0.0)):.2f}",
        f"alert_c:{alert_c_trigger}",
        f"alert_c_confidence:{alert_c_confidence:.2f}",
        f"alert_c_strategy:{alert_c_result.get('strategy')}",
        f"alert_d:{alert_d_trigger}",
        f"alert_d_confidence:{alert_d_confidence:.2f}",
        f"alert_d_strategy:{alert_d_result.get('strategy')}",
    ]

    # --- register戦略一元化 ---
    import bot_v2.config as _config
    sizer = AdvancedPositionSizer(
        base_risk=float(os.getenv('ENTRY_MARGIN_BALANCE_PCT', str(getattr(_config, 'ENTRY_MARGIN_BALANCE_PCT', 0.03))))
    )
    for name in ("alert_a", "alert_b", "alert_c", "alert_d"):
        sizer.register(name)


    # === [RL統合] 各シンボルで特徴量→PPO重み→配分エントリー ===
    # --- 本番: indicators_engineのDBから全シンボル分の最新指標値を取得 ---
    import sqlite3
    db_path = os.path.join(os.path.dirname(__file__), 'database', 'runtime_state.db')
    conn = sqlite3.connect(db_path)
    latest_indicators = {}
    for symbol in entry_symbols:
        cur = conn.cursor()
        cur.execute('''SELECT ATR, RSI, volatility, ema_fast, ema_slow, timestamp FROM indicators WHERE symbol=? ORDER BY timestamp DESC LIMIT 1''', (symbol.replace('_UMCBL',''),))
        row = cur.fetchone()
        if row:
            latest_indicators[symbol] = {
                'atr': row[0],
                'rsi': row[1],
                'volatility': row[2],
                'ema_fast': row[3],
                'ema_slow': row[4],
                'timestamp': row[5],
            }
        else:
            latest_indicators[symbol] = {'atr':0,'rsi':50,'volatility':0,'ema_fast':0,'ema_slow':0,'timestamp':0}
    conn.close()

    for symbol in entry_symbols:
        # --- 特徴量生成 ---
        ind = latest_indicators.get(symbol, {'atr':0,'rsi':50,'volatility':0,'ema_fast':0,'ema_slow':0,'timestamp':0})
        # DataFrame不要、直接値から特徴量生成
        features = np.array([
            float(ind['rsi']) * 0.01,
            float(ind['atr']) * 0.1,
            float(ind['volatility']) * 1.0,
            float(ind['ema_fast']) * 0.00001,
            float(ind['ema_slow']) * 0.00001,
        ], dtype=np.float32)
        rl_weights = None
        if get_weights:
            try:
                rl_weights = get_weights(features)
            except Exception as e:
                print(f"[RL] get_weights error: {e}")
        else:
            rl_weights = np.ones(len(entry_symbols)) / len(entry_symbols)

        # --- AlertBotEngineで確率算出 ---
        from alert_bot_engine import AlertBotEngine
        alert_engine = AlertBotEngine()
        # 本来はalert_engine.evaluateでcandidatesを取得し、calc_entry_probabilityを使う
        # ここではweightをprobに見立てて連動させる例
        idx = entry_symbols.index(symbol)
        weight = float(rl_weights[idx]) if rl_weights is not None else 1.0 / len(entry_symbols)
        prob = weight
        base_size = 0.01
        size = base_size * prob
        side = rl_decision.action if rl_decision.action in ("buy", "sell") else "buy"

        # --- リスク強制フック ---
        manager = PositionManager()
        risk_check = risk_force_hook(bitget, symbol, manager)
        alert_name = "rl_ppo"
        side_str = str(side)
        score_val = float(prob)
        threshold_val = 0.55
        if risk_check['status'] == 'blocked':
            record_rejected_signal(
                symbol=symbol,
                alert_name=alert_name,
                side=side_str,
                score=score_val,
                threshold=threshold_val,
                reason=f"risk_blocked:{risk_check['reason']}",
                extra=risk_check
            )
            entry_results.append({"symbol": symbol, "side": "skip", "reason": f"risk_blocked:{risk_check['reason']}"})
            continue
        if risk_check['status'] == 'force_closed':
            record_rejected_signal(
                symbol=symbol,
                alert_name=alert_name,
                side=side_str,
                score=score_val,
                threshold=threshold_val,
                reason=f"risk_force_closed:{risk_check['reason']}",
                extra=risk_check
            )
            entry_results.append({"symbol": symbol, "side": "force_closed", "reason": f"risk_force_closed:{risk_check['reason']}"})
            continue

        if allow_entry and sufficient_liquidity and sufficient_spread and size > 0.0:
            order_price = executor.adjust_order(
                price=snapshot.mid_price,
                side=side,
                orderbook={"bid": snapshot.mid_price - 1, "ask": snapshot.mid_price + 1}
            )
            if order_price is None:
                entry_results.append({"symbol": symbol, "side": "skip", "reason": "slippage_exceeded"})
                continue

            # --- エントリー ---
            order_resp = _place_entry_order(bitget, symbol, side, size)
            if not _is_success(order_resp):
                entry_results.append({"symbol": symbol, "side": side, "reason": "entry_failed", "resp": order_resp})
                continue

            trade_id = "rl_" + symbol
            tracker.open(
                trade_id=trade_id,
                strategy="rl_ppo",
                price=order_price,
                size=size,
                side=side
            )

            # --- 決済（即時仮実行） ---
            exit_price = snapshot.mid_price
            pnl = tracker.close(trade_id, exit_price)
            balance = float(os.getenv("ACCOUNT_BALANCE", "1000.0"))
            pnl_ratio = pnl / balance if balance > 0 else 0.0
            allocator.update(
                regime=market_regime,
                strategy="rl_ppo",
                pnl_ratio=pnl_ratio
            )

            # --- RL学習フィードバック（完全版） ---
            try:
                reward = reward_engine.compute(pnl, micro_signal, best_arb)
                rl_trader.learn(
                    state_key=state_key,
                    action=rl_decision.action,
                    reward=reward,
                    next_state_key=state_key,
                )
            except Exception as e:
                logging.error(f"[RL Learn Error] {e}")

            entry_results.append({
                "symbol": symbol,
                "side": side,
                "reason": "rl_ppo",
                "trade_id": trade_id,
                "order_price": order_price,
                "size": size,
                "pnl": pnl,
                "pnl_ratio": pnl_ratio,
                "resp": order_resp,
                "rl_weight": weight,
            })
        else:
            entry_results.append({"symbol": symbol, "side": "skip", "reason": "条件未達(RL)"})

    payload = {
        "symbol": snapshot.symbol,
        "micro_signal": safe_json(micro_signal),
        "best_arbitrage": best_arb_json,
        "rl_decision": safe_json(vars(rl_decision) if hasattr(rl_decision, "__dict__") else rl_decision),
        "state_values": rl_trader.state_action_values(state_key),
        "allow_entry": allow_entry,
        "liq_heatmap": liq_heatmap,
        "risk_stats": risk_stats,
        "market_data": safe_json(market_data),
        "alert_a": safe_json({
            "block_order_alert": block_order_alert,
            "smc_trigger_alert": smc_trigger_alert,
            "trigger": alert_a_trigger,
            "entry_side": alert_a_side,
            "confidence": alert_a_confidence,
        }),
        "alert_b": safe_json(alert_b_result),
        "alert_c": safe_json({
            **alert_c_result,
            "trigger": alert_c_trigger,
        }),
        "alert_d": safe_json({
            **alert_d_result,
            "trigger": alert_d_trigger,
            "params": {
                "vol_window": alert_d_vol_window,
                "vol_threshold": alert_d_vol_threshold,
                "session_start_utc": alert_d_session_start,
                "session_end_utc": alert_d_session_end,
                "micro_bos_len": alert_d_micro_bos_len,
                "rsi_len": alert_d_rsi_len,
                "rsi_cross_level": alert_d_rsi_cross,
                "require_all": alert_d_require_all,
            },
        }),
        "alert_comparisons": safe_json(alert_comparisons),
        "alert_learning": safe_json(alert_learning.get_alert_summary()),
        "entry_results": safe_json(entry_results),
        "arb_score": arb_score,
    }
    try:
        print(json.dumps(safe_json(payload), ensure_ascii=False, indent=2, default=str))
    except Exception as e:
        print("[FALLBACK]", str(payload))



# --- 既存のmain()呼び出しは1箇所だけ残す（重複排除） ---
if __name__ == "__main__":
    main()
