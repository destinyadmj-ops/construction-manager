"""
Indicators Engine
- 各種指標値（ATR, RSI, ボラティリティ等）の計算・保存・fail-safe・DB書き込み
- indicators.jsonの生成・heartbeat監視・DB化対応
"""
import os
import json
import sqlite3
import time
from datetime import datetime
from typing import Any, Dict

INDICATOR_PATH = os.path.join(os.path.dirname(__file__), '../data/indicators.json')
DB_PATH = os.path.join(os.path.dirname(__file__), '../database/runtime_state.db')

DEFAULT_INDICATORS = {
    'timestamp': int(time.time()),
    'ATR': None,
    'RSI': None,
    'volatility': None,
    'ema_fast': None,
    'ema_slow': None,
    'symbol': None,
}

def default_indicator_values() -> Dict[str, Any]:
    d = dict(DEFAULT_INDICATORS)
    d['timestamp'] = int(time.time())
    return d

def save_indicators(indicators: Dict[str, Any]) -> None:
    try:
        with open(INDICATOR_PATH, 'w', encoding='utf-8') as f:
            json.dump(indicators, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[indicators_engine] indicator save failed: {e}")

def load_indicators() -> Dict[str, Any]:
    try:
        with open(INDICATOR_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default_indicator_values()

def save_indicators_db(indicators: Dict[str, Any]) -> None:
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS indicators (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER,
            symbol TEXT,
            timeframe TEXT,
            ATR REAL,
            RSI REAL,
            volatility REAL,
            ema_fast REAL,
            ema_slow REAL,
            payload TEXT
        )''')
        payload = json.dumps(indicators, ensure_ascii=False)
        c.execute('''INSERT INTO indicators (timestamp, symbol, timeframe, ATR, RSI, volatility, ema_fast, ema_slow, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''', (
            indicators.get('timestamp'),
            indicators.get('symbol'),
            indicators.get('timeframe'),
            indicators.get('ATR'),
            indicators.get('RSI'),
            indicators.get('volatility'),
            indicators.get('ema_fast'),
            indicators.get('ema_slow'),
            payload,
        ))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[indicators_engine] DB save failed: {e}")

def heartbeat_check() -> bool:
    try:
        mtime = os.path.getmtime(INDICATOR_PATH)
        now = time.time()
        # 300秒から120秒へ短縮: 120秒以内に更新されていればOK
        return (now - mtime) < 120
    except Exception:
        return False

def update_indicators(indicators: Dict[str, Any]) -> None:
    if not indicators:
        indicators = default_indicator_values()
    indicators['timestamp'] = int(time.time())
    save_indicators(indicators)
    save_indicators_db(indicators)

# 例: 指標値計算後に必ず呼ぶ
# update_indicators({'ATR': 0.012, 'RSI': 55.2, 'volatility': 0.0018, 'ema_fast': 12345, 'ema_slow': 12300, 'symbol': 'BTCUSDT'})
