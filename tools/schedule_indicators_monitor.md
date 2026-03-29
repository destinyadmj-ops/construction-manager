Scheduling `bot_v2.ops.indicators_monitor` (Windows + Linux examples)

This document shows how to run the indicators heartbeat check on a schedule and send Slack alerts when stale.

1) Quick test (manual)

```powershell
# from repository root
# use project venv python when available
.\.venv\Scripts\python.exe -m bot_v2.ops.indicators_monitor --threshold 120
```

2) Windows: Scheduled Task (recommended for Windows host)

- Save `tools\run_indicators_monitor.ps1` into the repo (already provided).
- Create a scheduled task using `schtasks` (run as admin / appropriate user):

```powershell
# Run every 2 minutes example (or adjust as needed)
schtasks /Create /SC MINUTE /MO 2 /TN "IndicatorsMonitor" /TR "powershell -ExecutionPolicy Bypass -File C:\path\to\trading-bot\tools\run_indicators_monitor.ps1 -threshold 120" /F
```

Notes:
- Replace `C:\path\to\trading-bot` with your repo path.
- If you want to pass a Slack webhook: add `-webhook 'https://hooks.slack.com/services/...'` to the `-File` invocation.

3) Linux: systemd service + timer (example)

- Create ` /etc/systemd/system/indicators-monitor.service`:

```ini
[Unit]
Description=Indicators heartbeat monitor

[Service]
Type=oneshot
WorkingDirectory=/srv/trading-bot
ExecStart=/srv/trading-bot/.venv/bin/python -m bot_v2.ops.indicators_monitor --threshold 120
User=botuser
Group=botuser
Environment=PYTHONPATH=/srv/trading-bot

```

- Create ` /etc/systemd/system/indicators-monitor.timer`:

```ini
[Unit]
Description=Run indicators-monitor every 2 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
```

Then enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now indicators-monitor.timer
```

4) Cron alternative (simple)

```cron
# run every 2 minutes
*/2 * * * * /srv/trading-bot/.venv/bin/python -m bot_v2.ops.indicators_monitor --threshold 120 >> /var/log/indicators_monitor.log 2>&1
```

5) Slack Webhook

- Set `SLACK_WEBHOOK_URL` in the system environment or pass `--webhook` to the script.

6) Monitoring and alerts

- Task should run every 1–5 minutes depending on sensitivity.
- Adjust `--threshold` to your tolerance (currently 120s).
