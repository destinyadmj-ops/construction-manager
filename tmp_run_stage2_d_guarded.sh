#!/usr/bin/env bash
set -e
pkill -f stage2_d_guarded_tune.py >/dev/null 2>&1 || true
nohup python3 /home/linuxuser/stage2_d_guarded_tune.py >/home/linuxuser/stage2_d_guarded_tune.log 2>&1 &
echo PID:$!
sleep 2
pgrep -af stage2_d_guarded_tune.py | head -n 2 || true
if [ -f /home/linuxuser/stage2_d_guarded_tune_report.json ]; then
  python3 - <<'PY'
import json
p='/home/linuxuser/stage2_d_guarded_tune_report.json'
d=json.load(open(p,'r',encoding='utf-8'))
print(json.dumps({'checks':d.get('checks'),'finished':d.get('finished'),'applied':d.get('applied'),'last':(d.get('history_tail') or [])[-1:]}, ensure_ascii=False))
PY
else
  echo REPORT_MISSING
fi
