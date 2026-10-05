import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const code=await fs.readFile('public/radar.js','utf8');
function setup(){
 const buttons=['daily','weekly'].map(period=>({dataset:{executivePeriod:period},classList:{toggle(){}},setAttribute(k,v){this[k]=v;}})),body={innerHTML:'',dataset:{},isConnected:true},front={querySelectorAll:()=>buttons},requests=[],bound=[];
 const context={URLSearchParams,Date,radarUi:{data:{issues:[],sync:{}},topic:'topic1',q:'perusahaan',status:'',platform:''},$:id=>id==='#radarExecutiveFrontBody'?body:front,esc:v=>String(v).replaceAll('<','&lt;'),rDate:String,radarExecutiveReport:s=>'Summary:'+s.overview,radarBindExecutive:(s,node)=>bound.push({s,node}),api:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})),clearTimeout(){},setTimeout(){}};vm.createContext(context);vm.runInContext(code.slice(code.indexOf('function radarInlineSchedule('),code.indexOf('function radarBindExecutive(')),context);
 return {context,buttons,body,front,requests,bound};
}
test('front summary loads the daily report directly, follows filters, and caches unchanged results',async()=>{
 const {context,requests,body,bound,buttons}=setup(),loading=context.radarInlineLoad();assert.equal(requests.length,1);assert.match(requests[0].url,/period=daily/);assert.match(requests[0].url,/topic=topic1/);assert.match(requests[0].url,/q=perusahaan/);
 requests[0].resolve({startAt:'start',throughAt:'end',partial:true,executive:{overview:'Daily'}});await loading;assert.match(body.innerHTML,/Summary:Daily/);assert.equal(bound[0].node,body);assert.equal(buttons[0]['aria-selected'],'true');await context.radarInlineLoad();assert.equal(requests.length,1);
 context.radarUi.q='changed';const changed=context.radarInlineLoad();assert.equal(requests.length,2);requests[1].resolve({executive:{overview:'Changed'}});await changed;assert.match(body.innerHTML,/Changed/);
});
test('switching to weekly prevents late daily responses from overwriting the selected report',async()=>{
 const {context,requests,body,buttons}=setup(),daily=context.radarInlineLoad();context.radarUi.executivePeriod='weekly';const weekly=context.radarInlineLoad();assert.match(requests[1].url,/period=weekly/);
 requests[1].resolve({executive:{overview:'Weekly'}});await weekly;requests[0].resolve({executive:{overview:'Late daily'}});await daily;assert.match(body.innerHTML,/Weekly/);assert.doesNotMatch(body.innerHTML,/Late daily/);assert.equal(buttons[1]['aria-selected'],'true');
});
test('inline summary safely displays errors and ignores responses after leaving the page',async()=>{
 const {context,requests,body}=setup(),failed=context.radarInlineLoad();requests[0].reject(Error('<failed>'));await failed;assert.match(body.innerHTML,/&lt;failed>/);assert.match(body.innerHTML,/data-executive-retry/);
 const pending=context.radarInlineLoad();body.isConnected=false;const before=body.innerHTML;requests[1].resolve({executive:{overview:'Detached'}});await pending;assert.equal(body.innerHTML,before);
});
