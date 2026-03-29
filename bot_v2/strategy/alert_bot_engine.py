"""
alert_bot_engine.py

A/B/C/D 全ボットを並走評価し、最良エントリーと各ボット固有の決済シグナルを返す統合エンジン。

各ボット:
  Alert A: OrderBlock + LiquiditySweep  (OB+Sweep Sniper)
  Alert B: MarketRegimeAlertEngine      (Trend-Follow)
  Alert C: RangeReboundAlertEngine      (Range Rebound)
  Alert D: TriggerSeparatedAlertEngine  (Sniper)

エントリースコア = weight x confidence
AlertLearningEngine から最新 weight を毎回取得して比較。
"""
import pandas as pd
import os

from bot_v2.strategy.market_regime_alert_engine import MarketRegimeAlertEngine
from bot_v2.strategy.range_rebound_alert_engine import RangeReboundAlertEngine
from bot_v2.strategy.trigger_separated_alert_engine import TriggerSeparatedAlertEngine
from bot_v2.strategy.orderblock_engine import OrderBlockEngine
from bot_v2.strategy.liquidity_sweep_engine import LiquiditySweepEngine
from bot_v2.strategy.market_regime_engine import MarketRegimeEngine
from bot_v2.market.atr import calculate_atr
from bot_v2.ai.alert_learning_engine import AlertLearningEngine

# エントリーに必要な最低スコア閾値（動的化のベース）
ENTRY_SCORE_THRESHOLD = float(os.getenv('ENTRY_SCORE_THRESHOLD_BASE', '0.25'))

ALERT_BASE_THRESHOLDS = {
    'alert_a': float(os.getenv('ALERT_A_MIN_SCORE', '0.30')),
    'alert_b': float(os.getenv('ALERT_B_MIN_SCORE', '0.24')),
    'alert_c': float(os.getenv('ALERT_C_MIN_SCORE', '0.28')),
    'alert_d': float(os.getenv('ALERT_D_MIN_SCORE', '0.32')),
}

ALERT_A_ALLOW_SWEEP_RECOVERY_WITHOUT_OB = str(os.getenv('ALERT_A_ALLOW_SWEEP_RECOVERY_WITHOUT_OB', 'false')).lower() in ('1', 'true', 'yes', 'on')
ALERT_A_REQUIRE_BOTH_OB_AND_SWEEP = str(os.getenv('ALERT_A_REQUIRE_BOTH_OB_AND_SWEEP', 'true')).lower() in ('1', 'true', 'yes', 'on')
ALERT_A_STRUCTURE_TOLERANCE_BPS = float(os.getenv('ALERT_A_STRUCTURE_TOLERANCE_BPS', '0.0'))

# 学習ウェイトが取得できない場合のデフォルト
_DEFAULT_WEIGHTS = {
    'alert_a': 1.0,
    'alert_b': 1.0,
    'alert_c': 1.0,
    'alert_d': 1.0,
}

BOT_STYLE_MAP = {
    'alert_a': 'reversal',
    'alert_b': 'trend',
    'alert_c': 'reversal',
    'alert_d': 'breakout',
}


def candles_to_df(candles) -> pd.DataFrame:
    """Bitget 生candle list -> pandas DataFrame (ts,open,high,low,close,volume)"""
    if not candles or len(candles) < 5:
        return None
    try:
        rows = [
            {
                'ts':     int(c[0]),
                'open':   float(c[1]),
                'high':   float(c[2]),
                'low':    float(c[3]),
                'close':  float(c[4]),
                'volume': float(c[5]),
            }
            for c in candles
        ]
        df = pd.DataFrame(rows)
        df.sort_values('ts', inplace=True)
        df.reset_index(drop=True, inplace=True)
        return df
    except Exception:
        return None


def _df_to_raw_candles(df: pd.DataFrame) -> list:
    """DataFrame -> orderblock_engine が期待する raw list 形式に変換"""
    return df[['ts', 'open', 'high', 'low', 'close', 'volume']].values.tolist()


class AlertBotEngine:
    """4種ボットを並走評価するメインエンジン"""

    def __init__(self):
        self._bot_b = MarketRegimeAlertEngine()
        self._bot_c = RangeReboundAlertEngine()
        self._bot_d = TriggerSeparatedAlertEngine()
        self._ob_engine = OrderBlockEngine()
        self._sweep_engine = LiquiditySweepEngine()
        self._regime_engine = MarketRegimeEngine()

    def _get_weights(self) -> dict:
        try:
            state = AlertLearningEngine().state
            w = {}
            for k in ('alert_a', 'alert_b', 'alert_c', 'alert_d'):
                w[k] = float(state.get('alerts', {}).get(k, {}).get('weight', _DEFAULT_WEIGHTS[k]))
            return w
        except Exception:
            return dict(_DEFAULT_WEIGHTS)

    def _get_summary(self) -> dict:
        try:
            return AlertLearningEngine().get_alert_summary()
        except Exception:
            return {
                'alert_a': {'win_rate': 0.5, 'max_dd': 0.0, 'closed': 0},
                'alert_b': {'win_rate': 0.5, 'max_dd': 0.0, 'closed': 0},
                'alert_c': {'win_rate': 0.5, 'max_dd': 0.0, 'closed': 0},
                'alert_d': {'win_rate': 0.5, 'max_dd': 0.0, 'closed': 0},
            }

    def _dynamic_threshold(self, alert_name: str, summary: dict) -> float:
        base = float(ALERT_BASE_THRESHOLDS.get(alert_name, ENTRY_SCORE_THRESHOLD))
        metrics = summary.get(alert_name, {}) if isinstance(summary, dict) else {}
        win_rate = float(metrics.get('win_rate', 0.5) or 0.5)
        max_dd = float(metrics.get('max_dd', 0.0) or 0.0)
        closed = int(metrics.get('closed', 0) or 0)

        dd_penalty = min(0.10, max(0.0, max_dd * 8.0))
        wr_penalty = min(0.08, max(0.0, (0.5 - win_rate) * 0.20))
        cold_start_penalty = 0.02 if closed < 3 else 0.0

        threshold = base + dd_penalty + wr_penalty + cold_start_penalty
        return max(0.20, min(0.50, threshold))

    def _diagnose_result(self, alert_name: str, result: dict) -> str:
        if not isinstance(result, dict):
            return 'no_result'
        if alert_name == 'alert_a':
            if result.get('ob_or_sweep_mode'):
                if not result.get('ob_aligned') and not result.get('sweep_aligned'):
                    return 'ob_or_sweep_not_aligned'
            else:
                if not result.get('ob_aligned'):
                    return 'ob_not_aligned'
                if not result.get('sweep_aligned'):
                    return 'sweep_not_aligned'
            if not result.get('structure_recovery'):
                return 'structure_not_recovered'
            return 'alert_a_no_side'
        if alert_name == 'alert_b':
            if not result.get('long_alert') and not result.get('short_alert'):
                require_vol = bool(result.get('require_volume_expansion', True))
                strict_bos_effective = bool(result.get('strict_bos_effective', result.get('require_strict_bos', True)))
                smc_required_effective = bool(result.get('smc_required_effective', True))
                if require_vol and not result.get('vol_expansion'):
                    return 'trend_vol_not_expanded'
                if strict_bos_effective and not result.get('bos_up') and not result.get('bos_down'):
                    return 'trend_bos_not_confirmed'
                if smc_required_effective and not result.get('smc_long') and not result.get('smc_short'):
                    return 'trend_smc_not_aligned'
                return 'trend_conditions_not_met'
        if alert_name == 'alert_c':
            if result.get('volatility_spike'):
                return 'rebound_volatility_spike'
            if not result.get('low_volatility'):
                return 'rebound_not_low_vol'
            if not result.get('ema_flat'):
                return 'rebound_not_range_flat'
            return 'rebound_conditions_not_met'
        if alert_name == 'alert_d':
            context = result.get('context') or {}
            trigger = result.get('trigger') or {}
            if not context.get('in_session'):
                return 'sniper_outside_session'
            if not context.get('high_volatility'):
                return 'sniper_low_volatility'
            if not trigger.get('rsi_cross_up') and not trigger.get('rsi_cross_down'):
                return 'sniper_no_rsi_cross'
            if not trigger.get('micro_bos_up') and not trigger.get('micro_bos_down'):
                return 'sniper_no_micro_bos'
            return 'sniper_conditions_not_met'
        return 'no_signal'


    def evaluate(self,
                 candles1m: list,
                 candles5m: list,
                 candles10m: list,
                 candles15m: list,
                 candles30m: list,
                 candles1h: list,
                 candles1d: list,
                 news_bias: dict | None = None,
                 symbol: str | None = None) -> dict:
        """
        15分足を軸に、1m,5m,10m,30m,1h,1dも判断材料として多角的に評価。
        Returns:
            {
              'signal':          'BUY' | 'SELL' | None,
              'selected_alert':  'alert_a'..'alert_d' | None,
              'score':           float,
              'confidence':      float,
              'all_results':     {alert_a: {...}, ...},
              'candidates':      [{alert, side, score, ...}, ...],
              'atr':             float | None,
              'thresholds':      {alert: float, ...},
              'blocked_reasons': {alert: str, ...},
              'no_signal_reason': str | None,
              'multi_timeframes': {
                  '1m': {...}, '5m': {...}, '10m': {...}, '15m': {...}, '30m': {...}, '1h': {...}, '1d': {...}
              }
            }
        """
        # DataFrame化
        df1  = candles_to_df(candles1m)
        df5  = candles_to_df(candles5m)
        df10 = candles_to_df(candles10m)
        df15 = candles_to_df(candles15m)
        df30 = candles_to_df(candles30m)
        df1h = candles_to_df(candles1h)
        df1d = candles_to_df(candles1d)

        if df15 is None:
            return self._null_result({}, no_signal_reason='no_candles')

        weights = self._get_weights()
        summary = self._get_summary()

        # -- 共通指標 --

        # 15分足を軸に、他タイムフレームも特徴量抽出
        multi_timeframes = {}
        for tf, df in zip(['1m','5m','10m','15m','30m','1h','1d'], [df1,df5,df10,df15,df30,df1h,df1d]):
            if df is not None:
                multi_timeframes[tf] = {
                    'close': float(df['close'].iloc[-1]),
                    'atr': float(df['high'].max() - df['low'].min()) if len(df) > 1 else 0.0,
                    'volume': float(df['volume'].sum()),
                    'trend': float(df['close'].iloc[-1] - df['open'].iloc[0]) if len(df) > 1 else 0.0,
                }
            else:
                multi_timeframes[tf] = None

        # 既存ロジックは15分足を主軸
        ob_raw    = self._ob_engine.detect(candles15m)
        ob_result = {'bull_ob': ob_raw == 'BUY', 'bear_ob': ob_raw == 'SELL'}
        sweep_raw    = self._sweep_engine.detect(df15)
        sweep_result = sweep_raw if isinstance(sweep_raw, dict) else {'sweep_low': False, 'sweep_high': False}
        regime_raw = self._regime_engine.detect(candles15m)
        if regime_raw in ('TREND_UP', 'TREND_DOWN'):
            regime_str = 'trend'
        elif regime_raw == 'RANGE':
            regime_str = 'range'
        else:
            regime_str = 'unknown'

        # -- Alert A: OB + Sweep + Structure回復（二段確認必須） --

        close_now = float(df15['close'].iloc[-1])
        close_prev = float(df15['close'].iloc[-2])
        open_now = float(df15['open'].iloc[-1])

        tolerance = max(0.0, ALERT_A_STRUCTURE_TOLERANCE_BPS) / 10000.0
        a_structure_long = bool(close_now > close_prev and close_now >= (open_now * (1.0 - tolerance)))
        a_structure_short = bool(close_now < close_prev and close_now <= (open_now * (1.0 + tolerance)))

        if ALERT_A_REQUIRE_BOTH_OB_AND_SWEEP:
            a_long_base = bool(ob_result['bull_ob'] and sweep_result.get('sweep_low', False))
            a_short_base = bool(ob_result['bear_ob'] and sweep_result.get('sweep_high', False))
        else:
            a_long_base = bool(ob_result['bull_ob'] or sweep_result.get('sweep_low', False))
            a_short_base = bool(ob_result['bear_ob'] or sweep_result.get('sweep_high', False))

        a_sweep_long = bool(sweep_result.get('sweep_low', False) and a_structure_long)
        a_sweep_short = bool(sweep_result.get('sweep_high', False) and a_structure_short)

        a_long = bool((a_long_base and a_structure_long) or (ALERT_A_ALLOW_SWEEP_RECOVERY_WITHOUT_OB and a_sweep_long))
        a_short = bool((a_short_base and a_structure_short) or (ALERT_A_ALLOW_SWEEP_RECOVERY_WITHOUT_OB and a_sweep_short))

        a_ob_bonus = int(ob_result['bull_ob'] or ob_result['bear_ob'])
        a_pts = int(a_long or a_short) + int(a_structure_long or a_structure_short) + a_ob_bonus
        r_a = {
            'long_alert':   a_long,
            'short_alert':  a_short,
            'entry_side':   'buy' if a_long else ('sell' if a_short else None),
            'confidence':   a_pts / 3.0,
            'ob_result':    ob_result,
            'sweep_result': sweep_result,
            'ob_or_sweep_mode': bool(not ALERT_A_REQUIRE_BOTH_OB_AND_SWEEP),
            'ob_aligned': bool(a_long_base or a_short_base),
            'sweep_aligned': bool(sweep_result.get('sweep_low', False) or sweep_result.get('sweep_high', False)),
            'structure_recovery': bool((a_long and a_structure_long) or (a_short and a_structure_short)),
            'sweep_only_mode': bool(ALERT_A_ALLOW_SWEEP_RECOVERY_WITHOUT_OB and not (a_long_base or a_short_base) and (a_long or a_short)),
        }

        # -- Alert B: Market Regime Trend-Follow --
        smc_stub = {'long_alert': a_long, 'short_alert': a_short}
        r_b = self._bot_b.check_alert(df15, smc_result=smc_stub, symbol=symbol)

        # -- Alert C: Range Rebound --
        r_c = self._bot_c.check_alert(df15, ob_result=ob_result, sweep_result=sweep_result, symbol=symbol)

        # -- Alert D: Trigger Separated Sniper --
        r_d = self._bot_d.check_alert(
            df5,
            market_regime=regime_str,
            ob_result=ob_result,
            sweep_result=sweep_result,
            smc_result=smc_stub,
            symbol=symbol,
        )

        all_results = {
            'alert_a': r_a,
            'alert_b': r_b,
            'alert_c': r_c,
            'alert_d': r_d,
        }

        # -- スコアリング --
        thresholds = {}
        candidates = []
        blocked_reasons = {}
        news_bias = news_bias if isinstance(news_bias, dict) else {}
        for name, result in all_results.items():
            if not result:
                blocked_reasons[name] = 'no_result'
                continue
            is_long  = bool(result.get('long_alert'))
            is_short = bool(result.get('short_alert'))
            if not is_long and not is_short:
                blocked_reasons[name] = self._diagnose_result(name, result)
                continue

            if name == 'alert_c' and bool(result.get('volatility_spike')):
                blocked_reasons[name] = 'rebound_volatility_spike'
                continue

            if name == 'alert_d':
                context = result.get('context') or {}
                trigger = result.get('trigger') or {}
                micro_match_long = bool(trigger.get('smc_long') and trigger.get('rsi_cross_up') and trigger.get('micro_bos_up'))
                micro_match_short = bool(trigger.get('smc_short') and trigger.get('rsi_cross_down') and trigger.get('micro_bos_down'))
                strict_ok = bool(context.get('in_session') and (micro_match_long or micro_match_short))
                if not strict_ok:
                    blocked_reasons[name] = 'sniper_strict_filter_blocked'
                    continue

            conf  = float(result.get('confidence', 0.0))
            w     = float(weights.get(name, 1.0))
            thresholds[name] = self._dynamic_threshold(name, summary)
            base_score = w * conf
            bias = float(news_bias.get(name, 0.0) or 0.0)
            bias = max(-0.08, min(0.08, bias))
            adjusted_score = max(0.0, base_score + bias)
            candidates.append({
                'alert':      name,
                'style':      BOT_STYLE_MAP.get(name, 'breakout'),
                'side':       'buy' if is_long else 'sell',
                'confidence': conf,
                'weight':     w,
                'score':      adjusted_score,
                'base_score': base_score,
                'news_bias':  bias,
                'threshold':  thresholds[name],
            })

        atr = calculate_atr(candles5m)

        if not candidates:
            return {
                **self._null_result(all_results, atr=atr),
                'no_signal_reason': 'all_alerts_blocked',
                'blocked_reasons': blocked_reasons,
                'thresholds': thresholds,
                'news_bias': news_bias,
                'multi_timeframes': multi_timeframes,
            }

        best = max(candidates, key=lambda x: x['score'])
        min_required = float(best.get('threshold', self._dynamic_threshold(best['alert'], summary)))
        if best['score'] < min_required:
            return {
                'signal':         None,
                'selected_alert': None,
                'score':          best['score'],
                'confidence':     best['confidence'],
                'all_results':    all_results,
                'candidates':     candidates,
                'atr':            atr,
                'no_signal_reason': f'score_below_threshold:{best["alert"]}',
                'blocked_reasons': blocked_reasons,
                'thresholds': thresholds,
                'news_bias': news_bias,
            }

        return {
            'signal':         'BUY' if best['side'] == 'buy' else 'SELL',
            'selected_alert': best['alert'],
            'selected_style': best.get('style', 'breakout'),
            'score':          best['score'],
            'confidence':     best['confidence'],
            'all_results':    all_results,
            'candidates':     candidates,
            'atr':            atr,
            'blocked_reasons': blocked_reasons,
            'thresholds': thresholds,
            'news_bias':      news_bias,
            'multi_timeframes': multi_timeframes,
        }

    def _null_result(self, all_results: dict, atr=None, no_signal_reason=None) -> dict:
        return {
            'signal':         None,
            'selected_alert': None,
            'score':          0.0,
            'confidence':     0.0,
            'all_results':    all_results,
            'candidates':     [],
            'atr':            atr,
            'no_signal_reason': no_signal_reason,
            'blocked_reasons': {},
            'thresholds': {},
        }

    def evaluate_exit(self, bot_name: str, df5, df15, position: dict) -> dict:
        """
        アクティブなポジションに対してbot固有の決済条件を評価する。

        Returns:
            {
              'should_exit': bool,
              'reason':      str,
              'confidence':  float,
            }
        """
        if df5 is None or position is None:
            return {'should_exit': False, 'reason': 'no_data', 'confidence': 0.0}

        try:
            if bot_name == 'alert_a':
                return self._exit_a(df15, position)
            elif bot_name == 'alert_b':
                return self._exit_b(df15, position)
            elif bot_name == 'alert_c':
                return self._exit_c(df5, position)
            elif bot_name == 'alert_d':
                return self._exit_d(df5, position)
            else:
                return {'should_exit': False, 'reason': 'unknown_bot', 'confidence': 0.0}
        except Exception as exc:
            return {'should_exit': False, 'reason': f'error:{exc}', 'confidence': 0.0}

    def _exit_a(self, df15, position: dict) -> dict:
        """Alert A: OBが逆転方向を示したら即撤退（スナイパー、損切り早め）"""
        if df15 is None or len(df15) < 6:
            return {'should_exit': False, 'reason': 'insufficient_data', 'confidence': 0.0}
        side   = str(position.get('holdSide', '')).lower()
        ob_raw = self._ob_engine.detect(_df_to_raw_candles(df15))
        if side == 'long' and ob_raw == 'SELL':
            return {'should_exit': True, 'reason': 'ob_reversal_bearish', 'confidence': 0.85}
        if side == 'short' and ob_raw == 'BUY':
            return {'should_exit': True, 'reason': 'ob_reversal_bullish', 'confidence': 0.85}
        return {'should_exit': False, 'reason': 'ob_aligned', 'confidence': 0.0}

    def _exit_b(self, df15, position: dict) -> dict:
        """Alert B: EMAトレンド逆転で撤退（トレンドフォロー終了サイン）"""
        if df15 is None or len(df15) < 52:
            return {'should_exit': False, 'reason': 'insufficient_data', 'confidence': 0.0}
        side     = str(position.get('holdSide', '')).lower()
        ema20    = float(df15['close'].ewm(span=20, adjust=False).mean().iloc[-1])
        ema50    = float(df15['close'].ewm(span=50, adjust=False).mean().iloc[-1])
        trend_up = ema20 > ema50
        if side == 'long' and not trend_up:
            return {'should_exit': True, 'reason': 'ema_trend_reversed_bearish', 'confidence': 0.80}
        if side == 'short' and trend_up:
            return {'should_exit': True, 'reason': 'ema_trend_reversed_bullish', 'confidence': 0.80}
        return {'should_exit': False, 'reason': 'trend_aligned', 'confidence': 0.0}

    def _exit_c(self, df5, position: dict) -> dict:
        """Alert C: RSI中央回帰後は撤退（レンジリバウンド完了サイン）"""
        if len(df5) < 16:
            return {'should_exit': False, 'reason': 'insufficient_data', 'confidence': 0.0}
        side  = str(position.get('holdSide', '')).lower()
        close = df5['close']
        delta = close.diff()
        gain  = delta.where(delta > 0, 0.0).rolling(14).mean()
        loss  = (-delta.where(delta < 0, 0.0)).rolling(14).mean()
        rs    = gain / loss.replace(0, float('nan'))
        rsi   = float((100 - (100 / (1 + rs))).iloc[-1])
        if side == 'long' and rsi >= 55.0:
            return {'should_exit': True, 'reason': f'rsi_rebound_complete rsi={rsi:.1f}', 'confidence': 0.78}
        if side == 'short' and rsi <= 45.0:
            return {'should_exit': True, 'reason': f'rsi_rebound_complete rsi={rsi:.1f}', 'confidence': 0.78}
        return {'should_exit': False, 'reason': f'rsi_not_yet rsi={rsi:.1f}', 'confidence': 0.0}

    def _exit_d(self, df5, position: dict) -> dict:
        """Alert D: micro-BOS逆転で撤退（スナイパー、条件崩れたら即撤退）"""
        if len(df5) < 8:
            return {'should_exit': False, 'reason': 'insufficient_data', 'confidence': 0.0}
        side       = str(position.get('holdSide', '')).lower()
        high       = df5['high']
        low        = df5['low']
        close      = df5['close']
        prev_high  = float(high.iloc[-7:-1].max())
        prev_low   = float(low.iloc[-7:-1].min())
        bos_down   = bool(close.iloc[-1] < prev_low)
        bos_up     = bool(close.iloc[-1] > prev_high)
        if side == 'long' and bos_down:
            return {'should_exit': True, 'reason': 'micro_bos_bearish_break', 'confidence': 0.80}
        if side == 'short' and bos_up:
            return {'should_exit': True, 'reason': 'micro_bos_bullish_break', 'confidence': 0.80}
        return {'should_exit': False, 'reason': 'no_micro_bos_reversal', 'confidence': 0.0}
