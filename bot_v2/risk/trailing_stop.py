"""
trailing_stop.py
段階的トレーリングストップ + ロスカット監視
"""
import logging

# 設定値（configからimport推奨）
LEVERAGE = 60
TRAILING_STAGE_1 = 0.015  # 1.5%
TRAILING_STAGE_2 = 0.025  # 2.5%
TRAILING_STAGE_3 = 0.035  # 3.5%
MIN_STOP_BUFFER = 0.005   # 0.5%


def update_trailing_dynamic(symbol, position, entry_price):
    """
    利益に応じた段階的トレーリング（レバレッジ 60 対応）
    """
    side = position["holdSide"]
    current_price = float(position["markPrice"])
    roi = (current_price - entry_price) / entry_price

    # ロスカット価格（安全な SL 幅を確保）
    if side == "long":
        liquidation_price = entry_price * (1 - 1/LEVERAGE)
        safety_stop = liquidation_price + (entry_price * MIN_STOP_BUFFER)
        if roi < 0.5:
            trail_ratio = TRAILING_STAGE_1
        elif roi < 2.0:
            trail_ratio = TRAILING_STAGE_2
        else:
            trail_ratio = TRAILING_STAGE_3
        stop_price = max(safety_stop, current_price * (1 - trail_ratio))
    else:
        liquidation_price = entry_price * (1 + 1/LEVERAGE)
        safety_stop = liquidation_price - (entry_price * MIN_STOP_BUFFER)
        if roi > -0.5:
            trail_ratio = TRAILING_STAGE_1
        elif roi > -2.0:
            trail_ratio = TRAILING_STAGE_2
        else:
            trail_ratio = TRAILING_STAGE_3
        stop_price = min(safety_stop, current_price * (1 + trail_ratio))

    # ここでAPI等でストップ注文を更新
    logging.info(f"[TRAIL] {symbol} {side} stop={stop_price:.2f} (roi={roi:.2%})")
    return stop_price


def check_liquidation_risk(position, leverage=LEVERAGE):
    """
    ロスカット接近警告
    """
    margin_ratio = (float(position['total']) * float(position['markPrice'])) / leverage / 1000
    if margin_ratio > 0.8:  # 80% 使用
        logging.warning(f"Liquidation risk High: {margin_ratio:.1%}")
        return True
    return False
