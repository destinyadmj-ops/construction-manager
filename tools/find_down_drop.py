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
found=False
for i in range(0, max(0,N-60)):
    entry=prices[i]
    future=prices[i+1:i+61]
    if not future: continue
    mn=min(future)
    if mn<= entry*0.80:
        print(i, entry, mn)
        found=True
        break
if not found:
    print('no candidate found')
