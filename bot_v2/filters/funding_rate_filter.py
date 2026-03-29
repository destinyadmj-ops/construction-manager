"""
Funding Rate Filter
- 資金調達率が閾値を超える場合は新規エントリーを制限
"""

class FundingRateFilter:
    def __init__(self, threshold=0.0005):
        self.threshold = threshold  # 例: 0.05%

    def allow_entry(self, funding_rate):
        """
        funding_rate: float (例: 0.0003)
        return: bool
        """
        return abs(funding_rate) < self.threshold
