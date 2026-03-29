import json
import time
import urllib.request
import subprocess
from pathlib import Path

BASE_URL = 'http://127.0.0.1:5001'
ENV_PATH = Path('/home/linuxuser/.bitget_env')
ENV_SYNC_PATH = Path('/home/linuxuser/.env')
REPORT_PATH = Path('/home/linuxuser/stage2_tune_report.json')

CHECKS = 40
INTERVAL_SECONDS = 60
MIN_TRADES = 5
DELTA = 0.01

ALERTS = ['alert_a', 'alert_b', 'alert_c', 'alert_d']
SCORE_KEYS = {
    'alert_a': 'DOTEN_MIN_SCORE_ALERT_A',
    'alert_b': 'DOTEN_MIN_SCORE_ALERT_B',
    'alert_c': 'DOTEN_MIN_SCORE_ALERT_C',
    'alert_d': 'DOTEN_MIN_SCORE_ALERT_D',
}
CONF_KEYS = {
    'alert_a': 'DOTEN_MIN_CONFIDENCE_ALERT_A',
    'alert_b': 'DOTEN_MIN_CONFIDENCE_ALERT_B',
    'alert_c': 'DOTEN_MIN_CONFIDENCE_ALERT_C',
    'alert_d': 'DOTEN_MIN_CONFIDENCE_ALERT_D',
}


def fetch_monitor():
    req = urllib.request.Request(BASE_URL + '/monitor', data=b'', method='POST')
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode('utf-8'))


def parse_env(path: Path):
    rows = path.read_text(encoding='utf-8').splitlines()
    parsed = {}
    for row in rows:
        line = row.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        parsed[k] = v
    return rows, parsed


def update_env(rows, updates):
    out = []
    touched = set()
    for row in rows:
        if '=' in row and not row.strip().startswith('#'):
            key = row.split('=', 1)[0].strip()
            if key in updates:
                out.append(f'{key}={updates[key]}')
                touched.add(key)
                continue
        out.append(row)
    for k, v in updates.items():
        if k not in touched:
            out.append(f'{k}={v}')
    return out


def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def main():
    snapshots = []
    latest_buckets = []

    for i in range(CHECKS):
        try:
            o = fetch_monitor()
            os = o.get('outcome_stats') or {}
            buckets = os.get('by_bucket') or []
            hints = os.get('optimization_hints') or []
            snapshots.append({
                'ts': int(time.time()),
                'status': o.get('status'),
                'skipped': o.get('skipped'),
                'guard': o.get('guard'),
                'bucket_count': len(buckets),
                'hint_count': len(hints),
            })
            if buckets:
                latest_buckets = buckets
        except Exception as exc:
            snapshots.append({'ts': int(time.time()), 'error': str(exc)})

        if i < CHECKS - 1:
            time.sleep(INTERVAL_SECONDS)

    report = {
        'started_at': snapshots[0]['ts'] if snapshots else int(time.time()),
        'finished_at': int(time.time()),
        'checks': CHECKS,
        'interval_seconds': INTERVAL_SECONDS,
        'snapshots': snapshots,
        'latest_bucket_count': len(latest_buckets),
        'status': 'ok',
    }

    if not latest_buckets:
        report['status'] = 'no_data'
        REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        return

    agg = {a: {'trades': 0, 'wins': 0, 'roi_sum': 0.0} for a in ALERTS}
    for row in latest_buckets:
        alert = str(row.get('alert_name') or '').strip().lower()
        if alert not in agg:
            continue
        agg[alert]['trades'] += int(row.get('trades') or 0)
        agg[alert]['wins'] += int(row.get('wins') or 0)
        agg[alert]['roi_sum'] += float(row.get('roi_sum') or 0.0)

    _, env_map = parse_env(ENV_PATH)
    updates = {}
    tuning_summary = {}

    for alert in ALERTS:
        trades = agg[alert]['trades']
        wins = agg[alert]['wins']
        roi_sum = agg[alert]['roi_sum']
        win_rate = (wins / trades) if trades > 0 else 0.0
        avg_roi = (roi_sum / trades) if trades > 0 else 0.0

        score_key = SCORE_KEYS[alert]
        conf_key = CONF_KEYS[alert]
        score_now = float(env_map.get(score_key, '0') or 0.0)
        conf_now = float(env_map.get(conf_key, '0') or 0.0)

        score_delta = 0.0
        conf_delta = 0.0
        reason = 'hold'

        if trades >= MIN_TRADES:
            if win_rate < 0.48:
                score_delta = DELTA
                conf_delta = DELTA
                reason = 'tighten'
            elif win_rate > 0.58 and avg_roi > 0:
                score_delta = -DELTA
                conf_delta = -DELTA
                reason = 'relax'

        score_new = round(clamp(score_now + score_delta, 0.0, 1.0), 2)
        conf_new = round(clamp(conf_now + conf_delta, 0.0, 1.0), 2)

        tuning_summary[alert] = {
            'trades': trades,
            'wins': wins,
            'win_rate': round(win_rate, 4),
            'avg_roi': round(avg_roi, 6),
            'reason': reason,
            'score_now': score_now,
            'score_new': score_new,
            'confidence_now': conf_now,
            'confidence_new': conf_new,
        }

        if score_new != score_now:
            updates[score_key] = f'{score_new:.2f}'
        if conf_new != conf_now:
            updates[conf_key] = f'{conf_new:.2f}'

    report['tuning_summary'] = tuning_summary
    report['updates'] = updates

    if updates:
        rows, _ = parse_env(ENV_PATH)
        new_rows = update_env(rows, updates)
        ENV_PATH.write_text('\n'.join(new_rows) + '\n', encoding='utf-8')
        ENV_SYNC_PATH.write_text('\n'.join(new_rows) + '\n', encoding='utf-8')

        restart = subprocess.run(['systemctl', 'restart', 'webhook_bot_v2.service'], capture_output=True, text=True)
        active = subprocess.run(['systemctl', 'is-active', 'webhook_bot_v2.service'], capture_output=True, text=True)
        report['deploy'] = {
            'restart_rc': restart.returncode,
            'restart_stdout': restart.stdout,
            'restart_stderr': restart.stderr,
            'active_rc': active.returncode,
            'active_stdout': active.stdout.strip(),
            'active_stderr': active.stderr,
        }
        report['status'] = 'applied'
    else:
        report['status'] = 'no_change'

    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
