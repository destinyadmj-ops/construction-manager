import random

class ExecutionEngine:

    def __init__(self):
        self.slippage_history = []

    def execute_order(self, price, size):
        # 疑似スリッページ
        slippage = random.uniform(-0.001, 0.002)
        executed_price = price * (1 + slippage)
        self.slippage_history.append(slippage)
        return executed_price

    def get_avg_slippage(self):
        if not self.slippage_history:
            return 0
        return sum(self.slippage_history) / len(self.slippage_history)
