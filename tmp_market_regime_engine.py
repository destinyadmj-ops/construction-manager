"""
market_regime_engine.py
市場レジーム検知エンジン
- ボリンジャーバンド幅 + トレンド方向 + ボラ比率 で分類
- TREND_UP / TREND_DOWN / VOLATILE / RANGE
"""
import numpy as np


class MarketRegimeEngine:

    def detect(self, candles, bb_period=20, bb_mult=2.0, risk_threshold=1.8):
        """
        Parameters
        ----------
        candles : list  OHLCV キャンドルリスト
        bb_period : int  ボリンジャーバンド期間
        bb_mult   : float  バンド幅倍率

        Returns
        -------
        str : "TREND_UP" | "TREND_DOWN" | "VOLATILE" | "RANGE"
        """
        closes = np.array([float(c[4]) for c in candles])

        if len(closes) < bb_period + 1:
            return "UNKNOWN"

        # ── ボリンジャーバンド幅 ──
        recent = closes[-bb_period:]
        bb_mid = np.mean(recent)
        bb_std = np.std(recent)
        bb_width = (bb_std * bb_mult * 2) / bb_mid  # 正規化したバンド幅

        # ── 短期・長期トレンド ──
        trend_long  = closes[-1] - closes[-min(30, len(closes)):][ 0]
        trend_short = closes[-1] - closes[-min(10, len(closes)):][ 0]

        # ── ボラ急増判定（直近 vs 全体）──
        recent_vol = np.std(closes[-10:]) if len(closes) >= 10 else bb_std
        long_vol   = bb_std
        vol_ratio  = recent_vol / (long_vol + 1e-9)
        risk_reduce = False

        # ── 分類 ──
        # バンド幅が十分広い = トレンド相場
        if bb_width > 0.015:     # 1.5% 以上のバンド幅
            if trend_long > 0 and trend_short > 0:
                return "TREND_UP", risk_reduce
            return "TREND_DOWN", risk_reduce

        # ボラ急増 = 不安定相場
        if vol_ratio > risk_threshold:
            risk_reduce = True
            return "VOLATILE", risk_reduce

        # それ以外 = レンジ
        return "RANGE", risk_reduce
