# tmp_watch_link_status.py 実用例

## 1. VPS への配備

```
scp -i ~/.ssh/id_ed25519_root tmp_watch_link_status.py root@167.179.65.195:/home/linuxuser/tmp_watch_link_status.py
```

## 2. 実運用コマンド例

### 未リンクのみ監視
```
python3 /home/linuxuser/tmp_watch_link_status.py --only-unlinked --checks 12 --interval 5
```

### reconcile 行のみ監視
```
python3 /home/linuxuser/tmp_watch_link_status.py --only-reconcile --checks 12 --interval 5
```

### BTCUSDT,ETHUSDT の未リンクのみ
```
python3 /home/linuxuser/tmp_watch_link_status.py --symbols BTCUSDT,ETHUSDT --only-unlinked --checks 12 --interval 5
```

### 未リンク+reconcile 両方
```
python3 /home/linuxuser/tmp_watch_link_status.py --only-unlinked --only-reconcile --checks 12 --interval 5
```

## 3. 出力ファイル保存例（--output-path 追加後）
```
python3 /home/linuxuser/tmp_watch_link_status.py --only-unlinked --output-path /home/linuxuser/unlinked_rows.json
```
