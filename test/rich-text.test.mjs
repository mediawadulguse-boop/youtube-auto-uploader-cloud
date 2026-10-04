import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {cleanRichHtml,richPlainText,safeLink} from '../rich-text.mjs';
import {NotesStore} from '../notes-store.mjs';
import {ContentStore} from '../content-store.mjs';

test('rich text strips executable markup and unsafe links while keeping approved formatting',()=>{
 const html=cleanRichHtml('<p onclick="evil()"><b>Tebal</b> <i>Miring</i><u>Garis</u><font size="5" color="red">Besar</font><a href="https://example.com?q=1&x=2">Link</a><a href="javascript:alert(1)">Bad</a><a href="//evil.com">Bad2</a><span style="background:url(file:///etc/passwd)" class="bad">Isi</span><script>evil()</script><img src=x onerror=evil()><svg onload=evil()></svg></p>');
 assert.ok(html.includes('<font size="5">Besar</font>'));assert.ok(html.includes('rel="noopener noreferrer"'));assert.ok(html.includes('<b>Tebal</b>'));
 assert.ok(!/onclick|javascript:|evil\(|<img|<svg|style=|class=|color=|\/\/evil.com/.test(html));
 assert.equal(safeLink('data:text/html,evil'),'');assert.equal(safeLink('https://example.com'),'https://example.com/');assert.equal(safeLink('mailto:hello@example.com'),'mailto:hello@example.com');
 assert.equal(richPlainText('<p>Halo <b>🌟</b></p><p>Baris 2<br>Baris 3</p>'),'Halo 🌟\nBaris 2\nBaris 3');
 assert.equal(richPlainText('akhir\n'),'akhir\n');assert.equal(richPlainText('A &amp; B'),'A & B');
});
test('Note formatting survives restart, duplicate fields, format-only revisions and plain client updates',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rich-note-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'notes.json'),store=new NotesStore(file);
 let note=await store.create({title:'Note',body:'stale',bodyHtml:'<p><b>Isi</b> <a href="https://example.com">link</a></p>'});assert.equal(note.body,'Isi link');
 assert.equal((await new NotesStore(file).read()).notes[0].bodyHtml,note.bodyHtml);
 const copy=await store.create({...note,title:'Salinan'});assert.equal(copy.bodyHtml,note.bodyHtml);
 note=await store.update(note.id,{revision:note.revision,bodyHtml:'<i>Isi</i> link'});assert.equal(note.revision,2);assert.equal(note.body,'Isi link');
 await assert.rejects(store.update(note.id,{revision:1,bodyHtml:'<b>Stale</b>'}),e=>e.status===409);
 note=await store.update(note.id,{revision:note.revision,body:'Teks biasa\n'});assert.equal(note.bodyHtml,'');assert.equal(note.body,'Teks biasa\n');
 note=await store.update(note.id,{revision:note.revision,bodyHtml:'x'.repeat(160001)});assert.equal(note.body,'x'.repeat(160001));
 await assert.rejects(store.create({title:' ',bodyHtml:'<b></b>'}),e=>e.status===400);
});
test('content rich fields preserve history, restore legacy text, duplicate and reject invalid maps',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rich-content-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const store=new ContentStore(path.join(dir,'contents.json'));
 let c=await store.create({title:'Naskah',script:'Asli\n',html:'<b>ignored</b>'});assert.equal(c.script,'Asli\n');
 c=await store.update(c.id,{revision:1,richText:{script:'<b>Revisi</b>',hook:'<font size="5">HOOK</font>'}});assert.equal(c.script,'Revisi');assert.equal(c.hook,'HOOK');assert.equal(c.history[0].script,'Asli\n');
 const copy=await store.duplicate(c.id);assert.deepEqual(copy.richText,c.richText);assert.equal(copy.script,'Revisi');
 c=await store.update(c.id,{revision:2,restoreRevision:1});assert.equal(c.script,'Asli\n');assert.deepEqual(c.richText,{});
 c=await store.update(c.id,{revision:3,restoreRevision:2});assert.equal(c.richText.script,'<b>Revisi</b>');
 c=await store.update(c.id,{revision:4,script:'Plain'});assert.equal(c.richText.script,undefined);assert.equal(c.richText.hook,'<font size="5">HOOK</font>');
 await assert.rejects(store.update(c.id,{revision:5,richText:{title:'<b>No</b>'}}),e=>e.status===400);
 await assert.rejects(store.update(c.id,{revision:5,richText:{script:false}}),e=>e.status===400);
 c=await store.update(c.id,{revision:5,richText:{hook:'x'.repeat(5001)}});assert.equal(c.hook,'x'.repeat(5001));
});
