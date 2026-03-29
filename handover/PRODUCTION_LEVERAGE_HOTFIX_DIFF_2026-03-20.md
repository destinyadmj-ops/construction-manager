# PRODUCTION HOTFIX DIFF（Leverage apply gap: SIREN/RIVER）

## 目的
- `SIRENUSDT` / `RIVERUSDT` のレバレッジ適用失敗（`40797 Exceeded the maximum settable leverage`）を本番で解消。
- 失敗時に自動フォールバック再適用を入れ、`LEVERAGE_REQUIRE_SUCCESS=true` 運用でもエントリー阻害を減らす。

## コード差分（適用対象: `webhook_bot_v2.py`）

```diff
@@
 LEVERAGE_DOGE_MAX = int(os.getenv('LEVERAGE_DOGE_MAX', str(LEVERAGE_MAX)))
 LEVERAGE_POLYX_MAX = int(os.getenv('LEVERAGE_POLYX_MAX', str(LEVERAGE_MAX)))
-LEVERAGE_SIREN_MAX = int(os.getenv('LEVERAGE_SIREN_MAX', str(LEVERAGE_MAX)))
-LEVERAGE_RIVER_MAX = int(os.getenv('LEVERAGE_RIVER_MAX', str(LEVERAGE_MAX)))
+LEVERAGE_SIREN_MAX = int(os.getenv('LEVERAGE_SIREN_MAX', '20'))
+LEVERAGE_RIVER_MAX = int(os.getenv('LEVERAGE_RIVER_MAX', '20'))
 LEVERAGE_HYPE_MAX = int(os.getenv('LEVERAGE_HYPE_MAX', str(LEVERAGE_MAX)))
 LEVERAGE_XRP_MAX = int(os.getenv('LEVERAGE_XRP_MAX', str(LEVERAGE_MAX)))
 LEVERAGE_PEPE_MAX = int(os.getenv('LEVERAGE_PEPE_MAX', str(LEVERAGE_MAX)))
 LEVERAGE_SHIB_MAX = int(os.getenv('LEVERAGE_SHIB_MAX', str(LEVERAGE_MAX)))
 LEVERAGE_TSLA_MAX = int(os.getenv('LEVERAGE_TSLA_MAX', str(LEVERAGE_MAX)))
 LEVERAGE_ENJ_MAX = int(os.getenv('LEVERAGE_ENJ_MAX', str(LEVERAGE_MAX)))
+LEVERAGE_RETRY_ON_40797 = str(os.getenv('LEVERAGE_RETRY_ON_40797', 'true')).lower() in ('1', 'true', 'yes', 'on')
+LEVERAGE_40797_FALLBACK = int(os.getenv('LEVERAGE_40797_FALLBACK', '20'))
 LEVERAGE_SET_EXEMPT_SYMBOLS = {
@@
 def _prepare_entry_leverage(symbol: str, bot_eval: dict | None, atr_ratio: float = 0.0):
@@
-    response = _apply_symbol_leverage(symbol=symbol, target_leverage=target)
-    success = _is_order_success(response)
+    response = _apply_symbol_leverage(symbol=symbol, target_leverage=target)
+    success = _is_order_success(response)
+    applied_leverage = int(target)
+
+    if (not success) and LEVERAGE_RETRY_ON_40797:
+        code = str((response or {}).get('code', ''))
+        msg = str((response or {}).get('msg', '')).lower()
+        if code == '40797' or 'exceeded the maximum settable leverage' in msg:
+            symbol_cap = int(_symbol_leverage_cap(symbol))
+            fallback_target = max(1, min(symbol_cap, LEVERAGE_40797_FALLBACK, int(target)))
+            if fallback_target != int(target):
+                retry_response = _apply_symbol_leverage(symbol=symbol, target_leverage=fallback_target)
+                if _is_order_success(retry_response):
+                    response = {
+                        'code': '00000',
+                        'msg': 'success_after_fallback',
+                        'target_leverage': int(target),
+                        'fallback_leverage': int(fallback_target),
+                        'initial_response': response,
+                        'retry_response': retry_response,
+                    }
+                    success = True
+                    applied_leverage = int(fallback_target)
+                else:
+                    response = {
+                        'code': str((retry_response or {}).get('code', code)),
+                        'msg': 'fallback_failed',
+                        'target_leverage': int(target),
+                        'fallback_leverage': int(fallback_target),
+                        'initial_response': response,
+                        'retry_response': retry_response,
+                    }
@@
     return {
         'enabled': True,
         'applied': bool(success),
         'target_leverage': int(target),
+        'applied_leverage': int(applied_leverage),
         'symbol_cap': int(_symbol_leverage_cap(symbol)),
         'response': response,
         'reason': 'applied' if success else 'apply_failed',
     }
```

## `.bitget_env` 推奨値（本番）

```env
# ---- leverage gap hotfix (2026-03-20) ----
LEVERAGE_SIREN_MAX=20
LEVERAGE_RIVER_MAX=20

# 40797 fallback
LEVERAGE_RETRY_ON_40797=true
LEVERAGE_40797_FALLBACK=20

# 既存運用を維持
LEVERAGE_REQUIRE_SUCCESS=true
```

## 反映手順（本番）
1. コード反映（`webhook_bot_v2.py`）
2. `.bitget_env` に上記4キーを追加/更新
3. サービス再起動
4. 検証（SIREN/RIVERで `target<=20` かつ `applied=true`）

### 自動化実行（推奨）

```powershell
./apply_leverage_hotfix_prod.ps1
```

- 再起動を手動で行う場合のみ:

```powershell
./apply_leverage_hotfix_prod.ps1 -SkipRestart
```

## 検証コマンド

```bash
python3 - <<'PY'
import json, sys
sys.path.append('/home/linuxuser')
import webhook_bot_v2 as w

for sym in ['SIRENUSDT','RIVERUSDT']:
    target=int(w._target_leverage(sym, bot_eval=None, atr_ratio=0.0))
    meta=w._prepare_entry_leverage(sym, bot_eval=None, atr_ratio=0.0)
    print(json.dumps({
        'symbol': sym,
        'target_leverage': target,
        'applied': meta.get('applied'),
        'applied_leverage': meta.get('applied_leverage'),
        'reason': meta.get('reason'),
        'response': meta.get('response'),
    }, ensure_ascii=False))
PY
```

## ロールバック
- `.bitget_env` の追加4キーを戻す（または旧値へ復帰）
- `webhook_bot_v2.py` の上記差分を戻す
- サービス再起動
