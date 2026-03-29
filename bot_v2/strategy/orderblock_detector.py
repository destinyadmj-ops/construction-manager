import numpy as np
import pandas as pd

class OrderBlockDetector:
    def __init__(self, length=5, bull_ext_last=3, bear_ext_last=3, mitigation='Wick'):
        self.length = length
        self.bull_ext_last = bull_ext_last
        self.bear_ext_last = bear_ext_last
        self.mitigation = mitigation

    def detect(self, df: pd.DataFrame):
        # df: DataFrame with columns ['open', 'high', 'low', 'close', 'volume']
        n = len(df)
        if n < self.length * 2:
            return {'bull_ob': [], 'bear_ob': []}

        bull_ob = []
        bear_ob = []
        for i in range(self.length, n):
            # Pivot detection (volume)
            vol_window = df['volume'].iloc[i-self.length:i+1]
            if vol_window.iloc[-1] == vol_window.max():
                # Structure state
                upper = df['high'].iloc[i-self.length:i+1].max()
                lower = df['low'].iloc[i-self.length:i+1].min()
                if self.mitigation == 'Close':
                    target_bull = df['close'].iloc[i-self.length:i+1].min()
                    target_bear = df['close'].iloc[i-self.length:i+1].max()
                else:
                    target_bull = lower
                    target_bear = upper
                # Order block logic
                if df['low'].iloc[i-self.length] < lower:
                    # Bullish OB
                    bull_ob.append({
                        'index': i,
                        'top': (df['high'].iloc[i-self.length] + df['low'].iloc[i-self.length]) / 2,
                        'btm': df['low'].iloc[i-self.length],
                        'avg': (df['high'].iloc[i-self.length] + df['low'].iloc[i-self.length]) / 2,
                        'left': i-self.length
                    })
                if df['high'].iloc[i-self.length] > upper:
                    # Bearish OB
                    bear_ob.append({
                        'index': i,
                        'top': df['high'].iloc[i-self.length],
                        'btm': (df['high'].iloc[i-self.length] + df['low'].iloc[i-self.length]) / 2,
                        'avg': (df['high'].iloc[i-self.length] + df['low'].iloc[i-self.length]) / 2,
                        'left': i-self.length
                    })
        # Keep only last N
        bull_ob = bull_ob[-self.bull_ext_last:]
        bear_ob = bear_ob[-self.bear_ext_last:]
        return {'bull_ob': bull_ob, 'bear_ob': bear_ob}

# 使い方例:
# df = pd.DataFrame({ ... })
# detector = OrderBlockDetector()
# obs = detector.detect(df)
# if obs['bull_ob']: ... # アラート条件
