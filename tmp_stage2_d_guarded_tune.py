import json
import os
import time
import urllib.request
from pathlib import Path

BASE='http://127.0.0.1:5001'
ENV_PATH=Path('/home/linuxuser/.bitget_env')
REPORT_PATH=Path('/home/linuxuser/stage2_d_guarded_tune_report.json')
MAX_CHECKS=18
INTERVAL_SEC=300

CONDITION={'min_trades':8,'max_win_rate':0.40,'max_avg_roi':0.0}
TARGET={
    'ALERT_D_ENTRY_STOP_LOSS_PCT':'0.07',
    'ALERT_D_ROI_STOP_LOCK_LEVELS':'0.10,0.22,0.40',
}


def fetch_bucket():
    req=urllib.request.Request(f'{BASE}/monitor', data=b'', method='POST')
    with urllib.request.urlopen(req, timeout=30) as r:
        o=json.loads(r.read().decode('utf-8'))
    rows=(o.get('outcome_stats') or {}).get('by_bucket') or []
    for row in rows:
        if str(row.get('alert_name'))=='alert_d' and str(row.get('action'))=='lifecycle_close':
            return row
    return None


def load_env_map(path):
    kv={}
    if path.exists():
        for line in path.read_text(encoding='utf-8', errors='ignore').splitlines():
            s=line.strip()
            if not s or s.startswith('#') or '=' not in s:
                continue
            k,v=s.split('=',1)
            kv[k.strip()]=v
    return kv


def save_env_map(path, kv):
    path.write_text('\n'.join(f'{k}={kv[k]}' for k in sorted(kv.keys()))+'\n', encoding='utf-8')


def restart_service():
    os.system('systemctl restart webhook_bot_v2.service')
    return os.system('systemctl is-active --quiet webhook_bot_v2.service') == 0


def write_report(history, applied=False, applied_at=None, done=False):
    report={
        'started_at': history[0]['ts'] if history else int(time.time()),
        'updated_at': int(time.time()),
        'finished': bool(done),
        'checks': len(history),
        'max_checks': MAX_CHECKS,
        'interval_sec': INTERVAL_SEC,
        'condition': CONDITION,
        'target': TARGET,
        'applied': bool(applied),
        'applied_at': applied_at,
        'history_tail': history[-10:],
    }
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


history=[]
applied=False
applied_at=None
for i in range(MAX_CHECKS):
    now=int(time.time())
    row=None
    err=None
    try:
        row=fetch_bucket()
    except Exception as ex:
        err=str(ex)

    point={'ts':now,'iter':i+1,'row':row,'error':err}
    history.append(point)

    if row:
        trades=int(row.get('trades') or 0)
        win_rate=float(row.get('win_rate') or 0.0)
        avg_roi=float(row.get('avg_roi') or 0.0)
        if trades >= CONDITION['min_trades'] and win_rate <= CONDITION['max_win_rate'] and avg_roi <= CONDITION['max_avg_roi']:
            kv=load_env_map(ENV_PATH)
            before={k:kv.get(k) for k in TARGET.keys()}
            kv.update(TARGET)
            save_env_map(ENV_PATH, kv)
            ok=restart_service()
            applied=True
            applied_at=now
            point['applied']=True
            point['before_values']=before
            point['applied_values']=TARGET
            point['service_active']=ok
            write_report(history, applied=applied, applied_at=applied_at, done=True)
            break

    write_report(history, applied=applied, applied_at=applied_at, done=False)

    if i < MAX_CHECKS-1:
        time.sleep(INTERVAL_SEC)

if not applied:
    write_report(history, applied=False, applied_at=None, done=True)

print('WROTE', str(REPORT_PATH), 'applied=', applied)
