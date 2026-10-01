import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ContentStore} from '../content-store.mjs';
import {NotesStore} from '../notes-store.mjs';
async function temporary(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yt-workspace-'));try{await fn(dir)}finally{await fs.rm(dir,{recursive:true,force:true})}}
test('v1 migration backs up original once; custom column deletion preserves scripts, archives and history',()=>temporary(async dir=>{
 const file=path.join(dir,'contents.json'),seed=new ContentStore(file);
 const a=await seed.create({title:'Episode',stage:'script',script:'Naskah\n🌟',sources:[{notes:'Riset',verified:true}],plannedPublishAt:'2026-10-10T02:00:00Z'});
 const b=await seed.create({title:'Arsip',stage:'script',archived:true,script:'Tetap simpan'});
 const legacy=await seed.read();legacy.version=1;delete legacy.columns;delete legacy.boardRevision;
 const original=JSON.stringify(legacy);await fs.writeFile(file,original);const store=new ContentStore(file);
 assert.equal((await store.read()).version,2);assert.equal(await fs.readFile(file,'utf8'),original);
 const added=await store.saveColumn({boardRevision:1,name:'Riset detail',color:'#123456',icon:'eye',isDone:false});
 assert.equal(await fs.readFile(path.join(dir,'contents.v1.backup.json'),'utf8'),original);
 const order=[added.column.id,...added.columns.filter(c=>c.id!==added.column.id).map(c=>c.id)];await store.reorderColumns({boardRevision:2,ids:order});
 assert.equal((await store.create({title:'Default'})).stage,added.column.id);
 assert.equal((await store.duplicate(a.id)).stage,added.column.id);
 await assert.rejects(store.saveColumn({boardRevision:2,name:'Stale'}),e=>e.status===409);
 const removed=await store.removeColumn('script',{boardRevision:3,moveTo:added.column.id});assert.equal(removed.moved,2);
 const db=await new ContentStore(file).read(),card=db.contents.find(c=>c.id===a.id),archive=db.contents.find(c=>c.id===b.id);
 assert.equal(card.stage,added.column.id);assert.equal(card.script,a.script);assert.deepEqual(card.sources,a.sources);assert.equal(card.plannedPublishAt,a.plannedPublishAt);assert.equal(archive.archived,true);assert.equal(card.revision,2);
 await assert.rejects(store.update(a.id,{revision:1,script:'Stale tab'}),e=>e.status===409);
 const restored=await store.update(a.id,{revision:2,restoreRevision:1});assert.equal(restored.stage,added.column.id);assert.equal(restored.script,a.script);
 assert.equal(await fs.readFile(path.join(dir,'contents.v1.backup.json'),'utf8'),original);
}));
test('column validation, minimum/maximum, revision serialization and corrupted schema fail closed',()=>temporary(async dir=>{
 const file=path.join(dir,'contents.json'),store=new ContentStore(file);const before=await store.read();
 await assert.rejects(store.saveColumn({boardRevision:1,name:' ',color:'red'}),e=>e.status===400);
 await assert.rejects(store.reorderColumns({boardRevision:1,ids:['idea','idea']}),e=>e.status===400);
 assert.deepEqual(await store.read(),before);
 const results=await Promise.allSettled(['A','B'].map(name=>store.saveColumn({boardRevision:1,name,color:'#123456',icon:'check',isDone:true})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
 let db=await store.read();while(db.columns.length>1){await store.removeColumn(db.columns.at(-1).id,{boardRevision:db.boardRevision,moveTo:db.columns[0].id});db=await store.read()}
 await assert.rejects(store.removeColumn(db.columns[0].id,{boardRevision:db.boardRevision,moveTo:'idea'}),e=>e.status===400);
 while(db.columns.length<24){await store.saveColumn({boardRevision:db.boardRevision,name:'Extra'});db=await store.read()}
 await assert.rejects(store.saveColumn({boardRevision:db.boardRevision,name:'Overflow'}),e=>e.status===400);
 delete db.columns[0].name;const corrupt=JSON.stringify(db);await fs.writeFile(file,corrupt);const bad=new ContentStore(file);await assert.rejects(bad.create({title:'Overwrite'}),e=>e.status===503);assert.equal(await fs.readFile(file,'utf8'),corrupt);
}));
test('Notes keep multiline prompts, survive restart, reject stale edits/deletes and preserve failed writes',()=>temporary(async dir=>{
 const file=path.join(dir,'notes.json'),store=new NotesStore(file);
 const notes=await Promise.all(Array.from({length:8},(_,i)=>store.create({title:'Prompt '+i,kind:'prompt',body:'baris 1\nbaris 2 🌟\n<script>literal</script>',tags:[' ide ','ide','riset']})));
 assert.equal((await new NotesStore(file).read()).notes.length,8);assert.deepEqual(notes[0].tags,['ide','riset']);
 const edits=await Promise.allSettled(['A','B'].map(title=>store.update(notes[0].id,{revision:1,title,pinned:true,archived:true})));
 assert.equal(edits.filter(r=>r.status==='fulfilled').length,1);assert.equal(edits.find(r=>r.status==='rejected').reason.status,409);
 const note=edits.find(r=>r.status==='fulfilled').value;assert.equal(note.body,notes[0].body);assert.equal(note.archived,true);assert.equal((await store.update(note.id,{revision:2,title:note.title})).revision,2);
 await assert.rejects(store.remove(note.id,1),e=>e.status===409);await assert.rejects(store.update(note.id,{revision:2,tags:Array(13).fill('x')}),e=>e.status===400);
 await store.remove(note.id,2);assert.equal((await new NotesStore(file).read()).notes.length,7);
 await fs.writeFile(file,'{broken');await assert.rejects(new NotesStore(file).create({title:'No overwrite'}),e=>e.status===503);assert.equal(await fs.readFile(file,'utf8'),'{broken');
}));
test('custom Note categories persist, deduplicate concurrent writes and preserve legacy Notes',()=>temporary(async dir=>{
 const file=path.join(dir,'notes.json'),legacy={version:1,notes:[{id:'legacy',title:'Simpan',body:'Isi asli\n🌟',kind:'prompt',tags:['ide'],pinned:true,archived:false,revision:7,createdAt:'2026-10-01',updatedAt:'2026-10-01'}]};const original=JSON.stringify(legacy);await fs.writeFile(file,original);
 const store=new NotesStore(file);const before=await store.read();assert.equal(before.notes[0].category,'');assert.equal(before.notes[0].body,legacy.notes[0].body);assert.equal(before.notes[0].revision,7);assert.equal(await fs.readFile(file,'utf8'),original);
 await Promise.all([' Riset ','riset','RISET'].map(name=>store.createCategory({name})));assert.deepEqual((await store.read()).categories,['Riset']);
 const changed=await store.update('legacy',{revision:7,category:'riset'});assert.equal(changed.category,'Riset');assert.equal(changed.revision,8);assert.equal(changed.body,legacy.notes[0].body);assert.equal(changed.kind,'prompt');
 const note=await store.create({title:'New',category:'Produksi'});assert.equal(note.category,'Produksi');assert.equal((await store.update(note.id,{revision:1,category:'produksi'})).revision,1);
 const cleared=await store.update(note.id,{revision:1,category:''});assert.equal(cleared.category,'');const restart=await new NotesStore(file).read();assert.deepEqual(restart.categories,['Riset','Produksi']);assert.equal(restart.notes.find(n=>n.id==='legacy').body,legacy.notes[0].body);
 await assert.rejects(store.createCategory({name:' '}),e=>e.status===400);await assert.rejects(store.create({title:'Invalid',category:'x'.repeat(61)}),e=>e.status===400);await assert.rejects(store.update('legacy',{revision:7,category:'Stale'}),e=>e.status===409);assert.ok(!(await store.read()).categories.includes('Stale'));
}));
