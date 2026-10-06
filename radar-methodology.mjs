const HOUR=3600000;
export const RADAR_METHOD={version:5,displayLimit:10,threshold:65,minRating:4,windowHours:72,minPublishers:3,minPublishers24h:2,
  weights:{coverage:40,activity:30,recency:20,breadth:10},
  description:'Judul atau cuplikan isi serupa dikelompokkan dengan penjagaan peristiwa dan waktu. Radar menampilkan 10 isu dengan skor tertinggi tanpa syarat minimal rating. Rating adalah indikator liputan terpantau, bukan ukuran kebenaran atau viralitas.'};
const STOP=new Set('di ia para namun jika karena terhadap agar masih lebih terus seperti yang dan atau dengan untuk dari ke pada oleh dalam ini itu tersebut akan sudah telah juga sebagai adalah sebuah saat tentang jadi menjadi setelah sebelum serta atas hingga lalu hari terbaru update breaking news video foto'.split(' '));
const COMMON=new Set('pemerintah pemkab kebijakan aturan pajak subsidi ekonomi politik publik baru pasar warga masyarakat'.split(' '));
const FORMS={menaikkan:'naik',naikkan:'naik',kenaikan:'naik',dinaikkan:'naik',menurunkan:'turun',penurunan:'turun',diturunkan:'turun',dicabut:'cabut',mencabut:'cabut',pencabutan:'cabut',diperpanjang:'perpanjang',perpanjangan:'perpanjang',dibatalkan:'batal',membatalkan:'batal',disetujui:'setuju',menyetujui:'setuju',ditolak:'tolak',menolak:'tolak',diubah:'ubah',mengubah:'ubah',perubahan:'ubah',penataan:'tata',menata:'tata',ditata:'tata',dimulai:'mulai',memulai:'mulai',diberlakukan:'berlaku',memberlakukan:'berlaku',pemberlakuan:'berlaku',berlakukan:'berlaku'};
const PLACES=new Set('jember banyuwangi surabaya jakarta bandung bogor malang sidoarjo lumajang situbondo bondowoso probolinggo semarang yogyakarta surakarta denpasar medan makassar palembang padang manado pontianak balikpapan samarinda banjarmasin pekanbaru batam bengkulu kendari kupang mataram ambon jayapura aceh papua banten bali kencong puger rambipuji sumbersari kaliwates mumbulsari wuluhan lengkong gambiran'.split(' '));
const clean=s=>String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
Object.assign(FORMS,{melonjak:'naik',melambung:'naik',meningkat:'naik',peningkatan:'naik',merosot:'turun',menurun:'turun',dibuka:'buka',membuka:'buka',pembukaan:'buka',ditutup:'tutup',menutup:'tutup',penutupan:'tutup'});
const ALIASES={pemkab:'pemerintah kabupaten',pemkot:'pemerintah kota',pemprov:'pemerintah provinsi',disdik:'dinas pendidikan',dishub:'dinas perhubungan',dinkes:'dinas kesehatan',phk:'pemutusan hubungan kerja',elpiji:'lpg'};
const aliasText=text=>clean(text).replace(/\b(pemkab|pemkot|pemprov|disdik|dishub|dinkes|phk|elpiji)\b/g,key=>ALIASES[key]).replace(/\b(?:jl|jln)\./g,'jalan');
const NAME_END=new Set([...STOP,...COMMON,...Object.keys(FORMS),...Object.values(FORMS),...'umumkan diumumkan umum rilis merilis catat mencatat tetapkan menetapkan terapkan menerapkan sebut menyebut jelaskan menjelaskan kritik mengkritik rencana wacana usul minta meminta tinjau meninjau sidak hadiri menghadiri temui menemui serahkan pastikan dorong bantu bantuan anggaran harga korban pekerja'.split(' ')]);
const MONTHS='januari februari maret april mei juni juli agustus september oktober november desember'.split(' ');
export function displayHeadline(title,publisher='') {
  const text=String(title||'').trim(),suffix=String(publisher||'').trim();
  if(suffix&&clean(text).endsWith(clean(suffix))){
    const prefix=text.slice(0,-suffix.length);
    if(/\s[-–—|]\s*$/.test(prefix))return prefix.replace(/\s[-–—|]\s*$/,'').trim();
  }
  return text;
}
export function headline(title,publisher='') {
  const text=aliasText(displayHeadline(title,publisher));
  const words=text.match(/[\p{L}\p{N}]+/gu)||[], tokens=new Set(words.filter(w=>!STOP.has(w)).map(w=>FORMS[w]||w));
  const entities={};
  for(const place of words.filter(w=>PLACES.has(w)))(entities.place ||= new Set()).add(place);
  for(const m of text.matchAll(/\b(kabupaten|kota|kecamatan|desa|jalan|pantai|pasar|sman|smpn)\s+([\p{L}\p{N}]+)/gu)){
    if(!NAME_END.has(m[2]))(entities[m[1]] ||= new Set()).add(m[2]);
  }
  for(const match of text.matchAll(/\b(pt|cv|bank|universitas|partai|gus|ning)\s+([\p{L}]+(?:\s+[\p{L}]+){0,2})/gu)){
    const name=[];for(const word of match[2].split(' ')){if(NAME_END.has(word)||MONTHS.includes(word))break;name.push(word);}
    if(name.length)(entities[['gus','ning'].includes(match[1])?'person':match[1]] ||= new Set()).add(name.join(' '));
  }
  for(const kind of ['pendidikan','perhubungan','kesehatan'])if(text.includes('dinas '+kind))(entities.institution ||= new Set()).add(kind);
  const rates=new Set([...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:%|persen)/g)].map(m=>m[1].replace(',','.')));
  const years=new Set(words.filter(w=>/^(19|20)\d{2}$/.test(w)));
  const dates=new Set([...text.matchAll(/\b(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)(?:\s+((?:19|20)\d{2}))?\b/g)].map(m=>`${MONTHS.indexOf(m[2])+1}-${Number(m[1])}`));
  for(const match of text.matchAll(/\b(?:19|20)\d{2}-(\d{1,2})-(\d{1,2})\b/g))if(+match[1]>=1&&+match[1]<=12&&+match[2]>=1&&+match[2]<=31)dates.add(`${+match[1]}-${+match[2]}`);
  return {key:words.join(' '),tokens,entities,rates,years,dates,negative:words.some(w=>['tidak','bukan','bantah','membantah','menyangkal'].includes(w))};
}
const overlap=(a,b)=>[...a].some(x=>b.has(x));
const weight=t=>/^\d+$/.test(t)?3:COMMON.has(t)?1:2;
export function profileConflicts(a,b,entitiesOnly=false) {
  const conflicts=[];
  if(!entitiesOnly&&a.negative!==b.negative)conflicts.push('Pernyataan dan penyangkalan berbeda.');
  for(const key of Object.keys(a.entities))if(b.entities[key]&&!overlap(a.entities[key],b.entities[key]))conflicts.push((['place','kabupaten','kota','kecamatan','desa','jalan','pantai','pasar','sman','smpn'].includes(key)?'Lokasi':key==='person'?'Nama tokoh':'Organisasi')+' berbeda ('+key+').');
  if(!entitiesOnly){
    for(const key of ['rates','years','dates'])if(a[key]?.size&&b[key]?.size&&!overlap(a[key],b[key]))conflicts.push({rates:'Angka persentase berbeda.',years:'Tahun berbeda.',dates:'Tanggal peristiwa dalam judul berbeda.'}[key]);
    for(const [left,right] of [['naik','turun'],['setuju','tolak'],['cabut','perpanjang'],['batal','berlaku'],['buka','tutup']])if(a.tokens.has(left)&&!a.tokens.has(right)&&b.tokens.has(right)&&!b.tokens.has(left)||a.tokens.has(right)&&!a.tokens.has(left)&&b.tokens.has(left)&&!b.tokens.has(right))conflicts.push('Tindakan berlawanan: '+left+' / '+right+'.');
  }
  return conflicts;
}
const compatibleProfiles=(a,b)=>!profileConflicts(a,b).length;
export function headlineSimilarity(a,b) {
  if(!compatibleProfiles(a,b))return 0;
  if(a.key && a.key===b.key)return 1;
  const shared=[...a.tokens].filter(t=>b.tokens.has(t));if(shared.length<3)return 0;
  const sum=s=>[...s].reduce((n,t)=>n+weight(t),0),common=sum(shared),aa=sum(a.tokens),bb=sum(b.tokens);
  const dice=2*common/(aa+bb),jaccard=common/(aa+bb-common),containment=common/Math.min(aa,bb);
  return dice>=.78&&jaccard>=.6 || shared.length>=4&&containment>=.9&&Math.min(aa,bb)/Math.max(aa,bb)>=.65 ? dice : 0;
}
const sourceTime=s=>Date.parse(s.publishedAt || s.discoveredAt || '');
// RSS summaries often contain only the headline and publisher. Require substantial prose.
function contentProfile(source) {
  const excerpt=String(source.excerpt||'').replace(/<[^>]*>/g,' ').trim();
  if(excerpt.length<90)return null;
  const profile=headline(excerpt);return profile.tokens.size>=12?profile:null;
}
const sourceProfile=source=>({title:headline(source.title,source.publisher),content:contentProfile(source)});
function compareSources(a,b) {
  const left=a.title,right=b.title;
  if(!compatibleProfiles(left,right))return 0;
  // Identical generic headlines can cover different places; use available body geography too.
  if(a.content&&b.content&&profileConflicts(a.content,b.content,true).length)return 0;
  const titleScore=headlineSimilarity(left,right);if(titleScore)return titleScore;
  const ac=a.content,bc=b.content;if(!ac||!bc||!compatibleProfiles(ac,bc))return 0;
  const shared=[...ac.tokens].filter(token=>bc.tokens.has(token));
  // Content alone must share substantial, non-boilerplate vocabulary, plus a title anchor.
  const leftInContent=[...left.tokens].filter(token=>bc.tokens.has(token)&&!COMMON.has(token)&&!PLACES.has(token)),rightInContent=[...right.tokens].filter(token=>ac.tokens.has(token)&&!COMMON.has(token)&&!PLACES.has(token));
  if(shared.length<10||leftInContent.length<Math.max(2,Math.ceil(left.tokens.size*.35))||rightInContent.length<Math.max(2,Math.ceil(right.tokens.size*.35)))return 0;
  const sum=tokens=>[...tokens].reduce((n,token)=>n+weight(token),0),common=sum(shared),aa=sum(ac.tokens),bb=sum(bc.tokens);
  const dice=2*common/(aa+bb),jaccard=common/(aa+bb-common);
  return dice>=.74&&jaccard>=.58 || shared.length>=12&&leftInContent.length>=3&&rightInContent.length>=3&&dice>=.68&&jaccard>=.52?dice:0;
}
export function sourceSimilarity(a,b){return compareSources(sourceProfile(a),sourceProfile(b));}
function profileMatchDetail(a,b){
  const score=compareSources(a,b),titleScore=headlineSimilarity(a.title,b.title),left=titleScore?a.title:a.content||a.title,right=titleScore?b.title:b.content||b.title;
  const conflicts=[...profileConflicts(a.title,b.title),...(a.content&&b.content?profileConflicts(a.content,b.content,true):[])];
  const basis=score?(titleScore?(a.title.key===b.title.key?'title_exact':'title_similarity'):'content_similarity'):null;
  return {matched:score>0,score,basis,sharedTerms:[...left.tokens].filter(t=>right.tokens.has(t)&&!COMMON.has(t)).sort().slice(0,12),sharedEntities:Object.entries(left.entities).flatMap(([kind,values])=>[...values].filter(value=>right.entities[kind]?.has(value)).map(value=>({kind,value}))).slice(0,12),reasons:score?[]:[...new Set(conflicts.length?conflicts:['Kemiripan judul/cuplikannya belum cukup untuk menggabungkan peristiwa.'])]};
}
export function explainSourceMatch(a,b){return profileMatchDetail(sourceProfile(a),sourceProfile(b));}
export const sourceMaterialKey=source=>aliasText(displayHeadline(source.title,source.publisher)).replace(/\s+/g,' ').trim()+'\n'+clean(source.excerpt).replace(/\s+/g,' ').trim();
export function createIssueMatcher() {
  const cache=new WeakMap(),profile=source=>{const old=cache.get(source);if(!old||old.title!==source.title||old.publisher!==source.publisher||old.excerpt!==source.excerpt)cache.set(source,{title:source.title,publisher:source.publisher,excerpt:source.excerpt,value:sourceProfile(source)});return cache.get(source).value;};
  const match=(issue,input)=>{
    if(!issue.sources.length || issue.sources.length>=100)return 0;
    const incoming=sourceTime(input),times=issue.sources.map(sourceTime).filter(Number.isFinite);
    if(!Number.isFinite(incoming)||!times.length||Math.max(incoming,...times)-Math.min(incoming,...times)>72*HOUR)return 0;
    const next=profile(input),profiles=issue.sources.map(profile);
    // Multiple supporting sources can rescue a weak primary headline, without chain-only matches.
    if(profiles.some(p=>!compatibleProfiles(p.title,next.title)))return 0;
    const primary=compareSources(profiles[0],next);if(primary)return primary;
    const supporting=profiles.slice(1).map(p=>compareSources(p,next)).filter(Boolean).sort((a,b)=>b-a);
    return supporting.length>=2?supporting[1]:0;
  };
  match.explain=(issue,input)=>{
    const score=match(issue,input),next=profile(input),times=[sourceTime(input),...issue.sources.map(sourceTime)].filter(Number.isFinite),windowHours=times.length?(Math.max(...times)-Math.min(...times))/HOUR:null;
    const base={methodVersion:RADAR_METHOD.version,usesAI:false,matched:score>0,score,basis:null,referenceSourceIds:[],sharedTerms:[],sharedEntities:[],windowHours,reasons:[]};
    if(!issue.sources.length)return {...base,reasons:['Belum ada sumber pembanding dalam kelompok.']};
    if(issue.sources.length>=100)return {...base,reasons:['Kelompok sudah mencapai batas 100 sumber.']};
    if(!Number.isFinite(sourceTime(input))||!issue.sources.some(s=>Number.isFinite(sourceTime(s))))return {...base,reasons:['Tanggal publikasi/penemuan belum cukup untuk membandingkan waktu.']};
    if(windowHours>72)return {...base,reasons:['Rentang publikasi/penemuan kelompok melebihi 72 jam.']};
    const details=issue.sources.map(source=>({source,...profileMatchDetail(profile(source),next)}));
    if(score){const selected=details[0].matched?[details[0]]:details.slice(1).filter(d=>d.matched).sort((a,b)=>b.score-a.score).slice(0,2);return {...base,basis:selected.length===2?'multiple_sources':selected[0].basis,referenceSourceIds:selected.map(d=>d.source.id),sharedTerms:[...new Set(selected.flatMap(d=>d.sharedTerms))].slice(0,12),sharedEntities:selected[0].sharedEntities};}
    const guards=issue.sources.flatMap(source=>profileConflicts(profile(source).title,next.title));
    return {...base,reasons:[...new Set(guards.length?guards:details[0].reasons.length?details[0].reasons:['Hanya satu anggota kelompok yang cocok; belum cukup dukungan pembanding.'])]};
  };
  return match;
}
export function publisherKey(source) {
  let name=source.publisherUrl || source.publisher || '';
  if(!source.publisherUrl && source.platform==='Berita / Web'){
    try{const host=new URL(source.url).hostname;if(!/^news\.google\./i.test(host))name='https://'+host;}catch{}
  }
  if(!name.trim() || /^(?:rss|google news|berita\/web)$/i.test(name.trim()))return '';
  try {
    const parts=new URL(name).hostname.split('.');
    name=parts.slice(/\.(?:co|com|or|org|ac|go|gov|sch|web|net)\.[a-z]{2}$/.test(parts.join('.'))?-3:-2).join('.');
  }catch{}
  name=clean(name).replace(/^www\./,'').replace(/\.(?:co\.id|com|id|net|org)$/,'').replace(/[^\p{L}\p{N}]/gu,'');
  return ['newsgooglecom','googlenews','rss'].includes(name)?'':name;
}
export function rateIssue(issue,now=Date.now()) {
  const all=issue.sources||[],unique=[...new Map(all.map(s=>[s.url,s])).values()],counts={},publishers=new Set();
  for(const source of unique){counts[source.platform]=(counts[source.platform]||0)+1;const key=publisherKey(source);if(key)publishers.add(key);}
  // Only publication timestamps establish recency. Importing old/undated sources cannot make them hot.
  const dated=unique.filter(s=>{const age=now-Date.parse(s.publishedAt||'');return Number.isFinite(age)&&age>=0&&age<72*HOUR;});
  const eligible=dated.filter(s=>!s.repost && publisherKey(s)),recentPublishers=new Set(eligible.map(publisherKey));
  const day=eligible.filter(s=>now-Date.parse(s.publishedAt)<24*HOUR),dayPublishers=new Set(day.map(publisherKey));
  const platforms=new Set(eligible.map(s=>s.platform)),latest=Math.max(...eligible.map(s=>Date.parse(s.publishedAt))),age=now-latest;
  const components={coverage:Math.min(40,recentPublishers.size*8),activity:Math.min(30,dayPublishers.size*10),
    recency:Number.isFinite(age)?age<6*HOUR?20:age<24*HOUR?16:age<48*HOUR?10:5:0,breadth:Math.min(10,platforms.size*5)};
  const score=Object.values(components).reduce((n,x)=>n+x,0),rating=score>=85?5:score>=65?4:score>=45?3:score>=25?2:1;
  const hasRecentNews=day.some(s=>s.platform==='Berita / Web');
  const hot=score>=65 && recentPublishers.size>=3 && dayPublishers.size>=2 && hasRecentNews;
  const publicationTimes=unique.map(s=>Date.parse(s.publishedAt||'')).filter(time=>Number.isFinite(time)&&time<=now);
  const latestPublication=Math.max(...publicationTimes);
  const observed=issue.observations||[],baseline=observed.filter(o=>Number.isFinite(Date.parse(o.at))&&now-Date.parse(o.at)>=30*60000).at(-1);
  const comparable=baseline?.groupRevision===(issue.groupRevision||1);
  const delta=comparable?dayPublishers.size-baseline.publishers24h:null;
  const trend={state:delta===null?'unavailable':delta>0?'rising':delta<0?'falling':'stable',deltaPublishers24h:delta,since:comparable?baseline.at:null};
  return {sources:unique.length,platforms:Object.keys(counts).length,counts,publishers:publishers.size,
    new24h:day.length,new7d:unique.filter(s=>{const age=now-Date.parse(s.publishedAt||'');return age>=0&&age<168*HOUR;}).length,
    independent:unique.filter(s=>!s.repost).length,recentPublishers:recentPublishers.size,publishers24h:dayPublishers.size,
    undated:unique.filter(s=>!Number.isFinite(Date.parse(s.publishedAt||''))).length,
    latestPublishedAt:Number.isFinite(latestPublication)?new Date(latestPublication).toISOString():null,
    trend,limitedCoverage:recentPublishers.size<3,freshness:!Number.isFinite(latestPublication)?'undated':now-latestPublication<24*HOUR?'recent':now-latestPublication<72*HOUR?'current':'older',
    score,rating,components,isHot:hot,priority:hot?'high':score>=45?'normal':'low',
    reason:`${recentPublishers.size} penerbit dalam 72 jam · ${dayPublishers.size} aktif dalam 24 jam · skor ${score}/100.${recentPublishers.size<3?' Liputan masih terbatas.':''}${!Number.isFinite(latestPublication)?' Tanggal publikasi belum tersedia.':now-latestPublication>=72*HOUR?' Liputan terakhir lebih dari 3 hari lalu.':''}`};
}
