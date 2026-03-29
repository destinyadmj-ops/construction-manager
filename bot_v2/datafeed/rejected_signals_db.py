"""
rejected_signals_db.py

- rejected_signals テーブルの作成・記録・クエリ用ユーティリティ
- シグナルが閾値未達/リスク制限/その他理由でrejectされた際に記録
- SQL分析基盤として利用
"""
import os
import sqlite3
import time
from typing import Any, Dict, Optional

DB_PATH = os.path.join(os.path.dirname(__file__), '../database/runtime_state.db')

def ensure_rejected_signals_table():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        '''CREATE TABLE IF NOT EXISTS rejected_signals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER,
            symbol TEXT,
            alert_name TEXT,
            side TEXT,
            score REAL,
            threshold REAL,
            reason TEXT,
            extra JSON
        )'''
    )
    conn.commit()
    conn.close()

def record_rejected_signal(symbol: str, alert_name: str, side: str, score: float, threshold: float, reason: str, extra: Optional[Dict[str, Any]] = None):
    ensure_rejected_signals_table()
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        '''INSERT INTO rejected_signals (timestamp, symbol, alert_name, side, score, threshold, reason, extra)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
        (int(time.time()), symbol, alert_name, side, score, threshold, reason, str(extra) if extra else None)
    )
    conn.commit()
    conn.close()

def query_rejected_signals(limit: int = 100):
    ensure_rejected_signals_table()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute('SELECT * FROM rejected_signals ORDER BY timestamp DESC LIMIT ?', (limit,))
    rows = cur.fetchall()
    conn.close()
    return rows
