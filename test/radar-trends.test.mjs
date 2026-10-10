import test from 'node:test';import assert from 'node:assert/strict';
import {buildRadarTrends} from '../radar-trends.mjs';
const now=Date.parse('2026-10-10T03:00:00Z'),H=3600000;
const source=(id,title,age,extra={})=>({id,url:'https://media'+id+'.test/article',publisher:'Media '+id,platform:'Berita / Web',title,excerpt:'',publishedAt:new Date(now-age*H).toISOString(),...extra});
const issue=(id,sources,extra={})=>({id,title:'Test issue',status:'new',topicIds:['politics'],sources,...extra});
const topics=[{id:'politics',name:'Politik',enabled:true,keywords:['gibran','politik','presiden'],exclusions:[],sources:['news','youtube']},{id:'economy',name:'Ekonomi',enabled:true,keywords:['pajak','bank'],exclusions:[],sources:['news','youtube']}];
const data=issues=>({topics,focus:{mode:'controversy'},issues});
const keyword=(r,key)=>r.keywords.find(k=>k.key===key);

test('trends count one mention per unique source, both news and YouTube, and same-duration previous coverage',()=>{
 const first=source('a','Wakil Presiden Gibran membantah tuduhan ijazah',2,{excerpt:'Gibran, Gibran, Gibran. Dugaan ijazah dipersoalkan dalam politik.'});
 const second=source('b','Politikus mempertanyakan ijazah Gibran',4);
 const third=source('c','Politik Gibran dan ijazah dipersoalkan',7,{platform:'YouTube',url:'https://www.youtube.com/watch?v=abcdefghijk'});
 const before=source('d','Politik Gibran membantah perkara ijazah',30);
 const d=data([issue('one',[first,second,third,before])]),frozen=JSON.stringify(d),r=buildRadarTrends(d,{now,topic:'politics'});
 assert.equal(r.sourceCount,3);assert.equal(r.previousSourceCount,1);assert.equal(r.platforms.YouTube,1);assert.equal(r.usesAI,false);assert.equal(r.metric,'source-frequency');
 const pair=keyword(r,'gibran · ijazah');assert.equal(pair.count,3);assert.equal(pair.previousCount,1);assert.equal(pair.delta,2);assert.equal(pair.buckets.reduce((n,b)=>n+b.count,0),3);assert.equal(pair.buckets.length,24);assert.equal(pair.share,100);
 assert.equal(JSON.stringify(d),frozen);assert.match(r.note,/bukan volume pencarian Google/);
 const youtube=buildRadarTrends(d,{now,platform:'YouTube'});assert.equal(youtube.sourceCount,1);assert.equal(keyword(youtube,'gibran · ijazah').count,1);
});

test('reposts, duplicate URL/material, undated and future sources never inflate the chart',()=>{
 const first=source('a','Politik Gibran: ijazah dipersoalkan',1);
 const duplicate={...first,id:'b',url:first.url+'?utm_source=other'};
 const material={...first,id:'c',url:'https://syndicated.test/story'};
 const repost=source('e','Politik Gibran: gugatan ijazah',3,{repost:true});
 const undated=source('f','Politik Gibran: kritik ijazah',0,{publishedAt:null});
 const future=source('g','Politik Gibran membantah tuduhan ijazah',-1);
 const r=buildRadarTrends(data([issue('one',[first,duplicate,material,repost,undated,future]),issue('two',[first])]),{now});
 assert.equal(r.sourceCount,1);assert.deepEqual(r.excluded,{undated:1,future:1,reposts:1,duplicates:3});assert.equal(keyword(r,'gibran · ijazah').count,1);
});

test('context comes from a current headline that supplied the phrase, not a matching excerpt',()=>{
 const title='Apakah Wakil Presiden Gibran membantah tuduhan ijazah demi menjawab kritik?';
 const origin=source('headline',title,1),excerptOnly=source('excerpt','Politik: presiden menjawab kritik publik',2,{excerpt:'Gibran membantah tuduhan ijazah.'});
 const r=buildRadarTrends(data([issue('one',[origin,excerptOnly])]),{now});
 const term=keyword(r,'gibran · ijazah');assert.equal(term.count,2);assert.equal(term.context.title,title);assert.equal(term.context.url,origin.url);
 assert.ok(r.keywords.every(k=>!/(?:^|[ ·])(?:demi|apakah)(?:$|[ ·])/.test(k.key)));assert.ok(!keyword(r,'gibran'));
});

test('topical match and controversy must belong to the counted source, not different sources in one issue',()=>{
 const political=source('a','Presiden menghadiri pembukaan kantor',1);
 const financial=source('b','Warga menolak kenaikan pajak',1);
 const hidden=source('c','Politik Gibran dan ijazah dipersoalkan',1);
 const r=buildRadarTrends(data([issue('mixed',[political,financial]),issue('ignored',[hidden],{status:'ignored'})]),{now,topic:'politics'});
 assert.equal(r.sourceCount,0);assert.equal(r.keywords.length,0);
 assert.equal(buildRadarTrends(data([issue('mixed',[political,financial])]),{now,topic:'economy'}).sourceCount,1);
});

test('rolling boundaries include the current start and now, and never substitute discovery time',()=>{
 const sources=[0,24,48,49].map((age,i)=>source(String(i),'Politik Gibran dan ijazah dipersoalkan '+['alfa','beta','gama','delta'][i],age));
 sources.push(source('unknown','Politik Gibran dan ijazah dipersoalkan epsilon',0,{publishedAt:'invalid',discoveredAt:new Date(now).toISOString()}));
 const r=buildRadarTrends(data([issue('one',sources)]),{now});assert.equal(r.sourceCount,2);assert.equal(r.previousSourceCount,1);assert.equal(r.excluded.undated,1);
 const week=buildRadarTrends(data([issue('one',[source('a','Politik Gibran dan ijazah dipersoalkan',167),source('b','Politik Gibran dan ijazah dipersoalkan beta',168),source('c','Politik Gibran dan ijazah dipersoalkan gama',169)])]),{now,period:168});
 assert.equal(week.sourceCount,2);assert.equal(week.previousSourceCount,1);assert.equal(week.keywords[0].buckets.length,7);assert.equal(week.keywords[0].buckets[0].count,2);
});

test('validation and literal source text cannot create markup or fake keywords from scripts',()=>{
 assert.throws(()=>buildRadarTrends(data([]),{period:72,now}),/24 jam/);
 assert.throws(()=>buildRadarTrends(data([]),{topic:'missing',now}),/Topik tren/);
 assert.throws(()=>buildRadarTrends(data([]),{platform:'invalid',now}),/Platform/);
 const src=source('a','Politik Gibran dan ijazah dipersoalkan',1,{excerpt:'<script>fakekeyword</script><p>Publik menilai ijazah. Contohboilerplate</p>'});
 const r=buildRadarTrends(data([issue('one',[src])]),{now});assert.ok(!r.keywords.some(k=>k.key.includes('fakekeyword')||k.key.includes('contohboilerplate')||k.key.includes('dipersoalkan')));
});
