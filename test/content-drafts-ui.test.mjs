import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const code=await fs.readFile(new URL('../public/content.js',import.meta.url),'utf8');
function setup(initial={}){
 const values=new Map(Object.entries(initial)),nodes=new Map(),events={},calls=[];
 const node=id=>{if(!nodes.has(id)){const classes=new Set();nodes.set(id,{textContent:'',scrollIntoView(){},classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle(c,on){if(on===undefined)on=!classes.has(c);on?classes.add(c):classes.delete(c);}}});}return nodes.get(id);};
 const localStorage={get length(){return values.size;},key:i=>[...values.keys()][i],getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
 const context={localStorage,$:node,hub:{loaded:true,data:{contents:[]},editing:null},window:{addEventListener:(event,fn)=>events[event]=fn},toast:()=>{},confirm:()=>true,api:async url=>{calls.push(url);throw Error('offline');},openContent:async()=>{},newContent:async()=>{}};
 vm.createContext(context);vm.runInContext(code.slice(code.indexOf('const draftChecks='),code.indexOf('function navigate(')),context);return {context,values,node,calls,events};
}
const draft=(id='draft-a',extra={})=>({id,revision:1,at:1,isNew:true,epoch:1,fields:{title:'Naskah lokal',script:'Teks belum tersimpan'},...extra});
const record=d=>({['yt-hub-draft-'+d.id]:JSON.stringify(d)});
test('ignores empty and malformed records, deduplicates pending copies and picks the newest valid draft',()=>{
 const a=draft(),b=draft('draft-b',{at:5});const {context,values}=setup({...record(a),...record(b),'yt-hub-pending':JSON.stringify({...a,at:0}),'yt-hub-draft-empty':JSON.stringify(draft('empty',{fields:{title:'',script:'',sources:[{label:'',url:'',notes:''}]}})),'yt-hub-draft-invalid':'{broken'});
 assert.equal(context.localDrafts().length,2);assert.equal(context.storedDraft().id,b.id);assert.equal(context.storedDraft(a.id).at,1);assert.equal(context.storedDraft('missing'),null);assert.ok(values.has('yt-hub-draft-invalid'));assert.equal(context.draftHasContent({hook:'Hook belum tersimpan'}),true);
});
test('dismissal survives reload without deleting text, latest edits reappear and Draft lokal reopens notification',()=>{
 const d=draft(),{context,values,node}=setup(record(d));context.showDraftBanner();assert.equal(node('#draftBanner').classList.contains('hide'),false);assert.match(node('#draftBannerText').textContent,/Naskah lokal/);node('#dismissDraft').onclick();assert.equal(node('#draftBanner').classList.contains('hide'),true);assert.ok(values.has('yt-hub-draft-'+d.id));
 const restarted=setup(Object.fromEntries(values));restarted.context.showDraftBanner();assert.equal(restarted.node('#draftBanner').classList.contains('hide'),true);restarted.node('#localDrafts').onclick();assert.equal(restarted.node('#draftBanner').classList.contains('hide'),false);
 context.localStorage.setItem('yt-hub-draft-'+d.id,JSON.stringify({...d,epoch:2,fields:{...d.fields,script:'Versi baru'}}));context.showDraftBanner();assert.equal(node('#draftBanner').classList.contains('hide'),false);
});
test('discard requires explicit confirmation, removes only the selected draft, and refuses a stale delete action',()=>{
 const a=draft(),b=draft('draft-b',{at:2}),{context,values,node}=setup({...record(a),...record(b),'yt-hub-pending':JSON.stringify(b),'other-app':'keep'});context.showDraftBanner();context.confirm=()=>false;node('#discardDraft').onclick();assert.ok(values.has('yt-hub-draft-'+b.id));context.confirm=()=>true;node('#discardDraft').onclick();assert.ok(!values.has('yt-hub-draft-'+b.id));assert.ok(!values.has('yt-hub-pending'));assert.ok(values.has('yt-hub-draft-'+a.id));assert.equal(values.get('other-app'),'keep');
 const click=node('#discardDraft').onclick;context.localStorage.setItem('yt-hub-draft-'+a.id,JSON.stringify({...a,at:3}));click();assert.ok(values.has('yt-hub-draft-'+a.id));
});
test('reconciliation removes only exact server duplicates and preserves unsaved older revisions and failed requests',async()=>{
 const same=draft('saved',{isNew:false,fields:{title:'Konten',script:'Sudah tersimpan',checklist:{video:false,script:true}}}),changed=draft('changed',{isNew:false,fields:{title:'Konten',script:'Perubahan penting'}}),offline=draft('offline',{isNew:false});const {context,values,calls}=setup({...record(same),...record(changed),...record(offline),'yt-hub-pending':JSON.stringify(same)});context.hub.data.contents=[same,changed,offline].map(d=>({id:d.id,revision:2}));
 context.api=async url=>{calls.push(url);if(url.endsWith('offline'))throw Error('offline');return {content:{id:url.split('/').at(-1),revision:2,title:'Konten',script:'Sudah tersimpan',checklist:{script:true,video:false}}};};await context.reconcileLocalDrafts();assert.ok(!values.has('yt-hub-draft-saved'));assert.ok(!values.has('yt-hub-pending'));assert.ok(values.has('yt-hub-draft-changed'));assert.ok(values.has('yt-hub-draft-offline'));await context.reconcileLocalDrafts();assert.equal(calls.filter(u=>u.endsWith('changed')).length,1);
});
test('a delayed server read cannot remove a newer draft or an active editor draft',async()=>{
 const d=draft('saved',{isNew:false}),{context,values,node}=setup(record(d));context.hub.data.contents=[{id:d.id,revision:1}];let resolve;context.api=()=>new Promise(r=>resolve=r);const pending=context.reconcileLocalDrafts();context.localStorage.setItem('yt-hub-draft-'+d.id,JSON.stringify({...d,epoch:2,fields:{...d.fields,script:'Ketikan baru'}}));resolve({content:{...d.fields,revision:1}});await pending;assert.match(values.get('yt-hub-draft-'+d.id),/Ketikan baru/);
 context.hub.editing={content:{id:d.id}};context.showDraftBanner();assert.equal(node('#draftBanner').classList.contains('hide'),true);let calls=0;context.api=()=>{calls++;};await context.reconcileLocalDrafts();assert.equal(calls,0);
});
test('typing during save retains the newer recovery copy if the subsequent save fails',async()=>{
 const d=draft('saved',{isNew:false}),{context,values}=setup(record(d));let fields={title:'Konten',script:'Versi pertama',sources:[],assets:[]},resolve,calls=0;
 context.hub.editing={content:{id:d.id,revision:1,sources:[],assets:[]},dirty:true,isNew:false,epoch:1};Object.assign(context,{clearTimeout:()=>{},readForm:()=>structuredClone(fields),renderEditorMeta:()=>{},loadHub:async()=>{},showConflict:()=>{},api:async()=>{calls++;if(calls===1)return new Promise(r=>resolve=r);throw Error('network failed');}});
 vm.runInContext(code.slice(code.indexOf('async function flushSave('),code.indexOf("$('#saveContent').onclick")),context);const saving=context.flushSave();fields.script='Versi terbaru';context.hub.editing.epoch=2;context.localStorage.setItem('yt-hub-draft-'+d.id,JSON.stringify({...d,epoch:2,fields}));resolve({content:{id:d.id,revision:2,sources:[],assets:[],title:'Konten'}});assert.equal(await saving,false);const retained=JSON.parse(values.get('yt-hub-draft-'+d.id));assert.equal(retained.fields.script,'Versi terbaru');assert.equal(retained.revision,2);assert.equal(context.hub.editing.dirty,true);
});
test('dismissal still works for the current session when browser storage is full',()=>{
 const {context,node,values}=setup(record(draft()));context.localStorage.setItem=()=>{throw Error('QuotaExceededError');};context.showDraftBanner();node('#dismissDraft').onclick();context.showDraftBanner();assert.equal(node('#draftBanner').classList.contains('hide'),true);assert.ok(values.has('yt-hub-draft-draft-a'));node('#localDrafts').onclick();assert.equal(node('#draftBanner').classList.contains('hide'),false);
});
test('creating content migrates an in-flight draft to the server ID without losing newer edits',async()=>{
 const d=draft(),{context,values}=setup(record(d));let fields={title:'Konten',script:'Versi pertama',sources:[],assets:[]},resolve,calls=0;context.hub.editing={content:{id:d.id,revision:0,sources:[],assets:[]},dirty:true,isNew:true,epoch:1};Object.assign(context,{clearTimeout:()=>{},readForm:()=>structuredClone(fields),renderEditorMeta:()=>{},loadHub:async()=>{},showConflict:()=>{},api:async()=>{calls++;if(calls===1)return new Promise(r=>resolve=r);throw Error('network failed');}});
 vm.runInContext(code.slice(code.indexOf('async function flushSave('),code.indexOf("$('#saveContent').onclick")),context);const saving=context.flushSave();fields.script='Ketikan selama POST';context.hub.editing.epoch=2;resolve({content:{id:'server-id',revision:1,sources:[],assets:[],title:'Konten'}});assert.equal(await saving,false);assert.ok(!values.has('yt-hub-draft-'+d.id));const retained=JSON.parse(values.get('yt-hub-draft-server-id'));assert.equal(retained.fields.script,'Ketikan selama POST');assert.equal(retained.isNew,false);assert.equal(JSON.parse(values.get('yt-hub-pending')).id,'server-id');
});
