import pandas as pd

def load_csv(symbol):
    path = f"c:/Users/desti/trading-bot/data/{symbol}.csv"
    df = pd.read_csv(path)
    # 必須カラム: timestamp, open, high, low, close, volume
    return df
