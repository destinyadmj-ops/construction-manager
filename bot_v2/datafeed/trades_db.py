"""
trades_db.py

- trades テーブルの作成・記録・クエリ用ユーティリティ
- トレード履歴をSQLiteで一元管理
"""
import os
import sqlite3
import time
from typing import Any, Dict, Optional

DB_PATH = os.path.join(os.path.dirname(__file__), '../database/runtime_state.db')

def ensure_trades_table():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        '''CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER,
            symbol TEXT,
            side TEXT,
            entry_price REAL,
            exit_price REAL,
            size REAL,
            pnl REAL,
            exit_reason TEXT,
            extra JSON
        )'''
    )
    conn.commit()
    conn.close()

def record_trade(symbol: str, side: str, entry_price: float, exit_price: float, size: float, pnl: float, exit_reason: str, extra: Optional[Dict[str, Any]] = None):
    ensure_trades_table()
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        '''INSERT INTO trades (timestamp, symbol, side, entry_price, exit_price, size, pnl, exit_reason, extra)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
        (int(time.time()), symbol, side, entry_price, exit_price, size, pnl, exit_reason, str(extra) if extra else None)
    )
    conn.commit()
    conn.close()

def query_trades(limit: int = 100):
    ensure_trades_table()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute('SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?', (limit,))
    rows = cur.fetchall()
    conn.close()
    return rows
