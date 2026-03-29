import re,sys,os
p = os.path.join('logs','indicators_monitor.log')
try:
    with open(p,'r',encoding='utf-8',errors='replace') as f:
        lines = f.read().splitlines()
except FileNotFoundError:
    print("<<LOG_EMPTY_OR_MISSING>>")
    sys.exit(0)

tail = lines[-500:]
if not tail:
    print("<<LOG_EMPTY_OR_MISSING>>")
else:
    print("\n".join(tail))

print("\n---ANOMALIES---")
pat = re.compile(r'429|5\d{2}|ERROR|Exception')
found = False
for l in tail:
    if pat.search(l):
        print(l)
        found = True
if not found:
    print("<<NO_ANOMALIES_FOUND>>")
