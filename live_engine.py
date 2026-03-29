class LiveEngine:
    def __init__(self, client, symbols):
        self.client = client
        self.symbols = symbols
        self.positions = {s: 0 for s in symbols}

    def rebalance(self, weights, balance):
        for i, sym in enumerate(self.symbols):
            target_value = balance * weights[i]
            price = self._get_price(sym)
            target_size = target_value / price
            current_size = self.positions[sym]
            diff = target_size - current_size
            if abs(diff) < 1e-6:
                continue
            side = "buy" if diff > 0 else "sell"
            order = self.client.place_order(
                symbol=sym,
                side=side,
                size=abs(diff),
                order_type="market"
            )
            fill_price = float(order["price"])
            self.positions[sym] = target_size

    def _get_price(self, symbol):
        ticker = self.client.get_ticker(symbol)
        return float(ticker["last"])
