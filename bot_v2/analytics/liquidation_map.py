"""
Liquidation Map Engine
- 板・ポジションデータからロスカット密集エリアをヒートマップ化
"""
import numpy as np

class LiquidationMapEngine:
    def __init__(self, bin_size=100):
        self.bin_size = bin_size

    def build_map(self, positions):
        """
        positions: list of dict {price, size, side}
        return: dict {price_bin: total_size}
        """
        bins = {}
        for pos in positions:
            price_bin = int(float(pos['price']) // self.bin_size * self.bin_size)
            bins.setdefault(price_bin, 0)
            bins[price_bin] += abs(float(pos['size']))
        return bins

    def to_heatmap(self, bins):
        """
        bins: dict {price_bin: total_size}
        return: list of (price_bin, total_size) sorted desc
        """
        return sorted(bins.items(), key=lambda x: -x[1])
