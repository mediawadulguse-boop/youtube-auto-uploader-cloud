const HOUR=3600000;
export const RADAR_METHOD={version:3,displayLimit:10,threshold:65,minRating:4,windowHours:72,minPublishers:3,minPublishers24h:2,
  weights:{coverage:40,activity:30,recency:20,breadth:10},
  description:'Judul atau cuplikan isi serupa dikelompokkan dengan penjagaan peristiwa dan waktu. Radar menampilkan 10 isu dengan skor tertinggi tanpa syarat minimal rating. Rating adalah indikator liputan terpantau, bukan ukuran kebenaran atau viralitas.'};
const STOP=new Set('di ia para namun jika karena terhadap agar masih lebih terus seperti yang dan atau dengan untuk dari ke pada oleh dalam ini itu tersebut akan sudah telah juga sebagai adalah sebuah saat tentang jadi menjadi setelah sebelum serta atas hingga lalu hari terbaru update breaking news video foto'.split(' '));
const COMMON=new Set('pemerintah pemkab kebijakan aturan pajak subsidi ekonomi politik publik baru pasar warga masyarakat'.split(' '));
const FORMS={menaikkan:'naik',naikkan:'naik',kenaikan:'naik',dinaikkan:'naik',menurunkan:'turun',penurunan:'turun',diturunkan:'turun',dicabut:'cabut',mencabut:'cabut',pencabutan:'cabut',diperpanjang:'perpanjang',perpanjangan:'perpanjang',dibatalkan:'batal',membatalkan:'batal',disetujui:'setuju',menyetujui:'setuju',ditolak:'tolak',menolak:'tolak',diubah:'ubah',mengubah:'ubah',perubahan:'ubah',penataan:'tata',menata:'tata',ditata:'tata',dimulai:'mulai',memulai:'mulai',diberlakukan:'berlaku',memberlakukan:'berlaku',pemberlakuan:'berlaku',berlakukan:'berlaku'};
const PLACES=new Set('jember banyuwangi surabaya jakarta bandung bogor malang sidoarjo lumajang situbondo bondowoso probolinggo semarang yogyakarta surakarta denpasar medan makassar palembang padang manado pontianak balikpapan samarinda banjarmasin pekanbaru batam bengkulu kendari kupang mataram ambon jayapura aceh papua banten bali kencong puger rambipuji sumbersari kaliwates mumbulsari wuluhan lengkong gambiran'.split(' '));
const clean=s=>String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase();
export function displayHeadline(title,publisher='') {
  const text=String(title||'').trim(),suffix=String(publisher||'').trim();
  if(suffix&&clean(text).endsWith(clean(suffix))){
    const prefix=text.slice(0,-suffix.length);
    if(/\s[-–—|]\s*$/.test(prefix))return prefix.replace(/\s[-–—|]\s*$/,'').trim();
  }
  return text;
}
export function headline(title,publisher='') {
  const text=clean(displayHeadline(title,publisher));
  const words=text.match(/[\p{L}\p{N}]+/gu)||[], tokens=new Set(words.filter(w=>!STOP.has(w)).map(w=>FORMS[w]||w));
  const entities={};
  for(const place of words.filter(w=>PLACES.has(w)))(entities.place ||= new Set()).add(place);
  for(const m of text.matchAll(/\b(kabupaten|kota|kecamatan|desa|jalan|pantai|pasar|sman|smpn)\s+([\p{L}\p{N}]+)/gu)){
    if(!STOP.has(m[2]))(entities[m[1]] ||= new Set()).add(m[2]);
  }
  const rates=new Set([...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:%|persen)/g)].map(m=>m[1].replace(',','.')));
  const years=new Set(words.filter(w=>/^(19|20)\d{2}$/.test(w)));
  return {key:words.join(' '),tokens,entities,rates,years,negative:words.some(w=>['tidak','bukan','bantah','membantah','menyangkal'].includes(w))};
}
const overlap=(a,b)=>[...a].some(x=>b.has(x));
const weight=t=>/^\d+$/.test(t)?3:COMMON.has(t)?1:2;
function compatibleProfiles(a,b) {
  if(a.negative!==b.negative)return 0;
  for(const key of Object.keys(a.entities))if(b.entities[key]&&!overlap(a.entities[key],b.entities[key]))return 0;
  for(const key of ['rates','years'])if(a[key].size&&b[key].size&&!overlap(a[key],b[key]))return 0;
  for(const [left,right] of [['naik','turun'],['setuju','tolak'],['cabut','perpanjang'],['batal','berlaku']]){
    if(a.tokens.has(left)&&b.tokens.has(right)||a.tokens.has(right)&&b.tokens.has(left))return 0;
  }
  return true;
}
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
  const titleScore=headlineSimilarity(left,right);if(titleScore)return titleScore;
  const ac=a.content,bc=b.content;if(!ac||!bc||!compatibleProfiles(ac,bc))return 0;
  const shared=[...ac.tokens].filter(token=>bc.tokens.has(token));
  // Content alone must share substantial, non-boilerplate vocabulary, plus a title anchor.
  const leftInContent=[...left.tokens].filter(token=>bc.tokens.has(token)&&!COMMON.has(token)&&!PLACES.has(token)),rightInContent=[...right.tokens].filter(token=>ac.tokens.has(token)&&!COMMON.has(token)&&!PLACES.has(token));
  if(shared.length<10||leftInContent.length<Math.max(2,Math.ceil(left.tokens.size*.35))||rightInContent.length<Math.max(2,Math.ceil(right.tokens.size*.35)))return 0;
  const sum=tokens=>[...tokens].reduce((n,token)=>n+weight(token),0),common=sum(shared),aa=sum(ac.tokens),bb=sum(bc.tokens);
  const dice=2*common/(aa+bb),jaccard=common/(aa+bb-common);
  return dice>=.74&&jaccard>=.58?dice:0;
}
export function sourceSimilarity(a,b){return compareSources(sourceProfile(a),sourceProfile(b));}
export function createIssueMatcher() {
  const cache=new WeakMap(),profile=source=>{if(!cache.has(source))cache.set(source,sourceProfile(source));return cache.get(source);};
  return (issue,input)=>{
    if(!issue.sources.length || issue.sources.length>=100)return 0;
    const incoming=sourceTime(input),times=issue.sources.map(sourceTime).filter(Number.isFinite);
    if(!Number.isFinite(incoming)||!times.length||Math.max(incoming,...times)-Math.min(incoming,...times)>72*HOUR)return 0;
    return compareSources(profile(issue.sources[0]),profile(input));
  };
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
