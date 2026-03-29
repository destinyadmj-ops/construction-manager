import os
import sqlite3
import time
import json
import logging
from typing import Dict

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'database', 'runtime_state.db')

def _fetch_one(query: str, params=()):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(query, params)
    row = cur.fetchone()
    conn.close()
    return row

def daily_summary(days: int = 1) -> Dict[str, object]:
    since = int(time.time()) - days * 24 * 3600
    total_trades = _fetch_one('SELECT COUNT(*) FROM trades WHERE timestamp >= ?', (since,))[0] or 0
    total_pnl = _fetch_one('SELECT COALESCE(SUM(pnl),0) FROM trades WHERE timestamp >= ?', (since,))[0] or 0.0
    rejected_count = _fetch_one('SELECT COUNT(*) FROM rejected_signals WHERE timestamp >= ?', (since,))[0] or 0
    return {
        'since': since,
        'total_trades': int(total_trades),
        'total_pnl': float(total_pnl),
        'rejected_count': int(rejected_count),
    }

def send_summary_to_slack(webhook_url: str | None = None, days: int = 1):
    if webhook_url is None:
        webhook_url = os.getenv('SLACK_WEBHOOK_URL')
    if not webhook_url:
        logging.warning('Slack webhook not configured; skipping report')
        return
    summary = daily_summary(days=days)
    text = (
        f"[Daily Report] last {days} day(s)\n"
        f"Trades: {summary['total_trades']} | PnL: {summary['total_pnl']:.6f} | Rejected signals: {summary['rejected_count']}"
    )
    try:
        import requests
        requests.post(webhook_url, json={'text': text}, timeout=10)
    except Exception as e:
        logging.error(f'send_summary_to_slack failed: {e}')
