"""ログ転送ツール: logs/safe_json_remote.log を読み、中央ログ受け口へ送信する小さなバッチフォワーダ
使い方:
  python tools/log_forwarder.py --endpoint https://log-collector.example.com/ingest --batch 50
"""
import os, time, json, requests, argparse
from pathlib import Path

LOG_PATH = Path(__file__).parent.parent / 'logs' / 'safe_json_remote.log'
POS_PATH = Path(__file__).parent.parent / 'logs' / 'safe_json_forwarder.pos'

DEFAULT_ENDPOINT = os.getenv('SAFE_JSON_FORWARD_ENDPOINT')


def load_pos():
    try:
        return int(POS_PATH.read_text())
    except Exception:
        return 0


def save_pos(pos):
    POS_PATH.write_text(str(pos))


def forward(endpoint, batch_size=100):
    if not endpoint:
        raise RuntimeError('No endpoint provided')
    if not LOG_PATH.exists():
        print('No log file found')
        return
    pos = load_pos()
    with LOG_PATH.open('r', encoding='utf-8') as f:
        # skip to pos
        for _ in range(pos):
            if not f.readline():
                print('Reached EOF')
                return
        batch = []
        lines_sent = 0
        while True:
            line = f.readline()
            if not line:
                break
            pos += 1
            try:
                payload = json.loads(line)
            except Exception:
                payload = {'text': line}
            batch.append(payload)
            if len(batch) >= batch_size:
                try:
                    r = requests.post(endpoint, json=batch, timeout=5)
                    if r.status_code >= 200 and r.status_code < 300:
                        lines_sent += len(batch)
                        batch = []
                    else:
                        print('Failed to forward batch', r.status_code, r.text)
                        break
                except Exception as e:
                    print('Exception forwarding:', e)
                    break
        # send remaining
        if batch:
            try:
                r = requests.post(endpoint, json=batch, timeout=5)
                if r.status_code >= 200 and r.status_code < 300:
                    lines_sent += len(batch)
                else:
                    print('Failed to forward final batch', r.status_code, r.text)
            except Exception as e:
                print('Exception forwarding final batch:', e)
        save_pos(pos - (len(batch) if batch else 0))
        print(f'Forwarded {lines_sent} lines, new pos={pos}')


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--endpoint', default=DEFAULT_ENDPOINT)
    p.add_argument('--batch', type=int, default=50)
    args = p.parse_args()
    forward(args.endpoint, batch_size=args.batch)
