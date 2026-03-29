import numpy as np
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

from bot_v2.strategy.market_regime_alert_engine import MarketRegimeAlertEngine
from bot_v2.strategy.range_rebound_alert_engine import RangeReboundAlertEngine
from bot_v2.strategy.trigger_separated_alert_engine import TriggerSeparatedAlertEngine
from bot_v2.strategy.orderblock_engine import OrderBlockEngine
from bot_v2.strategy.liquidity_sweep_engine import LiquiditySweepEngine
from bot_v2.strategy.market_regime_engine import MarketRegimeEngine
from bot_v2.market.atr import calculate_atr
from bot_v2.ai.alert_learning_engine import AlertLearningEngine

# エントリーに必要な最低スコア閾値
ENTRY_SCORE_THRESHOLD = 0.25

# 学習ウェイトが取得できない場合のデフォルト
_DEFAULT_WEIGHTS = {
    'alert_a': 1.0,
    'alert_b': 1.0,
    'alert_c': 1.0,
    'alert_d': 1.0,
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
        @staticmethod
        def calc_entry_probability(alert_scores: list) -> float:
            """
            複数alert候補のscoreからエントリー確率を計算（tanh圧縮）
            """
            total_score = sum([s.get("score", 0.0) for s in alert_scores])
            confidence = float(np.tanh(total_score))  # 0〜1圧縮
            return confidence
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
                w[k] = float(state.get('weights', {}).get(k, _DEFAULT_WEIGHTS[k]))
            return w
        except Exception:
            return dict(_DEFAULT_WEIGHTS)

    def evaluate(self, candles5m: list, candles15m: list, candles1h: list) -> dict:
        """
        全ボットを評価し最良エントリーシグナルを返す。

        Returns:
            {
              'signal':          'BUY' | 'SELL' | None,
              'selected_alert':  'alert_a'..'alert_d' | None,
              'score':           float,
              'confidence':      float,
              'all_results':     {alert_a: {...}, ...},
              'candidates':      [{alert, side, score, ...}, ...],
              'atr':             float | None,
            }
        """
        df5  = candles_to_df(candles5m)
        df15 = candles_to_df(candles15m)

        if df5 is None or df15 is None:
            return self._null_result({})

        weights = self._get_weights()

        # -- 共通指標 --
        ob_raw    = self._ob_engine.detect(candles15m)
        ob_result = {'bull_ob': ob_raw == 'BUY', 'bear_ob': ob_raw == 'SELL'}

        # sweep_engine は DataFrame を渡すと pandas Series で正しく動く
        sweep_raw    = self._sweep_engine.detect(df15)
        sweep_result = sweep_raw if isinstance(sweep_raw, dict) else {'sweep_low': False, 'sweep_high': False}

        regime_raw = self._regime_engine.detect(candles15m)
        if regime_raw in ('TREND_UP', 'TREND_DOWN'):
            regime_str = 'trend'
        elif regime_raw == 'RANGE':
            regime_str = 'range'
        else:
            regime_str = 'unknown'

        # -- Alert A: OB + Sweep スナイパー --
        a_long  = bool(ob_result['bull_ob'] and sweep_result.get('sweep_low', False))
        a_short = bool(ob_result['bear_ob'] and sweep_result.get('sweep_high', False))
        a_pts   = int(ob_result['bull_ob'] or ob_result['bear_ob']) + int(
            sweep_result.get('sweep_low', False) or sweep_result.get('sweep_high', False)
        )
        r_a = {
            'long_alert':   a_long,
            'short_alert':  a_short,
            'entry_side':   'buy' if a_long else ('sell' if a_short else None),
            'confidence':   a_pts / 2.0,
            'ob_result':    ob_result,
            'sweep_result': sweep_result,
        }

        # -- Alert B: Market Regime Trend-Follow --
        smc_stub = {'long_alert': a_long, 'short_alert': a_short}
        r_b = self._bot_b.check_alert(df15, smc_result=smc_stub)

        # -- Alert C: Range Rebound --
        r_c = self._bot_c.check_alert(df15, ob_result=ob_result, sweep_result=sweep_result)

        # -- Alert D: Trigger Separated Sniper --
        r_d = self._bot_d.check_alert(
            df5,
            market_regime=regime_str,
            ob_result=ob_result,
            sweep_result=sweep_result,
            smc_result=smc_stub,
        )

        all_results = {
            'alert_a': r_a,
            'alert_b': r_b,
            'alert_c': r_c,
            'alert_d': r_d,
        }

        # -- スコアリング --
        candidates = []
        for name, result in all_results.items():
            if not result:
                continue
            is_long  = bool(result.get('long_alert'))
            is_short = bool(result.get('short_alert'))
            if not is_long and not is_short:
                continue
            conf  = float(result.get('confidence', 0.0))
            w     = float(weights.get(name, 1.0))
            candidates.append({
                'alert':      name,
                'side':       'buy' if is_long else 'sell',
                'confidence': conf,
                'weight':     w,
                'score':      w * conf,
            })

        atr = calculate_atr(candles5m)

        if not candidates:
            return self._null_result(all_results, atr=atr)

        # --- 確率ベース判定 ---
        prob = self.calc_entry_probability(candidates)
        best = max(candidates, key=lambda x: x['score'])
        if prob < 0.55:
            return {
                'signal':         None,
                'selected_alert': None,
                'score':          best['score'],
                'confidence':     best['confidence'],
                'probability':    prob,
                'all_results':    all_results,
                'candidates':     candidates,
                'atr':            atr,
            }

        return {
            'signal':         'BUY' if best['side'] == 'buy' else 'SELL',
            'selected_alert': best['alert'],
            'score':          best['score'],
            'confidence':     best['confidence'],
            'probability':    prob,
            'all_results':    all_results,
            'candidates':     candidates,
            'atr':            atr,
        }

    def _null_result(self, all_results: dict, atr=None) -> dict:
        return {
            'signal':         None,
            'selected_alert': None,
            'score':          0.0,
            'confidence':     0.0,
            'all_results':    all_results,
            'candidates':     [],
            'atr':            atr,
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
