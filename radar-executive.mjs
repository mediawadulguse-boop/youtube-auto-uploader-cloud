import {buildIssueReport} from './radar-engine.mjs';
import {publisherKey} from './radar-methodology.mjs';
import {compareEditorial} from './radar-editorial.mjs';

export const EXECUTIVE_VERSION=3;
const stamp=value=>Date.parse(value||'');
const sortIssues=compareEditorial;
const uniqueSources=items=>[...new Map(items.flatMap(i=>i.sources||[]).map(s=>[s.url,s])).values()];

// Decision support from stored evidence only. No provider, fetch or content mutations.
export function buildExecutiveSummary(items,{now=Date.now(),scope='Radar',partial=false,fallback=false,previousItems=null}={}){
 const groups=items.filter(i=>i.status!=='ignored'&&i.stats?.relevant!==false).toSorted(sortIssues),sources=uniqueSources(groups);
 const candidates=groups.filter(i=>i.status!=='discussed');
 const priorities=candidates.slice(0,3).map(issue=>{
  const report=issue.report||buildIssueReport(issue),claims=report.summary.filter(c=>!c.headlineOnly);
  const evidence=(issue.editorial?(issue.editorial.evidence?[issue.editorial.evidence]:[]):claims.slice(0,2)).map(c=>({text:c.text,attributed:!!c.attributed,references:(c.references||c.sourceNumbers.map(n=>report.sources.find(s=>s.number===n)).filter(Boolean)).map(s=>({number:s.number,title:s.title,url:s.url,publisher:s.publisher}))}));
  const gaps=[];
  if(issue.groupingReview)gaps.push('Tinjau batas kelompok sebelum memakai gabungan sumber.');
  const conflicts=(report.conflicts?.length||0)+(report.differences?.length||0);
  if(conflicts)gaps.push('Bandingkan angka atau pernyataan yang berbeda; belum ada penentuan kebenaran.');
  if(!evidence.length)gaps.push('Belum ada klaim faktual relevan untuk titik awal; lengkapi artikel atau transkrip, termasuk jika bahan masih judul saja.');
  else if(report.sources.some(s=>!s.hasArticle&&!s.hasTranscript))gaps.push('Sebagian bahan masih cuplikan atau deskripsi; periksa konteks lengkap.');
  if(!report.sources.some(s=>s.verification==='verified'))gaps.push('Belum ada sumber yang ditandai terverifikasi oleh editor.');
  const publishers=new Set(report.sources.filter(s=>!s.repost).map(publisherKey).filter(Boolean)).size;
  if(publishers<2)gaps.push('Cari sumber pembanding dari penerbit atau akun lain.');
  const action=issue.groupingReview||conflicts?'Periksa perbedaan':!evidence.length||gaps.length?'Lengkapi riset':'Susun kerangka bersumber';
  const trend=issue.stats?.trend;
  const change=trend?.state==='rising'?`Penerbit aktif bertambah ${trend.deltaPublishers24h} sejak pengamatan ${trend.since}.`:trend?.state==='falling'?`Penerbit aktif berkurang ${Math.abs(trend.deltaPublishers24h)} sejak pengamatan ${trend.since}.`:'Perubahan liputan belum menunjukkan kenaikan atau penurunan yang dapat dibandingkan.';
  if(issue.editorial)gaps.push(...issue.editorial.gaps.filter(g=>!gaps.includes(g)));
  return {id:issue.id,title:issue.title,score:issue.editorial?.score??issue.stats?.score??0,momentum:issue.editorial?.momentum?.score??issue.stats?.score??0,reason:issue.editorial?.reasons.join(' ')||issue.stats?.reason||'Prioritas mengikuti peringkat liputan tersimpan.',angle:issue.editorial?.angle||'',readiness:issue.editorial?.readiness?.label||action,change,evidence,gaps,action:issue.editorial?.readiness?.label||action,sourceCount:report.sources.length,publishers};
 });
 let comparison=null;
 if(previousItems){
  const previous=previousItems.filter(i=>i.status!=='ignored'&&i.stats?.relevant!==false),ids=new Set(previous.map(i=>i.id));
  comparison={deltaGroups:groups.length-previous.length,deltaSources:sources.length-uniqueSources(previous).length,newCoverageTitles:groups.filter(i=>!ids.has(i.id)).slice(0,3).map(i=>i.title),continuingGroups:groups.filter(i=>ids.has(i.id)).length,note:'Perbandingan liputan bertanggal yang tersimpan. Tidak membuktikan isu baru terjadi atau seluruh liputan internet.'};
 }
 const risks=[];
 if(partial)risks.push('Periode masih berjalan; jumlah dan prioritas dapat berubah.');
 if(fallback)risks.push('Tidak ada bahan dalam periode terpilih. Bahan di luar periode ditampilkan sebagai referensi.');
 if(sources.some(s=>s.platform==='YouTube'&&!s.transcript))risks.push('Video tanpa transkrip hanya menyumbang judul/deskripsi.');
 if(sources.some(s=>!Number.isFinite(stamp(s.publishedAt))))risks.push('Sebagian sumber belum memiliki tanggal publikasi.');
 if(groups.some(i=>i.groupingReview))risks.push('Ada kelompok yang memerlukan tinjauan pengelompokan.');
 const overview=groups.length?`${scope}: ${groups.length} kelompok isu dari ${sources.length} tautan sumber. ${priorities.length?`${priorities.length} prioritas riset dipilih dari ${groups.some(i=>i.editorial)?'penilaian editorial':'peringkat liputan'}.`:'Semua isu dalam cakupan sudah dibahas; belum ada prioritas riset baru.'}`:'Belum ada bahan yang sesuai dalam cakupan ini.';
 const nextStep=priorities.length?`Mulai dari “${priorities[0].title}”: ${priorities[0].action.toLocaleLowerCase('id-ID')}.`:'Sinkronkan Radar atau sesuaikan topik dan periode untuk menambah bahan.';
 const note='Ringkasan engine tanpa AI. Potensi editorial, momentum dan kesiapan bahan dinilai terpisah, bukan prediksi viral. Kutipan adalah klaim yang dilaporkan sumber; tanda verifikasi berasal dari editor. Alasan sebab-akibat dan kesimpulan editorial tetap perlu diperiksa.';
 const text=['RINGKASAN EKSEKUTIF',overview,...(comparison?[`PERUBAHAN LIPUTAN\n${comparison.deltaGroups>=0?'+':''}${comparison.deltaGroups} kelompok; ${comparison.deltaSources>=0?'+':''}${comparison.deltaSources} tautan sumber. ${comparison.continuingGroups} kelompok juga memiliki liputan pada periode pembanding.`,...comparison.newCoverageTitles.map(t=>'Tanpa liputan tersimpan pada periode pembanding: '+t),comparison.note]:[]),'PRIORITAS RISET',...priorities.map((p,n)=>[`${n+1}. ${p.title}`,`Potensi editorial: ${p.score}/100 · Momentum: ${p.momentum}/100 · ${p.readiness}`,...(p.angle?['Angle riset: '+p.angle]:[]),p.reason,p.change,...p.evidence.flatMap(e=>['Klaim sumber: '+e.text,...e.references.map(s=>`[${s.number}] ${s.publisher} — ${s.title}\n${s.url}`)]),...p.gaps.map(g=>'Perlu diperiksa: '+g),'Langkah: '+p.action].join('\n')),'LANGKAH BERIKUTNYA',nextStep,...(risks.length?['CATATAN CAKUPAN',...risks]:[]),note].join('\n\n');
 return {version:EXECUTIVE_VERSION,usesAI:false,generatedAt:new Date(now).toISOString(),scope,partial,fallback,overview,groups:groups.length,sourceCount:sources.length,priorities,comparison,risks,nextStep,note,text};
}

export function buildRadarExecutive(data,{now=Date.now(),period=72,q='',topic='',status='',platform=''}={}){
 if(![24,72,168].includes(Number(period)))throw Object.assign(new Error('Pilih periode 24 jam, 3 hari atau 7 hari.'),{status:400});
 if(topic&&!data.topics.some(t=>t.id===topic))throw Object.assign(new Error('Topik ringkasan tidak ditemukan.'),{status:404});
 if(status&&!['new','saved','ignored','discussed'].includes(status))throw Object.assign(new Error('Status Radar tidak valid.'),{status:400});
 if(platform&&!['YouTube','Berita / Web'].includes(platform))throw Object.assign(new Error('Platform Radar tidak valid.'),{status:400});
 const search=q.trim().toLocaleLowerCase('id-ID');
 const all=data.issues.filter(i=>!['ignored','discussed'].includes(i.status)&&i.stats?.relevant!==false&&(!topic||i.topicIds.includes(topic))&&(!status||i.status===status)&&(!platform||i.sources.some(s=>s.platform===platform))&&[i.title,...i.sources.flatMap(s=>[s.title,s.publisher,s.excerpt||''])].join(' ').toLocaleLowerCase('id-ID').includes(search));
 const recent=all.filter(i=>{const age=now-stamp(i.stats?.latestPublishedAt);return Number.isFinite(age)&&age>=0&&age<Number(period)*3600000;}),fallback=!recent.length&&all.length>0;
 return buildExecutiveSummary(fallback?all:recent,{now,scope:`Radar ${period} jam${topic||search||status||platform?' · sesuai filter':''}`,fallback});
}
