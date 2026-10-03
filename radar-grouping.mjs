import {createIssueMatcher,RADAR_METHOD,sourceMaterialKey,explainSourceMatch} from './radar-methodology.mjs';

function manualMatch(issue,input){
 if(!issue.groupingHistory?.some(h=>h.action==='merge')||issue.sources.length>=100)return null;
 const incoming=Date.parse(input.publishedAt||input.discoveredAt||''),times=issue.sources.map(s=>Date.parse(s.publishedAt||s.discoveredAt||'')).filter(Number.isFinite);
 if(!Number.isFinite(incoming)||!times.length||Math.max(incoming,...times)-Math.min(incoming,...times)>72*3600000)return null;
 const key=sourceMaterialKey(input),reference=issue.sources.find(s=>sourceMaterialKey(s)===key);if(!reference)return null;
 const pair=explainSourceMatch(reference,input);
 return {methodVersion:RADAR_METHOD.version,usesAI:false,matched:true,score:1,basis:'manual_rule',referenceSourceIds:[reference.id],sharedTerms:pair.sharedTerms,sharedEntities:pair.sharedEntities,windowHours:(Math.max(incoming,...times)-Math.min(incoming,...times))/3600000,reasons:[]};
}

// A separation is a saved editorial boundary, not a globally trained semantic model.
export function selectIssue(issues,input,match=createIssueMatcher()){
 const candidates=issues.map(issue=>{const manual=manualMatch(issue,input);return {issue,score:manual?.score||match(issue,input),manual};}).filter(c=>c.score>0),suppressed=new Set(),families=new Map();
 for(const candidate of candidates){const key=candidate.issue.groupPartition;if(key){if(!families.has(key))families.set(key,[]);families.get(key).push(candidate);}}
 const ambiguous=[];
 for(const [partition,groups]of families){
  if(groups.length<2)continue;
  const key=sourceMaterialKey(input),exact=groups.filter(c=>c.issue.sources.some(s=>sourceMaterialKey(s)===key));
  const quarantine=exact.filter(c=>c.issue.groupingReview);
  const sorted=groups.toSorted((a,b)=>b.score-a.score||a.issue.id.localeCompare(b.issue.id));
  const winner=exact.length===1?exact[0]:quarantine.length===1?quarantine[0]:sorted[0].score-sorted[1].score>=.08?sorted[0]:null;
  for(const candidate of groups)if(candidate!==winner)suppressed.add(candidate.issue.id);
  if(!winner)ambiguous.push(partition);
 }
 if(ambiguous.length)return {issue:null,ambiguousPartition:ambiguous[0],match:null};
 const best=candidates.filter(c=>!suppressed.has(c.issue.id)).sort((a,b)=>b.score-a.score||Number(!!b.manual)-Number(!!a.manual)||Number(!!b.issue.groupPartition)-Number(!!a.issue.groupPartition)||a.issue.id.localeCompare(b.issue.id))[0];
 return {issue:best?.issue||null,ambiguousPartition:null,match:best?(best.manual||match.explain(best.issue,input)):null};
}

export function groupingProvenance(mode,at,detail){
 return {mode,at,methodVersion:RADAR_METHOD.version,...(detail?{score:detail.score,basis:detail.basis,referenceSourceIds:detail.referenceSourceIds,sharedTerms:detail.sharedTerms}:{} )};
}

export function explainIssueGrouping(issue){
 const match=createIssueMatcher();
 const sources=issue.sources.map((source,index)=>{
  const others=issue.sources.filter(s=>s.id!==source.id);
  const evaluation=others.length?match.explain({...issue,sources:others},source):{methodVersion:RADAR_METHOD.version,usesAI:false,matched:false,score:0,basis:'anchor',referenceSourceIds:[],sharedTerms:[],sharedEntities:[],windowHours:0,reasons:['Satu sumber; belum ada pembanding dalam kelompok.']};
  return {id:source.id,title:source.title,url:source.url,publisher:source.publisher,platform:source.platform,publishedAt:source.publishedAt||null,initial:index===0,provenance:source.grouping||null,evaluation};
 });
 return {issueId:issue.id,title:issue.title,revision:issue.revision,methodVersion:RADAR_METHOD.version,usesAI:false,locked:!!issue.groupingLocked,separationRule:!!issue.groupPartition,reviewRequired:!!issue.groupingReview,history:issue.groupingHistory||[],sources,
  note:'Kemiripan adalah ukuran tumpang tindih teks, bukan probabilitas kebenaran. Evaluasi memakai engine saat ini; riwayat masuk sumber hanya ditampilkan jika tersimpan. Pemisahan menyimpan batas antar kelompok: kecocokan baru yang ambigu perlu ditinjau.'};
}
