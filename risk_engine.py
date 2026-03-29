class RiskEngine:
    def __init__(self, initial_balance):
        self.balance = initial_balance
    def update_balance(self, pnl):
        self.balance += pnl
