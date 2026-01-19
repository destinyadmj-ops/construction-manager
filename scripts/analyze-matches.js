const fs = require('fs');
function norm(s){ if(!s) return ''; return s.toLowerCase().replace(/\s+/g,'').normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,''); }
const users = JSON.parse(fs.readFileSync('users.json','utf8')).users;
const sched = JSON.parse(fs.readFileSync('schedule.json','utf8'));
const cellNames = new Set();
const grid = sched.grid || {};
for(const userId of Object.keys(grid)){
  const days = grid[userId];
  for(const d of Object.keys(days)){
    const slot1 = days[d].slot1; const slot2 = days[d].slot2;
    if(slot1) cellNames.add(slot1.trim());
    if(slot2) cellNames.add(slot2.trim());
  }
}
const cellArr = Array.from(cellNames).filter(Boolean);
const ulist = users.map(u=>({id:u.id,name:u.name||'',norm: norm(u.name||'')}));
const report = [];
for(const c of cellArr){
  const cn = norm(c);
  const matches = ulist.filter(u=> u.norm && (u.norm === cn || u.norm.includes(cn) || cn.includes(u.norm)));
  report.push({cell:c,count:matches.length,matches:matches.map(m=>({id:m.id,name:m.name}))});
}
fs.writeFileSync('matches.json', JSON.stringify({cells:report,cellCount:cellArr.length,usersCount:ulist.length},null,2));
console.log('Wrote matches.json — cells:', cellArr.length, 'users:', ulist.length);
console.log('Top 20 cell name reports:');
report.slice(0,20).forEach(r=> console.log(r.cell,'=>',r.count));
