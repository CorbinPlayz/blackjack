import fs from 'fs';
export function strip(src){
  let out='', i=0, n=src.length;
  while(i<n){
    const c=src[i], d=src[i+1];
    if(c==="'"||c==='"'){ let j=i+1; while(j<n&&src[j]!==c){ if(src[j]==='\\') j++; j++; } out+=src.slice(i,j+1); i=j+1; continue; }
    if(c==='/'&&d==='/'){ while(i<n&&src[i]!=='\n') i++; continue; }
    if(c==='/'&&d==='*'){ i=src.indexOf('*/',i+2)+2; continue; }
    out+=c; i++;
  }
  return out.split('\n').map(l=>l.replace(/\s+$/,'')).filter(l=>l.trim()!=='').join('\n')+'\n';
}
if(process.argv[2]){ const s=strip(fs.readFileSync(process.argv[2],'utf8')); fs.writeFileSync(process.argv[3],s); console.log(s.length); }
