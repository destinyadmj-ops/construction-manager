import numpy as np
import pandas as pd

class SMCAlertEngine:
    def __init__(self, ema_fast=20, ema_slow=50, vol_multiplier=1.5, atr_len=14, cooldown_bars=10, st_length=10, st_mult=3.0, perf_alpha=10.0, ob_len=5, max_lines=3, rsi_len=14):
        self.ema_fast = ema_fast
        self.ema_slow = ema_slow
        self.vol_multiplier = vol_multiplier
        self.atr_len = atr_len
        self.cooldown_bars = cooldown_bars
        self.st_length = st_length
        self.st_mult = st_mult
        self.perf_alpha = perf_alpha
        self.ob_len = ob_len
        self.max_lines = max_lines
        self.rsi_len = rsi_len
        self.last_trade_bar = -cooldown_bars

    def ema(self, series, period):
        return series.ewm(span=period, adjust=False).mean()

    def macd(self, close):
        ema12 = self.ema(close, 12)
        ema26 = self.ema(close, 26)
        macd_line = ema12 - ema26
        signal_line = macd_line.ewm(span=9, adjust=False).mean()
        return macd_line, signal_line

    def rsi(self, close, period):
        delta = close.diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
        rs = gain / loss
        return 100 - (100 / (1 + rs))

    def supertrend(self, df):
        atr = df['high'].combine(df['low'], max) - df['low'].combine(df['close'], min)
        atr = atr.rolling(window=self.st_length).mean()
        hl2 = (df['high'] + df['low']) / 2
        st = hl2 - self.st_mult * atr
        st_dir = np.where(df['close'] > st, 1, -1)
        return st, st_dir

    def check_alert(self, df: pd.DataFrame):
        # df: DataFrame with columns ['open', 'high', 'low', 'close', 'volume']
        n = len(df)
        if n < max(self.ema_fast, self.ema_slow, self.atr_len, self.st_length, self.ob_len) + 2:
            return {'long_alert': False, 'short_alert': False}
        close = df['close']
        volume = df['volume']
        emaF = self.ema(close, self.ema_fast)
        emaS = self.ema(close, self.ema_slow)
        volC = volume > (volume.rolling(20).mean() * self.vol_multiplier)
        macd_line, signal_line = self.macd(close)
        rsi_val = self.rsi(close, self.rsi_len)
        st_val, st_dir = self.supertrend(df)
        st_perf = 0.0
        st_perf_arr = [0.0]
        for i in range(1, n):
            perf = st_perf_arr[-1] + (2.0 / (self.perf_alpha + 1.0)) * ((close.iloc[i] - close.iloc[i-1]) * np.sign(close.iloc[i-1] - st_val.iloc[i-1]) - st_perf_arr[-1])
            st_perf_arr.append(perf)
        st_perf = pd.Series(st_perf_arr, index=close.index)
        aiBull = (st_dir == -1) & (st_perf > 0.0)
        aiBear = (st_dir == 1) & (st_perf < 0.0)
        # Structure (BOS)
        hi_tg = df['high'].rolling(self.ob_len*2+1, center=True).max()
        lo_tg = df['low'].rolling(self.ob_len*2+1, center=True).min()
        bosB = (close > hi_tg)
        bosS = (close < lo_tg)
        longC = bosB & (emaF > emaS) & aiBull & (rsi_val > 50) & (macd_line > signal_line) & volC
        shortC = bosS & (emaF < emaS) & aiBear & (rsi_val < 50) & (macd_line < signal_line) & volC
        # クールダウン判定
        last_long = longC[longC].index[-1] if longC.any() else -self.cooldown_bars
        last_short = shortC[shortC].index[-1] if shortC.any() else -self.cooldown_bars
        long_alert = longC.iloc[-1] and (n - last_long > self.cooldown_bars)
        short_alert = shortC.iloc[-1] and (n - last_short > self.cooldown_bars)
        return {'long_alert': bool(long_alert), 'short_alert': bool(short_alert)}

# 使い方例:
# df = pd.DataFrame({ ... })
# smc = SMCAlertEngine()
# alert = smc.check_alert(df)
# if alert['long_alert']: ...
# if alert['short_alert']: ...
