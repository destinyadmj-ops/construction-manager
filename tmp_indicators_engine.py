"""
indicators_engine.py
テクニカル指標エンジン
修正点:
  - RSI: 過売(30以下)=BUY、過買(70以上)=SELL に変更（トレンドとの組み合わせで使用）
  - volume_spike: 2x → 1.8x に緩和 + 最低本数を 10 に下げる
  - _ema_series: 引数渡しの型を統一
"""
import numpy as np


class IndicatorsEngine:

    def __init__(self):
        self.closes = []
        self.highs = []
        self.lows = []
        self.volumes = []

    def update(self, high, low, close, volume):

        self.highs.append(high)
        self.lows.append(low)
        self.closes.append(close)
        self.volumes.append(volume)

        if len(self.closes) > 500:
            self.highs.pop(0)
            self.lows.pop(0)
            self.closes.pop(0)
            self.volumes.pop(0)

    # ── EMA ──────────────────────────
    def ema(self, period):

        if len(self.closes) < period:
            return None

        k = 2 / (period + 1)
        ema = self.closes[0]

        for price in self.closes:
            ema = price * k + ema * (1 - k)

        return ema

    def ema_cross(self):

        ema20 = self.ema(20)
        ema50 = self.ema(50)

        if ema20 is None or ema50 is None:
            return None

        if ema20 > ema50:
            return "BUY"
        if ema20 < ema50:
            return "SELL"
        return None

    # ── RSI ──────────────────────────
    def rsi(self, period=14):

        if len(self.closes) < period + 1:
            return None

        gains, losses = [], []

        for i in range(-period, 0):
            change = self.closes[i] - self.closes[i - 1]
            if change > 0:
                gains.append(change)
                losses.append(0)
            else:
                gains.append(0)
                losses.append(abs(change))

        avg_gain = np.mean(gains)
        avg_loss = np.mean(losses)

        if avg_loss == 0:
            return 100.0

        rs = avg_gain / avg_loss
        return 100 - (100 / (1 + rs))

    def rsi_signal(self):
        """
        RSI 過売買シグナル（標準型）
          >= 70 → SELL（過買い）
          <= 30 → BUY （過売り）
          それ以外 → None（中立）
        """
        rsi = self.rsi()
        if rsi is None:
            return None
        if rsi >= 70:
            return "SELL"
        if rsi <= 30:
            return "BUY"
        return None

    # ── MACD ─────────────────────────
    def _ema_series(self, period, series=None):

        src = list(self.closes) if series is None else list(series)
        k = 2 / (period + 1)
        ema = src[0]
        for price in src:
            ema = price * k + ema * (1 - k)
        return ema

    def macd(self):

        if len(self.closes) < 35:
            return None, None

        ema12 = self._ema_series(12)
        ema26 = self._ema_series(26)
        macd_val = ema12 - ema26
        signal = self._ema_series(9, series=[macd_val])
        return macd_val, signal

    def macd_signal(self):

        macd_val, signal = self.macd()
        if macd_val is None:
            return None
        if macd_val > signal:
            return "BUY"
        if macd_val < signal:
            return "SELL"
        return None

    # ── Volume Spike ─────────────────
    def volume_spike(self):

        if len(self.volumes) < 10:
            return False

        avg = np.mean(self.volumes[-20:]) if len(self.volumes) >= 20 else np.mean(self.volumes)
        current = self.volumes[-1]
        return current > avg * 1.8   # 旧: 2.0 → 1.8 に緩和

    # ── SuperTrend ───────────────────
    def supertrend(self, period=10, multiplier=3):

        if len(self.closes) < period + 1:
            return None

        highs  = np.array(self.highs[-period - 1:])
        lows   = np.array(self.lows[-period - 1:])
        closes = np.array(self.closes[-period - 1:])

        # True Range
        prev_closes = closes[:-1]
        curr_highs  = highs[1:]
        curr_lows   = lows[1:]
        curr_closes = closes[1:]

        tr = np.maximum(
            curr_highs - curr_lows,
            np.maximum(
                np.abs(curr_highs - prev_closes),
                np.abs(curr_lows  - prev_closes),
            )
        )
        atr = np.mean(tr)

        hl2   = (self.highs[-1] + self.lows[-1]) / 2
        upper = hl2 + multiplier * atr
        lower = hl2 - multiplier * atr

        if self.closes[-1] > upper:
            return "BUY"
        if self.closes[-1] < lower:
            return "SELL"
        return None
