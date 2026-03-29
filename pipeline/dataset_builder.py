import sqlite3
import pandas as pd

DB_PATH = "c:/Users/desti/trading-bot/trades.db"

def build_dataset():
    conn = sqlite3.connect(DB_PATH)
    df = pd.read_sql("""
    SELECT timestamp, symbol, pnl, exit_reason
    FROM trades
    """, conn)
    conn.close()
    # 特徴量生成（簡易）
    df["return"] = df["pnl"].pct_change().fillna(0)
    df["rsi"] = 50 + df["return"].rolling(10).mean() * 100
    df["atr"] = df["return"].rolling(10).std() * 100
    df = df.fillna(0)
    return df
