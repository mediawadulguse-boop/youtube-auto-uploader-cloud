import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {cleanRichHtml,richPlainText} from '../rich-text.mjs';
import {ContentStore} from '../content-store.mjs';
const context={window:{}};
vm.runInNewContext(await fs.readFile(new URL('../public/script-format.js',import.meta.url),'utf8'),context);
const render=context.window.HubScriptFormat.render;

test('AI storyboard displays two real columns, bold chapter labels and complete narrative',()=>{
 const html=render('## NASKAH LENGKAP\n\n| ASET VISUAL | NARASI VOICE OVER |\n| :--- | ---: |\n| **BAB 1** | Paragraf *narasi*, lengkap. |\n| Teks \\| layar | Bab berikutnya. |\n\nPenutup.');
 assert.match(html,/<h3>NASKAH LENGKAP<\/h3>/);assert.match(html,/<thead><tr><th>ASET VISUAL<\/th><th>NARASI VOICE OVER<\/th>/);
 assert.match(html,/<td><strong>BAB 1<\/strong><\/td>/);assert.match(html,/<em>narasi<\/em>/);assert.match(html,/Teks \| layar/);
 assert.match(html,/<p>Penutup\.<\/p>$/);assert.doesNotMatch(html,/---:/);
});
test('AI formatting cannot introduce executable HTML, links or malformed table data loss',()=>{
 const html=render('<img src=x onerror=evil()>\n\n**<script>evil()</script>**\n\n| A | B |\n| --- | --- |\n| one | two | extra |\n\n1. Un\n2. Deux');
 assert.doesNotMatch(html,/<img|<script|href=|onerror="/);assert.match(html,/&lt;img/);assert.match(html,/one \| two \| extra/);assert.match(html,/<ol><li>Un<\/li><li>Deux<\/li><\/ol>/);
 assert.equal(render('A & B\nbaris kedua'),'<p>A &amp; B<br>baris kedua</p>');
});
test('formatted AI table survives save, restart and duplicate with searchable plain text',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'script-format-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'contents.json'),store=new ContentStore(file);
 const html=cleanRichHtml(render('| Visual | Narasi |\n| --- | --- |\n| **BAB 1** | Kalimat lengkap. |'));
 const content=await store.create({title:'Naskah',richText:{script:html}});
 assert.match(content.richText.script,/<table>/);assert.equal(content.script,'Visual\tNarasi\nBAB 1\tKalimat lengkap.');
 assert.equal(richPlainText(html),content.script);const copy=await new ContentStore(file).duplicate(content.id);assert.equal(copy.script,content.script);assert.equal(copy.richText.script,html);
 const sanitized=cleanRichHtml('<table onclick="evil()"><tr><td style="color:red"><img src=x onerror="evil()">Isi</td></tr></table>');
 assert.equal(sanitized,'<table><tr><td>Isi</td></tr></table>');
});
