import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {analyzeEditorial,sourceQuality} from '../radar-editorial.mjs';
import {matchesResearchTopic} from '../radar-research-plan.mjs';
import {buildExecutiveSummary} from '../radar-executive.mjs';
import {buildRadarDigest} from '../radar-digest.mjs';

const now=Date.parse('2026-10-06T07:00:00Z'),publishedAt='2026-10-06T01:00:00Z',title='Subsidi listrik keluarga dikurangi di Jember';
const source=(id,text,extra={})=>({id,title,url:`https://${id}.example/berita`,publisher:id,platform:'Berita / Web',publishedAt,excerpt:text,verification:'unchecked',coverage:'snippet',...extra});
const issue=(sources,extra={})=>({id:'research',title,sources,status:'new',topicIds:['system'],contentIds:[],...extra});
const topics=[{id:'system',name:'Sistem',enabled:true,keywords:['subsidi'],exclusions:[],sources:['news','youtube']}];
const evaluate=i=>analyzeEditorial(i,{topics,now});

test('a reviewed full source unrelated to the lead cannot inflate evidence or outline readiness',()=>{
 const snippet=source('claim','Subsidi listrik keluarga dikurangi sebesar Rp200 ribu di Jember.'),unrelated=source('festival','Festival musik menyajikan pertunjukan seni dan pameran.',{article:{text:'Festival musik menyajikan pertunjukan seni dan pameran.'},verification:'verified',sourceRole:'primary'});
 const i=issue([snippet,unrelated]),before=structuredClone(i),e=evaluate(i);
 assert.equal(e.readiness.state,'research');assert.equal(e.components.evidence,1);assert.equal(e.research.lead.fullSources,0);assert.equal(e.evidence.references.length,1);assert.equal(e.evidence.references[0].id,'claim');assert.match(e.gaps.join(' '),/bahan lengkap lain tidak menggantikannya/);assert.deepEqual(i,before);
});
test('opinions, repeated headlines and conflicting geography never become the factual research lead',()=>{
 for(const s of [source('opinion','Subsidi listrik keluarga seharusnya dikurangi di Jember karena dianggap tidak adil.'),source('headline',title),source('geography','Subsidi listrik keluarga dikurangi sebesar Rp200 ribu di Banyuwangi.')]){
  s.article={text:s.excerpt};s.verification='verified';const e=evaluate(issue([s]));assert.equal(e.research.lead,null);assert.equal(e.readiness.state,'research');assert.equal(e.components.evidence,0);assert.equal(e.evidence,null);
 }
});
test('coverage and three research angles reference actual relevant material and propose only missing dimensions',()=>{
 const text='Subsidi listrik keluarga dikurangi sebesar Rp200 ribu di Jember. Peraturan subsidi listrik menetapkan skema biaya baru bagi keluarga di Jember. Keluarga di Jember menanggung biaya listrik tambahan setelah subsidi dikurangi. Subsidi listrik keluarga di Jember turun dari Rp300 ribu menjadi Rp100 ribu dibandingkan periode sebelumnya.';
 const primary=source('primary',text,{article:{text},verification:'verified',sourceRole:'primary'}),e=evaluate(issue([primary]));
 assert.equal(e.readiness.state,'outline');assert.equal(e.research.coverage.filter(d=>d.state==='mentioned').length,4);assert.equal(e.research.coveragePercent,80);assert.deepEqual(e.research.queries.map(q=>q.dimension),['response']);assert.equal(e.research.angles.length,3);
 for(const d of e.research.coverage)for(const c of d.claims){assert.ok(text.includes(c.text));assert.equal(c.references[0].url,primary.url);}
 assert.ok(e.research.angles.every(a=>a.question.endsWith('?')&&a.references.length));assert.ok(e.research.angles.find(a=>a.id==='human').gaps.includes('Tanggapan / perspektif lain'));assert.match(e.research.note,/belum menjalankan pencarian/);
});
test('a relevant attributed response remains an opinion and does not promote itself to lead evidence',()=>{
 const primary=source('primary','Subsidi listrik keluarga dikurangi sebesar Rp200 ribu di Jember.'),response=source('response','Menanggapi subsidi listrik keluarga di Jember, pengamat menilai kebijakan ini mungkin tidak adil.',{sourceRole:'commentary',article:{text:'Menanggapi subsidi listrik keluarga di Jember, pengamat menilai kebijakan ini mungkin tidak adil.'},verification:'verified'}),e=evaluate(issue([primary,response]));
 assert.equal(e.readiness.state,'research');const d=e.research.coverage.find(d=>d.id==='response');assert.equal(d.state,'mentioned');assert.equal(d.claims[0].kind,'opinions');assert.equal(e.evidence.references[0].id,'primary');
});
test('near copies count once while changed numbers, negations and geography stay separate',()=>{
 const body='Subsidi listrik keluarga dikurangi sebesar Rp200 ribu di Jember berdasarkan peraturan yang diumumkan pemerintah. Keluarga pekerja menghadapi tambahan biaya tagihan listrik untuk kebutuhan rumah tangga setelah skema bantuan berubah. Dokumen anggaran mencatat alokasi biaya dan jadwal penyesuaian untuk penerima bantuan.';
 const a=source('original',body,{article:{text:body},verification:'verified'}),copy=source('copy',body+' Laporan ini diterbitkan oleh redaksi.'),q=sourceQuality(issue([copy,a]));assert.equal(q.duplicateSources,1);assert.equal(q.representatives[0].id,'original');assert.match(q.duplicateGroups[0].basis,/90%/);
 for(const variant of [body.replace('Rp200','Rp300'),body.replace('dikurangi','tidak dikurangi'),body.replaceAll('Jember','Banyuwangi')])assert.equal(sourceQuality(issue([a,source('different',variant)])).distinctTexts,2);
});
test('active topic matching reads imported material and respects whole keywords and exclusions',()=>{
 const t={enabled:true,keywords:['bank'],exclusions:['promosi']};assert.equal(matchesResearchTopic({title:'Acara',excerpt:'Banket musik'},t),false);assert.equal(matchesResearchTopic({title:'Arsip',transcript:{text:'Bank mengubah ketentuan biaya layanan.'}},t),true);assert.equal(matchesResearchTopic({title:'Arsip',article:{text:'Bank mengadakan promosi biaya layanan.'}},t),false);assert.equal(matchesResearchTopic({title:'Arsip',excerpt:'Apa saja'},{enabled:true,keywords:[''],exclusions:[]}),false);
});
test('executive evidence follows the selected factual claim, including dated daily scope without outside material',()=>{
 const i=issue([source('current','Subsidi listrik keluarga dikurangi sebesar Rp200 ribu di Jember.'),source('old','Subsidi listrik keluarga dikurangi sebesar Rp999 ribu di Jember.',{publishedAt:'2026-10-04T01:00:00Z'})]);i.editorial=evaluate(i);i.stats={relevant:true};
 const attributedIssue=issue([source('attributed','Menurut laporan, subsidi listrik keluarga dikurangi sebesar Rp200 ribu di Jember.')]);attributedIssue.editorial=evaluate(attributedIssue);assert.equal(buildExecutiveSummary([attributedIssue],{now}).priorities[0].evidence[0].attributed,true);
 const executive=buildExecutiveSummary([i],{now});assert.equal(executive.priorities[0].evidence[0].text,i.editorial.evidence.text);assert.equal(executive.priorities[0].action,i.editorial.readiness.label);
 const digest=buildRadarDigest({topics,issues:[i]},{now,date:'2026-10-06'});assert.doesNotMatch(digest.executive.text,/999/);assert.equal(digest.items[0].editorial.research.lead.references.length,1);
});
test('research map UI escapes materials, preserves claim links and marks search proposals explicitly',async()=>{
 const code=await fs.readFile('public/radar.js','utf8'),context={encodeURIComponent,esc:v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')};vm.createContext(context);vm.runInContext(code.slice(code.indexOf('function radarResearchPlanMarkup('),code.indexOf('function radarMethodology(')),context);
 const plan=evaluate(issue([source('one','Subsidi listrik keluarga dikurangi sebesar Rp200 ribu di Jember.')])).research;plan.angles[0].basis='<img src=x onerror=alert(1)>';const markup=context.radarResearchPlanMarkup(plan);
 assert.match(markup,/&lt;img/);assert.doesNotMatch(markup,/<img/);assert.match(markup,/Peta bahan riset/);assert.match(markup,/pencarian belum dijalankan/);assert.match(markup,/https:\/\/one.example\/berita/);assert.match(markup,/rel="noopener noreferrer"/);assert.equal((markup.match(/class="radar-research-dimension /g)||[]).length,5);
});
