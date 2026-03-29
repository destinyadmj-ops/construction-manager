# DRY_RUN=false 本番切替チェックリスト

## 概要
本ドキュメントは、テストモード（`DRY_RUN=true`）から本番モード（`DRY_RUN=false`）への安全な移行を保証するプロセスです。

---

## フェーズ 1: 事前確認（本番切替前：実施対象インシデント 0 の場合）

### 1.1 サービス健全性チェック

```bash
# サービス状態確認
ssh -i ~/.ssh/id_ed25519_root root@167.179.65.195 \
  "systemctl status webhook_bot_v2.service --no-pager | head -n 15"

# 期待値: active (running), CPU正常
```

**チェック項目:**
- [ ] サービスが `active (running)` になっているか
- [ ] 最近5分以内に restart されていないか
- [ ] CPU使用率が異常（>50%等）でないか

### 1.2 ヘルス確認

```bash
ssh -i ~/.ssh/id_ed25519_root root@167.179.65.195 \
  "curl -sS https://tanaka-bot.org/healthz | jq ."

# 期待値: status=ok, dry_run=true, recent_error_count=0
```

**チェック項目:**
- [ ] `status: ok`
- [ ] `dry_run: true`（まだテストモード）
- [ ] `recent_error_count: 0`
- [ ] `phase45_enabled: true`
- [ ] `feature_flags.doten: true`
- [ ] `feature_flags.orderblock: true`

### 1.3 ポジション確認

```bash
ssh -i ~/.ssh/id_ed25519_root root@167.179.65.195 \
  "sudo -u linuxuser python3 - <<'PY'
import os, json, sys
from pathlib import Path
sys.path.insert(0, '/home/linuxuser')
from bot_v2.execution.bitget_client import BitgetClient
for line in Path('/home/linuxuser/.bitget_env').read_text(encoding='utf-8').splitlines():
    if '=' in line and not line.strip().startswith('#'):
        k,v=line.split('=',1)
        os.environ[k.strip()] = v.strip()
client = BitgetClient()
resp = client.request('GET', '/api/v2/mix/position/all-position', {'productType':'USDT-FUTURES','marginCoin':'USDT'})
rows=[p.get('symbol') for p in (resp.get('data') or []) if float(p.get('total') or 0)>0]
print(json.dumps(rows,ensure_ascii=False) if rows else '[]')
PY"
```

**チェック項目:**
- [ ] 出力が `[]`（未決済ポジションなし）
- [ ] BTCUSDT/ETHUSDT/SOLUSDT いずれも長/短がない

### 1.4 テスト実行確認（DRY_RUN モード、強制 signature チェック）

```bash
curl -X POST https://tanaka-bot.org/webhook \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Key: 3f112f8e67295f2134f4f4b00f10f780" \
  -d '{"symbol":"BTCUSDT","action":"buy","price":100000,"strategy":"precheck","size":0.001,"order_type":"market"}' \
  | jq .

# 期待値: status=ok / no_signal / dry_run=true（うち1つ）
```

**チェック項目:**
- [ ] HTTP 200
- [ ] `dry_run: true` が応答内に含まれる
- [ ] `result.doten`, `result.code` など実行結果が JSON で返る

### 1.5 観測ログの活動確認

```bash
ssh -i ~/.ssh/id_ed25519_root root@167.179.65.195 \
  "tail -n 5 /home/linuxuser/bot_v2/data/phase45_observation.log | tail -n 1 | jq ."

# 期待値: 最新エントリが 1 分以内の timestamp を持つ
```

**チェック項目:**
- [ ] `observation.log` が 1 分以内に更新されている
- [ ] JSON が parse 可能（フォーマット正常）

---

## フェーズ 2: 本番切替（最終実行）

### 2.1 環境変数の切替

```bash
ssh -i ~/.ssh/id_ed25519_root root@167.179.65.195 \
  "sudo -u linuxuser python3 - <<'PY'
from pathlib import Path
p=Path('/home/linuxuser/.bitget_env')
text=p.read_text(encoding='utf-8')
lines=[]
for line in text.splitlines():
    if line.startswith('DRY_RUN='):
        lines.append('DRY_RUN=false')
    else:
        lines.append(line)
p.write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('DRY_RUN=false set')
PY"
```

**チェック項目:**
- [ ] 出力が `DRY_RUN=false set` である

### 2.2 サービス再起動

```bash
ssh -i ~/.ssh/id_ed25519_root root@167.179.65.195 \
  "systemctl restart webhook_bot_v2.service; sleep 2; systemctl is-active webhook_bot_v2.service"

# 期待値: active
```

**チェック項目:**
- [ ] サービスが `active` で返ってくる

### 2.3 本番環境ヘルス再確認

```bash
ssh -i ~/.ssh/id_ed25519_root root@167.179.65.195 \
  "curl -sS https://tanaka-bot.org/healthz | jq '.dry_run'"

# 期待値: false
```

**チェック項目:**
- [ ] `dry_run: false` が返ってくる

---

## フェーズ 3: 段階的テスト（本番モード移行後）

### 3.1 最小サイズ BUY テスト（0.001 BTC）

```bash
curl -X POST https://tanaka-bot.org/webhook \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Key: 3f112f8e67295f2134f4f4b00f10f780" \
  -d '{"symbol":"BTCUSDT","action":"buy","price":100000,"strategy":"phase3-test-buy","size":0.001,"order_type":"market"}' \
  | jq '.result'

# 期待値: code=00000
```

**チェック項目:**
- [ ] `code: 00000`
- [ ] `orderId` が返ってくる（注文成功）
- [ ] エラーメッセージなし

### 3.2 ポジション確認（BUY 後）

実施方法は 1.3 を参照。

**チェック項目:**
- [ ] `BTCUSDT` に `long` ポジション 0.001 が存在する

### 3.3 最小サイズ SELL テスト（0.001 BTC、ドテン検証含む）

```bash
curl -X POST https://tanaka-bot.org/webhook \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Key: 3f112f8e67295f2134f4f4b00f10f780" \
  -d '{"symbol":"BTCUSDT","action":"sell","price":100000,"strategy":"phase3-test-sell-doten","size":0.001,"order_type":"market"}' \
  | jq '.result | {code, doten}'

# 期待値: code=00000, doten=true
```

**チェック項目:**
- [ ] `code: 00000`
- [ ] `doten: true`（反転実行が起動）
- [ ] `close`, `open` ともに `code: 00000`

### 3.4 ポジション確認（SELL 後）

実施方法は 1.3 を参照。

**チェック項目:**
- [ ] `BTCUSDT` に `short` ポジション 0.001 が存在する（ドテンで反転）
- [ ] `long` ポジションが閉じられている

### 3.5 フラット化（テスト片付け）

```bash
ssh -i ~/.ssh/id_ed25519_root root@167.179.65.195 \
  "sudo -u linuxuser python3 - <<'PY'
import os, json, sys
from pathlib import Path
sys.path.insert(0, '/home/linuxuser')
from bot_v2.execution.bitget_client import BitgetClient
from bot_v2.execution.order_manager import close_position
for line in Path('/home/linuxuser/.bitget_env').read_text(encoding='utf-8').splitlines():
    if '=' in line and not line.strip().startswith('#'):
        k,v=line.split('=',1)
        os.environ[k.strip()] = v.strip()
client = BitgetClient()
resp = client.request('GET', '/api/v2/mix/position/all-position', {'productType':'USDT-FUTURES','marginCoin':'USDT'})
rows=[{'holdSide':p.get('holdSide'),'total':str(p.get('total'))} for p in (resp.get('data') or []) if p.get('symbol')=='BTCUSDT' and float(p.get('total') or 0)>0]
print('BEFORE=' + json.dumps(rows, ensure_ascii=False))
for r in rows:
    side = 'buy' if r['holdSide']=='long' else 'sell'
    res = close_position('BTCUSDT', side, r['total'])
    print('CLOSE=' + json.dumps(res, ensure_ascii=False))
resp2 = client.request('GET', '/api/v2/mix/position/all-position', {'productType':'USDT-FUTURES','marginCoin':'USDT'})
rows2=[p for p in (resp2.get('data') or []) if p.get('symbol')=='BTCUSDT' and float(p.get('total') or 0)>0]
print('AFTER=' + ('[]' if not rows2 else 'non-empty'))
PY"
```

**チェック項目:**
- [ ] `AFTER=[]`（全ポジションクローズ成功）

---

## フェーズ 4: 本番運用開始

### 4.1 サービス健全性最終確認

```bash
ssh -i ~/.ssh/id_ed25519_root root@167.179.65.195 \
  "curl -sS https://tanaka-bot.org/healthz | jq '{status, dry_run, recent_error_count}'"

# 期待値: status=ok, dry_run=false, recent_error_count=0
```

**チェック項目:**
- [ ] `status: ok`
- [ ] `dry_run: false`（本番モード確認）
- [ ] `recent_error_count: 0`

### 4.2 運用モニタリング開始

```bash
# リアルタイムログ監視
ssh -i ~/.ssh/id_ed25519_root root@167.179.65.195 \
  "journalctl -u webhook_bot_v2.service -f --no-pager"
```

**チェック項目:**
- [ ] ログが定期的に流れている（webhook 受信・処理）
- [ ] エラーが出ていない

### 4.3 日次レポート監視

```bash
ssh -i ~/.ssh/id_ed25519_root root@167.179.65.195 \
  "cat /home/linuxuser/bot_v2/data/phase45_daily_report_latest.md"
```

**チェック項目:**
- [ ] 毎日 00:00 UTC にレポートが更新される
- [ ] `action: hold` または `action: apply` が正しく判定されている

---

## 緊急時の復帰手順

### 異常検出時の復帰（DRY_RUN=true へ戻す）

本番中に予期しない取引が発生した場合：

```bash
ssh -i ~/.ssh/id_ed25519_root root@167.179.65.195 \
  "sudo -u linuxuser python3 - <<'PY'
from pathlib import Path
p=Path('/home/linuxuser/.bitget_env')
text=p.read_text(encoding='utf-8')
lines=[]
for line in text.splitlines():
    if line.startswith('DRY_RUN='):
        lines.append('DRY_RUN=true')
    else:
        lines.append(line)
p.write_text('\n'.join(lines)+'\n',encoding='utf-8')
print('DRY_RUN=true set (EMERGENCY RESTORE)')
PY
systemctl restart webhook_bot_v2.service
sleep 1
curl -sS https://tanaka-bot.org/healthz | jq '.dry_run'"
```

**結果確認:**
- [ ] `dry_run: true` が返ってくる
- [ ] サービスが `active` である

---

## サイン欄

| 項目 | 実施者 | 実施日時 | 備考 |
|------|--------|----------|------|
| フェーズ1 完了 |  |  |  |
| フェーズ2 完了 |  |  | DRY_RUN=false 切替 |
| フェーズ3 完了 |  |  | 最小サイズテスト・フラット化 |
| フェーズ4 確認 |  |  | 本番運用開始 |

---

**参考資料:**
- `/home/linuxuser/.bitget_env` - 環境変数ファイル
- `/home/linuxuser/bot_v2/data/phase45_daily_report_latest.md` - 日次レポート
- `https://tanaka-bot.org/healthz` - ヘルスチェックエンドポイント
- `journalctl -u webhook_bot_v2.service` - サービスログ
