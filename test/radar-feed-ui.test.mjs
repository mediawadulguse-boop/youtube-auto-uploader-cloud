import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../public/radar.js',import.meta.url),'utf8');
const methods=source.slice(source.indexOf('function radarRating('),source.indexOf('const rDialog='));
const ctx={};vm.createContext(ctx);vm.runInContext(methods,ctx);
const item=(id,score,isHot,status='new')=>({id,title:'Judul '+id,status,topicIds:['system'],sources:[{title:'Varian sumber '+id,publisher:'Media '+id}],stats:{score,rating:isHot?4:2,isHot,latestPublishedAt:'2026-10-02T12:00:00Z'}});
test('main Radar displays only qualifying hot groups and orders score descending',()=>{
 const data={issues:[item('cold',25,false),item('hot',79,true),item('ignored',95,true,'ignored'),item('discussed',95,true,'discussed'),item('top',95,true)],hotIssues:null};
 assert.deepEqual(Array.from(ctx.radarVisibleIssues(data,'issues'),i=>i.id),['top','hot']);
 assert.deepEqual(Array.from(ctx.radarVisibleIssues(data,'issues',{q:'varian sumber hot'}),i=>i.id),['hot']);
 assert.equal(ctx.radarVisibleIssues(data,'issues',{topic:'different'}).length,0);
});
test('saved references survive a low rating, while searching cannot expose cold imports on the hot page',()=>{
 const saved=item('saved',10,false,'saved'),data={issues:[saved,item('cold',10,false),item('hot',79,true)],hotIssues:[item('hot',79,true)]};
 assert.deepEqual(Array.from(ctx.radarVisibleIssues(data,'references'),i=>i.id),['saved']);assert.equal(ctx.radarVisibleIssues(data,'issues',{q:'cold'}).length,0);
 const html=ctx.radarRating({rating:4,score:79});assert.match(html,/★★★★☆/);assert.match(html,/4\/5/);assert.match(html,/79\/100/);assert.match(html,/aria-label/);
});
