"""
adaptive_position_sizer.py
ボラティリティ適応型ポジションサイザー
- 動的残高取得（account_balance.py）
- RISK_PER_TRADE × leverage / price で BTC 量を算出
- MAX_MARGIN_RATE 15% キャップ
"""
import numpy as np
from bot_v2.risk.account_balance import get_balance
from bot_v2.config import LEVERAGE, MIN_POSITION_SIZE

RISK_PER_TRADE = 0.01   # 口座の 1% をリスク証拠金として使用
MAX_MARGIN_RATE = 0.15  # 口座の 15% を証拠金上限


class AdaptivePositionSizer:

    def calculate(self, balance_ignored, candles):
        """
        Parameters
        ----------
        balance_ignored : float
            後方互換のため残すが内部では使わない（get_balance() を使う）
        candles : list
            OHLCV キャンドルリスト [[ts,o,h,l,c,v], ...]

        Returns
        -------
        float : BTC 量（最小 MIN_POSITION_SIZE）
        """
        balance = get_balance()

        closes = [float(c[4]) for c in candles]
        if not closes:
            return MIN_POSITION_SIZE

        price = closes[-1]
        if price <= 0:
            return MIN_POSITION_SIZE

        # ボラティリティで risk rate を調整
        volatility = np.std(closes[-20:]) if len(closes) >= 20 else np.std(closes)
        risk = RISK_PER_TRADE
        if volatility > price * 0.025:    # ボラ > 2.5% → リスク半減
            risk = RISK_PER_TRADE * 0.5
        elif volatility < price * 0.005:  # ボラ < 0.5% → リスク 1.5 倍
            risk = RISK_PER_TRADE * 1.5

        # 証拠金ベースで BTC 算出: margin / price × leverage
        margin_usdt = balance * risk
        size_btc = margin_usdt * LEVERAGE / price

        # 上限: balance × 15% × leverage / price
        max_btc = balance * MAX_MARGIN_RATE * LEVERAGE / price

        size_btc = min(size_btc, max_btc)
        size_btc = round(size_btc, 3)

        return max(size_btc, MIN_POSITION_SIZE)
