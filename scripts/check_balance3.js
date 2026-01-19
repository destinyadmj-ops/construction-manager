const fs = require('fs');
const s = fs.readFileSync('app/week-hub.tsx','utf8');
let brace = 0; let line=1; let inSingle=false,inDouble=false,inBack=false,inLineComment=false,inBlockComment=false;
let lastZeroLine=0;
for (let i=0;i<s.length;i++){ const ch=s[i]; const next=s[i+1]; if (ch==='\n'){ line++; inLineComment=false; }
 if (inLineComment){ continue; }
 if (inBlockComment){ if (ch==='*' && next==='/' ){ inBlockComment=false; i++; continue; } else continue; }
 if (!inSingle && !inDouble && !inBack){ if (ch==='/' && next==='/' ){ inLineComment=true; i++; continue; } if (ch==='/' && next==='*'){ inBlockComment=true; i++; continue; } }
 if (!inDouble && !inBack && ch==="'") { inSingle=!inSingle; continue; }
 if (!inSingle && !inBack && ch==='"') { inDouble=!inDouble; continue; }
 if (!inSingle && !inDouble && ch==='`') { inBack=!inBack; continue; }
 if (inSingle||inDouble||inBack) continue;
 if (ch==='{') brace++; if (ch==='}') brace--; if (brace<0){ console.log('Unmatched } at line',line); process.exit(0); }
 if (brace===0) lastZeroLine=line;
}
console.log('final brace', brace, 'last line where brace==0 is', lastZeroLine);
