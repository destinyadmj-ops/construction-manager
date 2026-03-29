"""
signal_weight_engine.py
シグナル重みエンジン（DB 学習値 + デフォルト重み）
"""
import sqlite3

DB_PATH = "/home/linuxuser/bot_v2/database/bot.db"


class SignalWeightEngine:

    def __init__(self):

        self.default_weights = {
            "BOS":        1.5,
            "EMA":        1.2,
            "RSI":        1.0,
            "MACD":       1.0,
            "SUPERTREND": 1.3,
            "VOLUME":     1.1,
            "SWEEP":      1.4,
            "MTF":        1.2,
            "ORDERBLOCK": 1.4,   # ← 追加（高精度シグナル）
        }

        self.weights = self.load_weights()

    def load_weights(self, regime=None):

        weights = self.default_weights.copy()

        try:
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()

            if regime:
                c.execute(
                    "SELECT signal, weight FROM signal_performance WHERE regime=?",
                    (regime,)
                )
            else:
                c.execute("SELECT signal, weight FROM signal_performance")

            for signal, weight in c.fetchall():
                weights[signal.upper()] = weight

            conn.close()

        except Exception:
            pass

        return weights

    def refresh(self, regime=None):
        """Learning Engine 更新後に再読み込み"""
        self.weights = self.load_weights(regime)

    def score(self, signals, regime=None):
        weights = self.load_weights(regime) if regime else self.weights
        buy_score = 0.0
        sell_score = 0.0
        for name, signal in signals.items():
            weight = weights.get(name.upper(), 1.0)
            if signal == "BUY":
                buy_score += weight
            elif signal == "SELL":
                sell_score += weight
        return buy_score, sell_score

    def update_performance(self, signal_name, result, regime=None):
        """
        トレード結果に応じて重みを自動調整
        result: 1=勝ち, 0=負け
        regime: 市場レジーム
        """
        import datetime
        try:
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            # 履歴テーブルに記録
            c.execute(
                "INSERT INTO signal_trade_history (signal, result, regime, ts) VALUES (?, ?, ?, ?)",
                (signal_name, result, regime or "ALL", datetime.datetime.utcnow().isoformat())
            )
            # 直近30件の勝率で重みを調整
            c.execute(
                "SELECT result FROM signal_trade_history WHERE signal=? AND regime=? ORDER BY ts DESC LIMIT 30",
                (signal_name, regime or "ALL")
            )
            rows = c.fetchall()
            if rows:
                win_rate = sum(r[0] for r in rows) / len(rows)
                base = self.default_weights.get(signal_name.upper(), 1.0)
                new_weight = round(base * (0.8 + win_rate * 0.8), 2)  # 勝率80%で1.44倍
                # DBに保存
                c.execute(
                    "INSERT OR REPLACE INTO signal_performance (signal, weight, regime) VALUES (?, ?, ?)",
                    (signal_name, new_weight, regime or "ALL")
                )
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"[SignalWeightEngine] update_performance error: {e}")
