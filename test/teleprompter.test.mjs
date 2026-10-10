import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const code=await fs.readFile(new URL('../public/hub-teleprompter.js',import.meta.url),'utf8');
function fixture(blocked=false){
  const listeners=new Set(),sent=[],notices=[],opened=[];
  const child={closed:false,postMessage:(...args)=>sent.push(args)};
  const context={location:{origin:'https://hub.test'},crypto:{randomUUID:()=> 'launch-token'},setTimeout:()=>1,clearTimeout:()=>{},window:{open:(...args)=>{opened.push(args);return blocked?null:child;},addEventListener:(_,fn)=>listeners.add(fn),removeEventListener:(_,fn)=>listeners.delete(fn)}};
  vm.runInNewContext(code,context);
  const emit=(origin,source,type,token='launch-token')=>{for(const fn of [...listeners])fn({origin,source,data:{type,token}});};
  return {open:script=>context.window.HubTeleprompter.open(script,msg=>notices.push(msg)),emit,child,listeners,sent,notices,opened};
}
test('teleprompter transfers only to the opened same-origin tab with the launch token',()=>{
  const f=fixture(),script={id:'content-1',title:'Title',text:'Unsaved text'};
  f.open(script);script.text='Later change';
  f.emit('https://other.test',f.child,'hub-teleprompter-ready');
  f.emit('https://hub.test',{},'hub-teleprompter-ready');
  f.emit('https://hub.test',f.child,'hub-teleprompter-ready','wrong-token');
  assert.equal(f.sent.length,0);
  f.emit('https://hub.test',f.child,'hub-teleprompter-ready');
  assert.equal(f.sent[0][0].script.text,'Unsaved text');assert.equal(f.sent[0][1],'https://hub.test');
  f.emit('https://other.test',f.child,'hub-teleprompter-loaded');assert.equal(f.listeners.size,1);
  f.emit('https://hub.test',f.child,'hub-teleprompter-loaded');assert.equal(f.listeners.size,0);
});
test('empty scripts and blocked popups do not leave transfer listeners',()=>{
  const empty=fixture();assert.equal(empty.open({text:'  '}),null);assert.equal(empty.opened.length,0);assert.equal(empty.listeners.size,0);
  const blocked=fixture(true);assert.equal(blocked.open({text:'A script'}),null);assert.equal(blocked.listeners.size,0);assert.match(blocked.notices[0],/Izinkan tab/);
});
