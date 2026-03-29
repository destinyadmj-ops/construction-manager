python3 -c "import sqlite3,json;db='/home/linuxuser/bot_v2/database/runtime_state.db';conn=sqlite3.connect(db);cur=conn.cursor();cur.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name='monitor_outcome_stats'\");row=cur.fetchone();print('TABLE_EXISTS',bool(row));
if row:
 cur.execute('SELECT COUNT(*) FROM monitor_outcome_stats');print('ROW_COUNT',int(cur.fetchone()[0]));
 cur.execute('SELECT position_state, alert_name, action, trades, wins, losses, roi_sum, pnl_sum, updated_at FROM monitor_outcome_stats ORDER BY updated_at DESC LIMIT 5');print('LATEST_ROWS',json.dumps(cur.fetchall(),ensure_ascii=False));
conn.close()"
