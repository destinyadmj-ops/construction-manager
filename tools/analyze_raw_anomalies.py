import csv
import json
from pathlib import Path

INPUT='bot_v2/tools/data/btc_highvol.csv'
OUT='bot_v2/tools/reports/btc_highvol_anomaly_report.json'

rows=[]
with open(INPUT,'r',encoding='utf-8') as f:
    r=csv.DictReader(f)
    for row in r:
        try:
            p=float(row.get('price') or 0.0)
        except:
            p=0.0
        rows.append(p)

N=len(rows)
neg_count=sum(1 for p in rows if p<0)
zero_count=sum(1 for p in rows if p==0)
huge_price_count=sum(1 for p in rows if abs(p)>=1e9)

# detect large per-step returns and sign flips
large_jumps=[]
sign_flips=[]
prev=rows[0] if N>0 else 0.0
for i in range(1,N):
    p=rows[i]
    if prev==0:
        ret=None
    else:
        try:
            ret=(p-prev)/prev
        except Exception:
            ret=None
    if ret is not None and abs(ret)>0.5:
        large_jumps.append({'idx':i,'price':p,'prev':prev,'ret':ret})
    if prev!=0 and p!=0 and (p>0) != (prev>0):
        sign_flips.append({'idx':i,'price':p,'prev':prev})
    prev=p

report={
    'rows': N,
    'negative_prices': neg_count,
    'zero_prices': zero_count,
    'huge_price_count_>=1e9': huge_price_count,
    'large_jumps_count_abs_ret>50%': len(large_jumps),
    'sign_flips_count': len(sign_flips),
    'sample_large_jumps': large_jumps[:10],
    'sample_sign_flips': sign_flips[:10]
}

Path(OUT).parent.mkdir(parents=True,exist_ok=True)
with open(OUT,'w',encoding='utf-8') as fo:
    json.dump(report,fo,ensure_ascii=False,indent=2)
print('Wrote',OUT)
