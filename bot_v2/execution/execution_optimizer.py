from typing import Optional
import os
import time
import json
import sqlite3


class ExecutionOptimizer:
    def __init__(self, max_slippage_bps: Optional[float] = None, max_failures: Optional[int] = None, runtime_db: str | None = None):
        from bot_v2 import config
        try:
            self.max_slippage_bps = float(max_slippage_bps if max_slippage_bps is not None else float(os.getenv('EXECUTION_MAX_SLIPPAGE_BPS', getattr(config, 'EXECUTION_MAX_SLIPPAGE_BPS', 5))))
        except Exception:
            self.max_slippage_bps = 5.0
        try:
            self.max_failures = int(max_failures if max_failures is not None else int(os.getenv('EXECUTION_MAX_FAILURES', '5')))
        except Exception:
            self.max_failures = 5

        # persistence / cooldown settings
        try:
            self.pause_cooldown = int(os.getenv('EXECUTION_PAUSE_COOLDOWN_SECONDS', '600'))
        except Exception:
            self.pause_cooldown = 600

        # runtime DB path resolution
        if runtime_db:
            self._db_path = runtime_db
        else:
            configured = str(os.getenv('RUNTIME_DB', '') or '').strip()
            if configured:
                self._db_path = configured
            else:
                base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'database'))
                try:
                    os.makedirs(base_dir, exist_ok=True)
                except Exception:
                    pass
                self._db_path = os.path.join(base_dir, 'runtime_state.db')

        self.failure_count = 0
        self.paused = False
        self.paused_since = 0.0

        # ensure table exists and load state
        try:
            self._ensure_table()
            self._load_state()
        except Exception:
            # on any error, keep in-memory defaults
            pass

    def _ensure_table(self):
        con = sqlite3.connect(self._db_path, timeout=2)
        try:
            cur = con.cursor()
            cur.execute("""
            CREATE TABLE IF NOT EXISTS optimizer_state (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at REAL
            )
            """)
            con.commit()
        finally:
            con.close()

    def _persist_state(self):
        obj = {'paused': bool(self.paused), 'failure_count': int(self.failure_count), 'paused_since': float(self.paused_since)}
        con = sqlite3.connect(self._db_path, timeout=2)
        try:
            cur = con.cursor()
            cur.execute("REPLACE INTO optimizer_state(key, value, updated_at) VALUES (?, ?, ?)", ('execution_optimizer', json.dumps(obj), time.time()))
            con.commit()
        finally:
            con.close()

    def _load_state(self):
        con = sqlite3.connect(self._db_path, timeout=2)
        try:
            cur = con.cursor()
            cur.execute("SELECT value FROM optimizer_state WHERE key = ?", ('execution_optimizer',))
            row = cur.fetchone()
            if row:
                try:
                    obj = json.loads(row[0])
                    self.paused = bool(obj.get('paused', False))
                    self.failure_count = int(obj.get('failure_count', 0))
                    self.paused_since = float(obj.get('paused_since', 0.0))
                except Exception:
                    self.paused = False
                    self.failure_count = 0
                    self.paused_since = 0.0
        finally:
            con.close()

    def adjust_order(self, price, side, orderbook):
        # auto-unpause if cooldown expired
        if self.paused and self.paused_since:
            try:
                if time.time() - float(self.paused_since) > float(self.pause_cooldown):
                    self.reset()
            except Exception:
                pass

        if self.paused:
            return None

        best_bid = orderbook.get("bid", price)
        best_ask = orderbook.get("ask", price)
        spread = (best_ask - best_bid) / price * 10000 if price and price != 0 else 0.0
        if spread > self.max_slippage_bps:
            self.failure_count += 1
            if self.failure_count >= self.max_failures:
                self.paused = True
                self.paused_since = time.time()
                try:
                    self._persist_state()
                except Exception:
                    pass
            return None  # スキップ

        # 成功時はfailure_countをリセット
        self.failure_count = 0
        try:
            self._persist_state()
        except Exception:
            pass

        if side == "buy":
            return best_ask
        else:
            return best_bid

    def is_paused(self) -> bool:
        # check cooldown on call
        if self.paused and self.paused_since:
            try:
                if time.time() - float(self.paused_since) > float(self.pause_cooldown):
                    self.reset()
            except Exception:
                pass
        return self.paused

    def reset(self):
        self.failure_count = 0
        self.paused = False
        self.paused_since = 0.0
        try:
            self._persist_state()
        except Exception:
            pass
