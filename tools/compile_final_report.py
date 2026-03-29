import csv
import json
import os

reports_dir='bot_v2/tools/reports'
# read top5 summary
top5_path = os.path.join(reports_dir,'grid_top5_summary.csv')
sl_path = os.path.join(reports_dir,'sl_hit_rate_summary.csv')
final = {'top5':[], 'sl_summary':[]}
if os.path.isfile(top5_path):
    with open(top5_path,'r',encoding='utf-8') as f:
        r=csv.DictReader(f)
        for row in r:
            final['top5'].append(row)
if os.path.isfile(sl_path):
    with open(sl_path,'r',encoding='utf-8') as f:
        r=csv.DictReader(f)
        for row in r:
            final['sl_summary'].append(row)
out_json=os.path.join(reports_dir,'final_top5_sl_report.json')
with open(out_json,'w',encoding='utf-8') as of:
    json.dump(final, of, ensure_ascii=False, indent=2)
print('Wrote', out_json)
