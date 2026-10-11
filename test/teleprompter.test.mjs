import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const code=await fs.readFile(new URL('../public/hub-teleprompter.js',import.meta.url),'utf8');
function fixture(){
  const listeners=new Set(),sent=[],notices=[],mounted=[],timers=new Map();let returned=0,removed=0;
  const child={postMessage:(...args)=>sent.push(args)},frame={contentWindow:child,focus:()=>{}},button={};
  const dialog={events:{},classList:{add:()=>{}},querySelector:s=>s==='iframe'?frame:button,setAttribute:()=>{},addEventListener:(name,fn)=>dialog.events[name]=fn,showModal:()=>dialog.open=true,close:()=>dialog.open=false,remove:()=>removed++};
  const context={document:{createElement:()=>dialog,body:{append:d=>mounted.push(d)}},location:{origin:'https://hub.test'},crypto:{randomUUID:()=> 'launch-token'},setTimeout:fn=>{timers.set(1,fn);return 1;},clearTimeout:id=>timers.delete(id),window:{addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)}};
  vm.runInNewContext(code,context);
  const emit=(origin,source,type,token='launch-token')=>{for(const fn of [...listeners])fn({origin,source,data:{type,token}});};
  return {open:script=>context.window.HubTeleprompter.open(script,msg=>notices.push(msg),()=>returned++),close:()=>context.window.HubTeleprompter.close(),emit,child,listeners,sent,notices,mounted,dialog,frame,button,timers,get returned(){return returned;},get removed(){return removed;}};
}
test('teleprompter transfers once to its exact same-origin reader frame with its launch token',()=>{
  const f=fixture(),script={id:'content-1',title:'Title',text:'Unsaved text'};
  f.open(script);script.text='Later change';
  assert.equal(f.mounted.length,1);assert.match(f.frame.src,/hub=launch-token&inline=1/);
  f.emit('https://other.test',f.child,'hub-teleprompter-ready');
  f.emit('https://hub.test',{},'hub-teleprompter-ready');
  f.emit('https://hub.test',f.child,'hub-teleprompter-ready','wrong-token');
  assert.equal(f.sent.length,0);
  f.emit('https://hub.test',f.child,'hub-teleprompter-ready');
  assert.equal(f.sent[0][0].script.text,'Unsaved text');assert.equal(f.sent[0][1],'https://hub.test');
  f.emit('https://hub.test',f.child,'hub-teleprompter-ready');assert.equal(f.sent.length,1);
  f.emit('https://other.test',f.child,'hub-teleprompter-loaded');assert.equal(f.timers.size,1);
  f.emit('https://hub.test',f.child,'hub-teleprompter-loaded');assert.equal(f.timers.size,0);assert.equal(f.listeners.size,1);
});
test('only a trusted close returns to the same content and releases its frame, timer and listener',()=>{
  const f=fixture();f.open({id:'1',text:'Script'});
  f.emit('https://other.test',f.child,'hub-teleprompter-close');
  f.emit('https://hub.test',{},'hub-teleprompter-close');
  f.emit('https://hub.test',f.child,'hub-teleprompter-close','wrong-token');assert.equal(f.returned,0);
  f.emit('https://hub.test',f.child,'hub-teleprompter-close');assert.equal(f.returned,1);assert.equal(f.removed,1);assert.equal(f.listeners.size,0);assert.equal(f.timers.size,0);assert.equal(f.sent.at(-1)[0].type,'hub-teleprompter-stop');
  f.close();f.dialog.events.close();assert.equal(f.returned,1);
});
test('empty scripts, repeated opens, Escape and loading timeouts do not leak reader sessions',()=>{
  const empty=fixture();assert.equal(empty.open({text:'  '}),null);assert.equal(empty.mounted.length,0);assert.equal(empty.listeners.size,0);
  const f=fixture();f.open({text:'A script'});f.open({text:'Another'});assert.equal(f.mounted.length,1);
  let prevented=false;f.dialog.events.cancel({preventDefault:()=>prevented=true});assert.equal(prevented,true);assert.equal(f.returned,1);assert.equal(f.listeners.size,0);
  const timeout=fixture();timeout.open({text:'A script'});[...timeout.timers.values()][0]();assert.match(timeout.notices[0],/belum dapat dimuat/);assert.equal(timeout.returned,1);assert.equal(timeout.listeners.size,0);assert.equal(timeout.dialog.open,false);
});
