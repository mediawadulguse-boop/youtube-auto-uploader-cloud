import {headline,publisherKey,rateIssue,profileConflicts} from './radar-methodology.mjs';
import {buildIssueReport,materialText,plainSource} from './radar-engine.mjs';
import {buildResearchPlan,matchesResearchTopic} from './radar-research-plan.mjs';

export const EDITORIAL_METHOD={version:2,usesAI:false,weights:{relevance:30,tension:25,evidence:20,novelty:15,timing:10},description:'Prioritas riset dari kecocokan DNA, sinyal cerita, dukungan pada klaim utama, kebaruan terhadap workspace dan momentum. Salinan identik/hampir identik tidak menambah bukti berbeda. Peta riset dan tiga angle mengikuti bahan tersimpan; bukan prediksi viral atau verifikasi otomatis.'};
const HOUR=3600000;
const normalize=s=>plainSource(s||'').normalize('NFKC').toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N}%]+/gu,' ').trim().replace(/\s+/g,' ');
const lexicons={system:/\b(pajak|subsidi|kebijakan|regulasi|monopoli|anggaran|laba|pendapatan|utang|modal|insentif|perusahaan|bank|harga|upah|biaya|phk|pekerja)\b/,history:/\b(sejarah|kronologi|arsip|dulu|krisis|rekam jejak|perubahan|berubah|runtuh|bangkrut|gagal|kegagalan|strategi)\b/,human:/\b(warga|pekerja|keluarga|masyarakat|mahasiswa|siswa|konsumen|pelanggan|biaya hidup|kelas menengah|burnout|kehidupan|penghasilan)\b/,person:/\b(tokoh|pendiri|pemimpin|direktur|ceo|biografi|kepemimpinan)\b/};
function bodyKey(source){const text=normalize(materialText(source));return text.length>=90&&text.split(' ').length>=12?text:'';}
function copyProfile(source){const text=bodyKey(source),words=text.split(' '),grams=new Set();if(words.length>=24)for(let i=0;i<=words.length-5;i++)grams.add(words.slice(i,i+5).join(' '));return {text,grams,numeric:JSON.stringify(plainSource(materialText(source)).match(/\d+(?:[.,]\d+)*(?:\s*%|\s*persen)?/g)||[]),negative:JSON.stringify(text.match(/\b(?:tidak|belum|bukan|bantah|menyangkal)\b/g)||[]),identity:headline(text)};}
function nearCopy(a,b){if(!a.grams.size||!b.grams.size||a.numeric!==b.numeric||a.negative!==b.negative||profileConflicts(a.identity,b.identity,true).length)return false;const smaller=a.grams.size<=b.grams.size?a.grams:b.grams,larger=smaller===a.grams?b.grams:a.grams;return smaller.size/larger.size>=.7&&[...smaller].filter(g=>larger.has(g)).length/smaller.size>=.9;}
export function sourceQuality(issue){
 const value=s=>Number(!s.repost)*100+Number(!!(s.article?.text||s.transcript?.text))*8+Number(s.verification==='verified')*5+Number(s.sourceRole==='primary')*4;
 const groups=[],exact=new Map(),index=new Map();
 for(const source of (issue.sources||[]).toSorted((a,b)=>value(b)-value(a)||String(a.url).localeCompare(String(b.url)))){
  const profile=copyProfile(source),key=profile.text||'url:'+source.url;let group=exact.get(key);
  if(!group&&profile.grams.size){const candidates=new Set();for(const gram of profile.grams)for(const g of index.get(gram)||[])candidates.add(g);group=[...candidates].find(g=>nearCopy(profile,g.profile));if(group)group.near=true;}
  if(!group){group={sources:[],profile,near:false};groups.push(group);for(const gram of profile.grams){const items=index.get(gram)||[];items.push(group);index.set(gram,items);}}
  group.sources.push(source);exact.set(key,group);
 }
 const duplicateGroups=groups.filter(g=>g.sources.length>1).map(g=>({sourceIds:g.sources.map(s=>s.id),publishers:[...new Set(g.sources.map(s=>s.publisher))],basis:g.near?'Bahan terindikasi salinan: ≥90% rangkaian lima kata sama, angka, negasi dan identitas yang dikenali tetap sama.':'Teks bahan identik setelah normalisasi.'}));
 const representatives=groups.map(g=>g.sources[0]);
 const usable=representatives.filter(s=>!s.repost),full=usable.filter(s=>s.article?.text||s.transcript?.text),verified=usable.filter(s=>s.verification==='verified'),primary=usable.filter(s=>s.sourceRole==='primary');
 return {representatives:usable,duplicateGroups,duplicateSources:duplicateGroups.reduce((n,g)=>n+g.sourceIds.length-1,0),distinctTexts:usable.length,fullSources:full.length,verifiedSources:verified.length,primarySources:primary.length,publishers:new Set(usable.map(publisherKey).filter(Boolean)).size,note:'Kemiripan salinan adalah heuristik, bukan kepastian asal teks. Teks berbeda dan penerbit berbeda tidak otomatis membuktikan konfirmasi independen. Jenis sumber dan verifikasi dipilih editor.'};
}
const feedbackChoice=issue=>issue.editorialFeedback?.choice||'';
function preference(topicIds,issues){
 const samples=issues.filter(i=>['relevant','less'].includes(feedbackChoice(i))&&i.topicIds?.some(id=>topicIds.includes(id)));
 const delta=samples.length>=5?Math.round((samples.filter(i=>feedbackChoice(i)==='relevant').length/samples.length-.5)*8):0;
 return {samples:samples.length,adjustment:delta};
}
function outcomePreference(topicIds,issues,performance){
 const ids=new Set(issues.filter(i=>i.topicIds?.some(id=>topicIds.includes(id))).map(i=>i.id)),seen=new Set(),ratios=[];
 for(const item of performance?.items||[])if(ids.has(item.id))for(const c of item.contents){if(c.state==='cached'&&c.benchmark?.ratio>0&&!seen.has(c.videoId)){seen.add(c.videoId);ratios.push(c.benchmark.ratio);}}
 const adjustment=ratios.length>=3?Math.round(Math.max(-3,Math.min(3,ratios.reduce((n,r)=>n+Math.log2(r),0)/ratios.length*2))):0;
 return {samples:ratios.length,adjustment,note:'Asosiasi hasil pada format dan usia sebanding, bukan sebab-akibat atau prediksi.'};
}
export function analyzeEditorial(issue,{topics=[],issues=[],contents=[],performance=null,now=Date.now()}={}){
 const quality=sourceQuality(issue),report=buildIssueReport(issue),research=buildResearchPlan(issue,report,quality),material=[...new Set(research.coverage.flatMap(d=>d.claims.map(c=>c.text)))].join('\n'),hay=normalize(issue.title+' '+material);
 const matching=topics.filter(t=>matchesResearchTopic({title:issue.title,excerpt:material},t)),topicIds=[...new Set([...(issue.topicIds||[]),...matching.map(t=>t.id)])];
 const lenses=Object.entries(lexicons).filter(([,pattern])=>pattern.test(hay)).map(([key])=>key);
 const relevance=Math.min(30,(matching.length?10:0)+lenses.length*5);
 const conflicts=report.conflicts.length+(report.differences?.length||0),claim=research.lead;
 const tensionSignals=[];
 if(/\b(naik|turun|melonjak|merosot|phk|bangkrut|rugi|gagal|krisis|cabut|tolak|batal|bantah|tidak|kesenjangan)\b/.test(hay))tensionSignals.push('Perubahan atau perbedaan dinyatakan dalam bahan.');
 if(lexicons.system.test(hay)&&lexicons.human.test(hay))tensionSignals.push('Bahan menyebut unsur ekonomi/kebijakan dan dampak pada manusia.');
 if(lexicons.history.test(hay))tensionSignals.push('Ada sinyal perubahan, sejarah atau strategi untuk ditelusuri.');
 if(conflicts)tensionSignals.push('Ada angka atau pernyataan berbeda yang perlu dibandingkan.');
 const tension=Math.min(claim?25:8,tensionSignals.length*7+(report.actors.length>=2?4:0));
 const evidence=Math.min(20,Math.min(8,(claim?.fullSources||0)*8)+Math.min(5,(claim?.verifiedFullSources||0)*5)+Math.min(4,(claim?.primaryFullSources||0)*4)+((claim?.publishers||0)>=2?2:0)+(claim?1:0));
 const linked=(issue.contentIds||[]).map(id=>contents.find(c=>c.id===id)).filter(Boolean),tokens=headline(issue.title).tokens;
 const repeated=issues.filter(i=>i.id!==issue.id&&i.status==='discussed').some(i=>{const other=headline(i.title).tokens,shared=[...tokens].filter(t=>other.has(t)).length;return shared>=4&&shared/Math.max(tokens.size,other.size)>=.8;});
 const novelty=linked.some(c=>c.youtubeVideoId)?3:linked.length?6:repeated?7:15;
 const momentum=rateIssue({...issue,sources:quality.representatives},now),timing=Math.round(momentum.score/10);
 const learned=preference(topicIds,issues),outcomes=outcomePreference(topicIds,issues,performance),choice=feedbackChoice(issue),feedbackAdjustment=choice==='relevant'?6:choice==='less'?-20:0;
 const components={relevance,tension,evidence,novelty,timing},score=Math.max(0,Math.min(100,Object.values(components).reduce((n,v)=>n+v,0)+feedbackAdjustment+learned.adjustment+outcomes.adjustment));
 const readiness=issue.groupingReview||conflicts?{state:'review',label:'Periksa perbedaan'}:!claim?.verifiedFullSources?{state:'research',label:'Perlu riset'}:{state:'outline',label:'Bahan untuk kerangka'};
 const dominant=lenses.includes('person')?'Perjalanan tokoh':lenses.includes('system')?'Struktur & insentif':lenses.includes('history')?'Sejarah & strategi':lenses.includes('human')?'Dampak manusia':'Konteks isu';
 const question=/\b(pendapatan|laba)\b/.test(hay)&&/\b(biaya|upah)\b/.test(hay)&&/\b(pekerja|pelanggan|konsumen)\b/.test(hay)?'Bagaimana biaya dan pendapatan dalam sumber ini terbagi antara perusahaan dan pekerja atau pelanggan?':/\b(pajak|subsidi)\b/.test(hay)&&lexicons.human.test(hay)?'Siapa menanggung biaya kebijakan ini, dan apa bukti dampaknya pada kelompok yang disebut sumber?':lenses.includes('person')?'Keputusan tokoh mana yang perlu ditelusuri melalui kronologi dan bukti, serta apa dampaknya pada orang lain?':lenses.includes('history')?'Keputusan dan perubahan apa yang mendahului peristiwa ini, dan apa data pembandingnya?':`Apa bukti dan dampak yang perlu diperiksa dari “${issue.title}”?`;
 const angle=claim?`${dominant}: ${question} Titik awal dari sumber: ${claim.text}`:`${dominant}: lengkapi konteks “${issue.title}” sebelum menentukan kesimpulan.`;
 const lensLabels={system:'struktur dan insentif',history:'sejarah dan strategi',human:'dampak manusia',person:'perjalanan tokoh'};
 const reasons=[`${matching.length?matching.map(t=>t.name).join(', '):'Kecocokan topik perlu ditinjau'} · sinyal ${lenses.map(l=>lensLabels[l]).join(', ')||'belum cukup'}.`,...tensionSignals.slice(0,1),`Klaim utama: ${claim?.fullSources||0} bahan lengkap · ${claim?.verifiedFullSources||0} lengkap dan ditandai terverifikasi · ${claim?.primaryFullSources||0} lengkap dan ditandai primer.`,linked.length?'Sudah ada konten/draft terkait; cari perkembangan atau angle tambahan.':repeated?'Judul serupa pernah dibahas; kebaruan perlu diperiksa.':'Belum ada konten terkait yang tersimpan.'];
 const gaps=[...(issue.groupingReview?['Tinjau batas kelompok.']:[]),...(conflicts?['Bandingkan klaim atau angka sebelum menyimpulkan.']:[]),...research.gaps,...research.coverage.filter(d=>d.state==='missing').map(d=>d.question),...(quality.publishers<2?['Cari pembanding dari penerbit lain.']:[]),...(quality.duplicateSources?[`${quality.duplicateSources} tautan memiliki teks identik atau hampir identik; tidak menambah bukti berbeda.`]:[])];
 const {representatives,...qualitySummary}=quality;
 return {version:EDITORIAL_METHOD.version,usesAI:false,score,rating:score>=85?5:score>=65?4:score>=45?3:score>=25?2:1,components,momentum:{score:momentum.score,rating:momentum.rating,isHot:momentum.score>=65&&momentum.recentPublishers>=3&&momentum.publishers24h>=2,reason:momentum.reason},readiness,reasons,angle,evidence:claim?{text:claim.text,attributed:claim.attributed,sourceNumbers:claim.sourceNumbers,references:claim.references}:null,research,gaps,sourceQuality:qualitySummary,feedback:{choice,adjustment:feedbackAdjustment},learning:{preferences:learned,outcomes},note:EDITORIAL_METHOD.description};
}
export const compareEditorial=(a,b)=>(b.editorial?.score??b.stats?.score??0)-(a.editorial?.score??a.stats?.score??0)||(Date.parse(b.stats?.latestPublishedAt||'')||0)-(Date.parse(a.stats?.latestPublishedAt||'')||0)||a.id.localeCompare(b.id);

export function relateIssues(issues,now=Date.now()){
 const generic=new Set('perusahaan layanan harga mulai naik turun upah pekerja pelanggan pemerintah aturan kebijakan warga biaya program bantuan tahun persen bukan tidak oktober september januari februari maret april mei juni juli agustus november desember'.split(' '));
 const profiles=new Map(),index=new Map(),result=new Map(issues.map(i=>[i.id,[]]));
 for(const issue of issues){const p=headline(issue.title),terms=[...p.tokens].filter(t=>t.length>3&&!['pemerintah','kebijakan','masyarakat','publik','terbaru','warga'].includes(t));profiles.set(issue.id,{p,terms});for(const t of terms){const ids=index.get(t)||[];ids.push(issue.id);index.set(t,ids);}}
 const byId=new Map(issues.map(i=>[i.id,i]));
 for(const issue of issues){
  const {p,terms}=profiles.get(issue.id),hits=new Map();for(const t of terms)for(const id of index.get(t)||[])if(id!==issue.id)hits.set(id,(hits.get(id)||0)+1);
  for(const [id,count] of [...hits].filter(([,n])=>n>=3).sort((a,b)=>b[1]-a[1]).slice(0,12)){
   const other=byId.get(id),right=profiles.get(id),leftAt=Date.parse(issue.stats?.latestPublishedAt||issue.sources?.[0]?.publishedAt||''),rightAt=Date.parse(other.stats?.latestPublishedAt||other.sources?.[0]?.publishedAt||'');
   if(!Number.isFinite(leftAt)||!Number.isFinite(rightAt)||Math.abs(leftAt-rightAt)>14*24*HOUR||leftAt>now||rightAt>now)continue;
   if(Object.keys(p.entities).some(k=>right.p.entities[k]&&![...p.entities[k]].some(x=>right.p.entities[k].has(x))))continue;
   if(count/Math.max(terms.length,right.terms.length)<.5)continue;
   const sharedEntity=Object.keys(p.entities).some(k=>right.p.entities[k]&&[...p.entities[k]].some(x=>right.p.entities[k].has(x))),specificTerms=terms.filter(t=>right.terms.includes(t)&&!generic.has(t)&&!/^\d+$/.test(t));
   if(!sharedEntity&&!specificTerms.length)continue;
   const type=p.negative!==right.p.negative?'claim_response':'development';
   result.get(issue.id).push({id,title:other.title,type,label:type==='claim_response'?'Pernyataan / tanggapan terkait':'Perkembangan terkait',sharedTerms:terms.filter(t=>right.terms.includes(t)),note:'Hubungan berdasarkan judul dan waktu; perlu ditinjau. Sumber tidak digabung otomatis.'});
  }
 }
 return result;
}
