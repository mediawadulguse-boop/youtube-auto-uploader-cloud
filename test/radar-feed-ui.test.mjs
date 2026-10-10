import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../public/radar.js',import.meta.url),'utf8');
const methods=source.slice(source.indexOf('function radarRating('),source.indexOf('const rDialog='));
const ctx={esc:s=>String(s).replaceAll('<','&lt;')};vm.createContext(ctx);vm.runInContext(methods,ctx);
const now=Date.parse('2026-10-03T01:25:00Z');
const item=(id,score,isHot,status='new',extra={})=>({id,title:'Judul '+id,status,topicIds:['system'],sources:[{title:'Varian sumber '+id,publisher:'Media '+id,excerpt:'Rincian kebijakan'}],stats:{score,rating:isHot?4:2,isHot,relevant:true,latestPublishedAt:'2026-10-02T12:00:00Z',...extra}});
test('main Radar includes low scores, sorts descending, excludes ignored/discussed/unrelated and searches excerpts',()=>{
 const data={issues:[item('cold',25,false),item('hot',79,true),item('ignored',95,true,'ignored'),item('discussed',95,true,'discussed'),item('top',95,true),item('other',95,true,'new',{relevant:false})],hotIssues:[item('hot',79,true)]};
 assert.deepEqual(Array.from(ctx.radarVisibleIssues(data,'issues'),i=>i.id),['top','hot','cold']);
 assert.deepEqual(Array.from(ctx.radarVisibleIssues(data,'issues',{q:'varian sumber cold'}),i=>i.id),['cold']);
 assert.equal(ctx.radarVisibleIssues(data,'issues',{q:'rincian kebijakan'}).length,3);
 assert.equal(ctx.radarVisibleIssues(data,'issues',{topic:'different'}).length,0);
 data.issues[0].sources[0].platform='YouTube';assert.deepEqual(Array.from(ctx.radarVisibleIssues(data,'issues',{platform:'YouTube'}),i=>i.id),['cold']);
});
test('saved references and all ratings remain accessible and star label is readable',()=>{
 const saved=item('saved',10,false,'saved'),data={issues:[saved,item('cold',10,false),item('hot',79,true)]};
 assert.deepEqual(Array.from(ctx.radarVisibleIssues(data,'references'),i=>i.id),['saved']);assert.equal(ctx.radarVisibleIssues(data,'issues',{q:'cold'}).length,1);
 const html=ctx.radarRating({rating:4,score:79});assert.match(html,/★★★★☆/);assert.match(html,/4\/5/);assert.match(html,/79\/100/);assert.match(html,/aria-label/);
});
test('10 cards initially, expand in score order, apply filters before limiting and fallback only if period has no sources',()=>{
 const issues=Array.from({length:25},(_,n)=>item('i'+n,n,false)),data={issues};
 let page=ctx.radarPage(data,'issues',{period:24},now);assert.equal(page.items.length,10);assert.equal(page.total,25);assert.equal(page.items[0].stats.score,24);assert.equal(page.fallback,false);
 page=ctx.radarPage(data,'issues',{period:24,limit:20},now);assert.equal(page.items.length,20);assert.equal(page.items[19].stats.score,5);
 assert.equal(ctx.radarPage(data,'issues',{q:'judul i0'},now).items.length,1);
 const old=item('old',79,true,'new',{latestPublishedAt:'2026-09-28T12:00:00Z'}),undated=item('unknown',0,false,'new',{latestPublishedAt:null});
 page=ctx.radarPage({issues:[old,undated]},'issues',{period:24},now);assert.equal(page.fallback,true);assert.equal(page.total,2);
 page=ctx.radarPage({issues:[old,issues[0]]},'issues',{period:24},now);assert.equal(page.fallback,false);assert.deepEqual(Array.from(page.items,i=>i.id),['i0']);
 page=ctx.radarPage({issues:[old]},'issues',{period:168},now);assert.equal(page.fallback,false);assert.equal(page.total,1);
});
test('trend labels require observations and research angles stay questions rather than generated facts',()=>{
 assert.match(ctx.radarTrend({}),/Belum ada pembanding/);assert.match(ctx.radarTrend({trend:{state:'rising'}}),/Naik/);
 assert.match(ctx.radarAngles({title:'<Isu>'}),/&lt;Isu>/);assert.match(ctx.radarAngles({title:'Isu'}),/belum merupakan kesimpulan fakta/);
 assert.match(ctx.radarMethodology({}),/tanpa batas minimal bintang/);
});
test('actual card renderer limits the DOM to 10 cards, shows next-page control and low-rated detail links',()=>{
 const listSource=source.slice(source.indexOf('function radarList(){'),source.indexOf('function radarSettings(){'));
 const nodes=new Map(),select=selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',classList:{toggle(){}},onclick:null,textContent:''});return nodes.get(selector);};
 const items=Array.from({length:15},(_,n)=>({...item('card'+n,n,false),lenses:[],contentIds:[],editorial:{score:n,readiness:{label:'Perlu riset'},evidence:{text:'Menurut sumber, kenaikan pajak belum berlaku.'},reasons:['Alasan panjang hanya di detail']},stats:{...item('card'+n,n,false).stats,latestPublishedAt:new Date().toISOString(),priority:'low',counts:{'Berita / Web':1},sources:1,platforms:1,publishers:1,publishers24h:1,new24h:1,reason:'Liputan terbatas',freshness:'recent',limitedCoverage:true}}));
 const renderContext={...ctx,$:select,radarUi:{tab:'issues',q:'',topic:'',status:'',period:72,limit:10,data:{issues:items,coverage:{'Berita / Web':'Dipantau'},sync:{},radarSummary:{},ai:{}}},rDate:()=>'',rNum:String,rStatus:{new:'Baru'},rLens:()=>'',radarAIConnection:()=>'',radarRun:()=>{}};
 vm.createContext(renderContext);vm.runInContext(methods+listSource,renderContext);renderContext.radarList();
 let html=select('#radarList').innerHTML;assert.equal((html.match(/class="radar-card"/g)||[]).length,10);assert.match(html,/data-r-more/);assert.match(html,/#1 · Radar teratas/);assert.match(html,/Liputan terbatas/);assert.match(html,/data-r-issue="card14"/);
 assert.match(html,/kenaikan pajak belum berlaku/);assert.match(html,/Lihat detail/);assert.doesNotMatch(html,/Alasan panjang hanya di detail|<details|<a /);
 renderContext.radarUi.limit=20;renderContext.radarList();html=select('#radarList').innerHTML;assert.equal((html.match(/class="radar-card"/g)||[]).length,15);assert.doesNotMatch(html,/data-r-more/);
});
