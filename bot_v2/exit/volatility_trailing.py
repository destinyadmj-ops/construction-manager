"""
volatility_trailing.py
ATR連動トレーリングストップ
"""
import numpy as np

class VolatilityTrailingStop:
    """
    ATR(平均的な値動き)に連動したトレーリングストップ。
    - 買い: 最高値からATR×倍率だけ下
    - 売り: 最安値からATR×倍率だけ上
    
    Args:
        atr_multiplier (float): ATRに掛ける倍率(例:2.0)
    """
    def __init__(self, atr_multiplier=2.0):
        self.atr_multiplier = atr_multiplier
        self.highest = None
        self.lowest = None

    def update(self, price, atr, side):
        if side == "buy":
            if self.highest is None or price > self.highest:
                self.highest = price
            stop = self.highest - atr * self.atr_multiplier
            return stop
        elif side == "sell":
            if self.lowest is None or price < self.lowest:
                self.lowest = price
            stop = self.lowest + atr * self.atr_multiplier
            return stop
        return None

    def reset(self):
        """新規エントリー時などに最高値/最安値をリセット"""
        self.highest = None
        self.lowest = None
