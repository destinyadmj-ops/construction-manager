import sqlite3
import os
from collections import Counter

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'bot_v2', 'database', 'runtime_state.db')
# Fallback to package path
if not os.path.exists(DB_PATH):
    DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'database', 'runtime_state.db')

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()
try:
    cur.execute('SELECT timestamp, symbol, alert_name, reason FROM rejected_signals')
    rows = cur.fetchall()
except Exception as e:
    print('no rejected_signals table or DB error:', e)
    rows = []

conn.close()

if not rows:
    print('No rejected_signals rows found')
    raise SystemExit(0)

reasons = Counter()
symbols = Counter()
for ts, symbol, alert_name, reason in rows:
    reasons[reason or 'unknown'] += 1
    symbols[symbol or 'unknown'] += 1

print('Top rejection reasons:')
for reason, cnt in reasons.most_common(10):
    print(f'{cnt:6d}  {reason}')

print('\nTop symbols:')
for sym, cnt in symbols.most_common(10):
    print(f'{cnt:6d}  {sym}')
