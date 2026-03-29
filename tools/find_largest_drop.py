import csv
path='bot_v2/tools/data/btc_highvol_sanitized.csv'
prices=[]
with open(path,'r',encoding='utf-8') as f:
    r=csv.DictReader(f)
    for row in r:
        try:
            prices.append(float(row.get('price') or 0.0))
        except:
            prices.append(0.0)
N=len(prices)
best=(None,0.0,0.0)
for i in range(0, max(0,N-60)):
    entry=prices[i]
    future=prices[i+1:i+61]
    if not future: continue
    mn=min(future)
    drop=(entry-mn)/entry if entry>0 else 0.0
    if drop>best[1]:
        best=(i,drop,mn)
print('N',N,'best_index',best[0],'drop_pct',best[1],'min_future',best[2])
