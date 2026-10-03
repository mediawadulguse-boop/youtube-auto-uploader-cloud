// Conservative source-grounded research helpers. No external request or AI.
export function enrichResearch(issue,references,claims){
 const chronology=references.filter(s=>Number.isFinite(Date.parse(s.publishedAt))).sort((a,b)=>Date.parse(a.publishedAt)-Date.parse(b.publishedAt)||a.number-b.number).slice(0,30).map(s=>({at:s.publishedAt,text:s.title,sourceNumbers:[s.number],kind:'publication'}));
 const actors=new Map(),importantNumbers=[];
 for(const claim of claims){
  if(claim.headlineOnly)continue;
  for(const value of claim.numbers)if(importantNumbers.length<20)importantNumbers.push({value,text:claim.text,sourceNumbers:claim.sourceNumbers,attributed:claim.attributed});
  // Only explicit organization prefixes and names next to attribution verbs.
  const patterns=[/\b(?:PT|CV|Kementerian|Dinas|Universitas|Bank)\s+[A-Z][\p{L}-]+(?:\s+[A-Z][\p{L}-]+){0,3}/gu,/\b[A-Z][\p{L}-]+(?:\s+[A-Z][\p{L}-]+){0,2}(?=\s+(?:mengatakan|menyebut|menegaskan|menyatakan|menilai)\b)/gu];
  for(const pattern of patterns)for(const match of claim.text.matchAll(pattern)){
   const name=match[0];if(/^(?:Menurut|Pemerintah|Warga|Pengamat|Menteri|Bupati|Gubernur|Presiden)$/.test(name))continue;
   const key=name.toLocaleLowerCase('id'),old=actors.get(key);
   if(old)old.sourceNumbers=[...new Set([...old.sourceNumbers,...claim.sourceNumbers])];
   else if(actors.size<20)actors.set(key,{name,text:claim.text,sourceNumbers:[...claim.sourceNumbers]});
  }
 }
 const differences=[];
 const key=s=>s.toLowerCase().replace(/[.!?,]/g,'').replace(/\b(?:tidak|belum)\s+/g,'').replace(/\s+/g,' ').trim();
 const material=claims.filter(c=>!c.headlineOnly).slice(0,120);
 for(let a=0;a<material.length;a++)for(let b=a+1;b<material.length;b++){
  const left=material[a],right=material[b];
  if(differences.length<4&&/\b(?:tidak|belum)\b/i.test(left.text)!==/\b(?:tidak|belum)\b/i.test(right.text)&&key(left.text)===key(right.text))differences.push({left,right,note:'Pernyataan berbeda pada konteks literal yang sama. Periksa waktu dan narasumber; bukan penentuan kebenaran.'});
 }
 const researchGaps=[];
 if(!issue.eventDate)researchGaps.push('Pastikan tanggal peristiwa; kronologi ini memakai tanggal publikasi, bukan tanggal kejadian.');
 if(references.some(s=>!s.publishedAt))researchGaps.push('Lengkapi tanggal publikasi sumber yang belum bertanggal.');
 if(references.some(s=>s.coverage==='headline'||s.coverage==='snippet'))researchGaps.push('Baca artikel lengkap atau impor transkrip untuk menambah konteks cuplikan.');
 if(references.some(s=>s.verification!=='verified'))researchGaps.push('Periksa klaim pada sumber primer dan tandai verifikasi secara manual.');
 if(new Set(references.filter(s=>!s.repost).map(s=>s.publisher)).size<2)researchGaps.push('Cari pembanding dari penerbit atau akun lain.');
 if(differences.length)researchGaps.push('Telusuri perbedaan pernyataan sebelum menyusun kesimpulan.');
 if(issue.groupingReview)researchGaps.push('Tinjau batas kelompok isu yang memiliki kecocokan ambigu.');
 return {chronology,actors:[...actors.values()],importantNumbers,differences,researchGaps,eventDate:issue.eventDate||null,chronologyNote:'Urutan publikasi sumber. Nama diekstrak dari pola eksplisit; peran dan identitas belum diverifikasi.'};
}
