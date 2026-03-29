import pandas as pd
import numpy as np

def add_indicators(df):
    df["return"] = df["close"].pct_change()
    df["rsi"] = 50 + (df["return"].rolling(14).mean() * 100)
    df["atr"] = (df["high"] - df["low"]).rolling(14).mean()
    return df.fillna(0)

def build_mtf_features(df):
    df_5 = df.resample("5T", on="timestamp").agg({
        "open":"first","high":"max","low":"min","close":"last","volume":"sum"
    }).dropna()
    df_15 = df.resample("15T", on="timestamp").agg({
        "open":"first","high":"max","low":"min","close":"last","volume":"sum"
    }).dropna()
    df_5 = add_indicators(df_5)
    df_15 = add_indicators(df_15)
    features = np.array([
        df.iloc[-1]["rsi"], df.iloc[-1]["atr"],
        df_5.iloc[-1]["rsi"], df_5.iloc[-1]["atr"],
        df_15.iloc[-1]["rsi"], df_15.iloc[-1]["atr"],
    ])
    return features
