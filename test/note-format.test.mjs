import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {NotesStore} from '../notes-store.mjs';
test('Long/Short classification persists, keeps custom categories and rich text, duplicates and clears explicitly',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'note-format-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'notes.json'),store=new NotesStore(file);
 await store.createCategory({name:'Riset'});let note=await store.create({title:'Netflix',category:'Riset',format:'long',bodyHtml:'<b>Naskah aman</b>'});assert.equal(note.format,'long');assert.equal((await new NotesStore(file).read()).notes[0].format,'long');
 note=await store.update(note.id,{revision:1,format:'shorts'});assert.equal(note.revision,2);assert.equal(note.category,'Riset');assert.equal(note.bodyHtml,'<b>Naskah aman</b>');const copy=await store.create({...note,title:'Salinan'});assert.equal(copy.format,'shorts');
 await assert.rejects(store.update(note.id,{revision:1,format:'long'}),e=>e.status===409);note=await store.update(note.id,{revision:2,format:''});assert.equal(note.format,'');assert.equal((await store.update(note.id,{revision:3,format:''})).revision,3);
 for(const format of ['other','short',null,1,{}])await assert.rejects(store.create({title:'Invalid',format}),e=>e.status===400);
 const blank=await store.create({title:'Belum dipilih'});assert.equal(blank.format,'');assert.deepEqual((await store.read()).categories,['Riset']);
});
test('legacy Notes stay unclassified without rewriting or revising on read or an unchanged save',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'legacy-format-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'notes.json'),old={id:'legacy',title:'Lama',body:'Isi',bodyHtml:'',kind:'note',category:'',tags:[],pinned:false,archived:false,revision:7};const raw=JSON.stringify({version:1,categories:[],categoriesRevision:1,notes:[old]});await fs.writeFile(file,raw);const store=new NotesStore(file);assert.equal((await store.read()).notes[0].format,undefined);assert.equal(await fs.readFile(file,'utf8'),raw);assert.equal((await store.update(old.id,{revision:7,title:'Lama',format:''})).revision,7);
});
