"""軽量受信サーバ: SAFE_JSON_LOG_ENDPOINT 用の受け口（開発用）
受信した JSON を logs/safe_json_remote.log に追記する
実行: python tools/safe_json_receiver.py
"""
from flask import Flask, request, jsonify
import os, json

app = Flask(__name__)
LOG_PATH = os.path.join(os.path.dirname(__file__), '..', 'logs', 'safe_json_remote.log')
os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)

@app.route('/', methods=['POST'])
def receive():
    # 簡易トークン認証（オプション）。環境変数 SAFE_JSON_RECEIVER_TOKEN を設定すると有効化。
    token = os.getenv('SAFE_JSON_RECEIVER_TOKEN')
    if token:
        recv_token = request.headers.get('X-Auth-Token') or request.args.get('token')
        if not recv_token or recv_token != token:
            return jsonify({'status': 'unauthorized'}), 401
    # オプション: HMAC 検証 (SAFE_JSON_RECEIVER_HMAC_KEY)
    hmac_key = os.getenv('SAFE_JSON_RECEIVER_HMAC_KEY')
    if hmac_key:
        try:
            import hmac, hashlib
            body = request.get_data()
            sig_header = request.headers.get('X-Hub-Signature-256')
            if not sig_header or not sig_header.startswith('sha256='):
                return jsonify({'status': 'bad_signature'}), 401
            sig = sig_header.split('=')[1]
            mac = hmac.new(hmac_key.encode('utf-8'), body, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(mac, sig):
                return jsonify({'status': 'bad_signature'}), 401
        except Exception:
            return jsonify({'status': 'bad_signature_error'}), 401
    try:
        payload = request.get_json(force=True)
    except Exception:
        payload = { 'text': request.get_data(as_text=True) }
    with open(LOG_PATH, 'a', encoding='utf-8') as f:
        f.write(json.dumps(payload, ensure_ascii=False) + '\n')
    return jsonify({'status': 'ok'})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('SAFE_JSON_RECEIVER_PORT', '8000')))
