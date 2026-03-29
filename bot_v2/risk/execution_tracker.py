class ExecutionTracker:
    def __init__(self):
        self.positions = {}
    def open(self, trade_id, strategy, price, size, side):
        self.positions[trade_id] = {
            "strategy": strategy,
            "entry_price": price,
            "size": size,
            "side": side
        }
    def close(self, trade_id, price):
        pos = self.positions.get(trade_id)
        if not pos:
            return 0
        entry = pos["entry_price"]
        size = pos["size"]
        if pos["side"] == "buy":
            pnl = (price - entry) * size
        else:
            pnl = (entry - price) * size
        del self.positions[trade_id]
        return pnl
