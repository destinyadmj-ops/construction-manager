"""
multi_timeframe_engine.py
マルチタイムフレームバイアスエンジン
- 最終1本ではなく直近N本の一致度でバイアスを判定
- より確信度の高いシグナルのみ返す
"""


class MultiTimeframeEngine:

    def bias(self, c1h, c30, c5, lookback=3, regime=None):
        """
        Parameters
        ----------
        c1h  : list  1h ローソク足
        c30  : list  30m（または 15m）ローソク足
        c5   : list  5m ローソク足
        lookback : int  判定に使う本数

        Returns
        -------
        "BUY" | "SELL" | None
        """
        try:
            n = min(lookback, len(c1h), len(c30), len(c5))
            if n < 1:
                return None

            def _bullish_count(candles, n):
                return sum(
                    1 for c in candles[-n:]
                    if float(c[4]) > float(c[1])  # close > open
                )

            # regimeごとに重みを変える例
            regime_weights = {
                "TREND_UP":   (0.5, 0.3, 0.2),
                "TREND_DOWN": (0.2, 0.3, 0.5),
                "VOLATILE":  (0.33, 0.33, 0.34),
                "RANGE":     (0.33, 0.33, 0.34),
            }
            w1, w2, w3 = regime_weights.get(regime, (0.33, 0.33, 0.34))

            bull_1h = _bullish_count(c1h, n)
            bull_30 = _bullish_count(c30, n)
            bull_5  = _bullish_count(c5, n)

            total = n * 3
            bull_score = (bull_1h * w1 + bull_30 * w2 + bull_5 * w3) / n
            bear_score = ((n-bull_1h) * w1 + (n-bull_30) * w2 + (n-bull_5) * w3) / n

            # 75% 以上一致でシグナル確定
            if bull_score >= 0.75:
                return "BUY"
            if bear_score >= 0.75:
                return "SELL"

            return None

        except Exception:
            return None
