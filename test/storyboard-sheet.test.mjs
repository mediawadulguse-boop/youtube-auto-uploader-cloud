import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';import os from 'node:os';import path from 'node:path';
import {ContentStore} from '../content-store.mjs';import {cleanRichHtml,richPlainText} from '../rich-text.mjs';
const context={window:{}};vm.runInNewContext(await fs.readFile(new URL('../public/storyboard.js',import.meta.url),'utf8'),context);const sheet=context.window.HubStoryboard,plain=value=>JSON.parse(JSON.stringify(value));
const rows=[['00:00:00–00:00:03','3 detik','Menurut sumber, angka belum berubah.','[DOK] Dokumen perlu dicari','Punch-in Zoom 115%; SFX paper rustle'],['00:00:03–00:00:06','3s','Periksa dokumen tahun 2026.','[MOTION] Angka 2026','Text Pop-up; SFX click']];
test('Markdown and spreadsheet preserve full narration, escaped pipes and multiline cells',()=>{
 const source=structuredClone(rows);source[0][2]='Menurut sumber: A | B.\nAngka belum berubah.';source[1][4]='SFX "click"\tText Pop-up';
 assert.deepEqual(plain(sheet.importRows(sheet.markdown(source))),source);assert.deepEqual(plain(sheet.importRows(sheet.tsv(source))),source);
 assert.deepEqual(plain(sheet.parseTSV('"baris satu\nbaris dua"\t"kata ""asli"""\r\nakhir\t2026')), [['baris satu\nbaris dua','kata "asli"'],['akhir','2026']]);
 assert.throws(()=>sheet.parseTSV('"belum selesai\t2026'),/belum ditutup/);assert.throws(()=>sheet.importRows('Narasi\tVisual\npendek\taset'),/enam kolom/);
});
test('duration requires concrete values and computes cumulative fractional time without trimming data',()=>{
 for(const [value,expected] of [['3.5 detik',3.5],['3,5s',3.5],['1 menit 5 detik',65],['00:01:05',65],['01:05',65],['7',7]])assert.equal(sheet.seconds(value),expected);
 for(const value of ['','3–7 detik','5 detik lebih','00:99','-5','9'.repeat(400)])assert.equal(sheet.seconds(value),null);
 assert.deepEqual(plain(sheet.duration(rows)),{seconds:6,complete:true});assert.equal(sheet.duration([['','',...rows[0].slice(2)]]).complete,false);assert.equal(sheet.duration([['','0',...rows[0].slice(2)]]).complete,false);assert.equal(sheet.clock(65.25),'00:01:05.250');
});
test('rectangle paste extends rows without overwriting unrelated columns or the original snapshot',()=>{
 const input=structuredClone(rows),patched=sheet.patch(input,1,2,[['Narasi baru','[ARSIP] Headline'],['2026','[MOTION] Teks']]);
 assert.equal(patched[0][2],rows[0][2]);assert.equal(patched[1][0],rows[1][0]);assert.equal(patched[1][4],rows[1][4]);assert.deepEqual(plain(patched[2]),['','','2026','[MOTION] Teks','']);assert.deepEqual(input,rows);
 assert.throws(()=>sheet.patch(input,0,4,[['teks','luar kolom']]),/melebihi kolom/);assert.deepEqual(input,rows);
});
test('cell HTML is literal and spreadsheet exports neutralize formula cells',()=>{
 const input=structuredClone(rows);input[0][2]='<img src=x onerror=evil()>\n2026';input[1][4]='=HYPERLINK("https://example.test")';
 const html=sheet.html(input,'<p>Catatan lama</p>');assert.doesNotMatch(html,/<img|onerror="/);assert.match(html,/&lt;img/);assert.match(html,/2026<\/td>/);assert.match(html,/<p>Catatan lama<\/p>$/);assert.match(sheet.tsv(input,true),/'=HYPERLINK/);assert.deepEqual(plain(sheet.importRows(sheet.tsv(input))),input);
});
test('long storyboard cells, legacy notes, script and history survive save, reload and duplication',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'storyboard-sheet-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'contents.json'),store=new ContentStore(file),script=rows.map(row=>row[2]).join('\n'),legacy='<p>Lokasi <strong>Jember</strong> dan izin footage.</p>',saved=await store.create({title:'Storyboard produksi',script,richText:{productionNotes:legacy}});
 const input=structuredClone(rows);input[0][3]='[DOK] '+ 'Bahan utuh '.repeat(6000)+'AKHIR';const html=cleanRichHtml(sheet.html(input,legacy));const updated=await store.update(saved.id,{revision:saved.revision,richText:{productionNotes:html}});assert.equal(updated.script,script);assert.equal(updated.productionNotes,richPlainText(html));assert.match(updated.productionNotes,/AKHIR/);assert.equal(updated.history.at(-1).richText.productionNotes,legacy);
 const restarted=new ContentStore(file),copy=await restarted.duplicate(saved.id);assert.equal(copy.script,script);assert.equal(copy.richText.productionNotes,html);assert.match(copy.richText.productionNotes,/<strong>Jember<\/strong>/);
});
test('CSV imports quoted narration, commas, doubled quotes and multiline editing without clipping',()=>{
 const input=structuredClone(rows);input[0][2]='Menurut sumber, "angka" belum berubah.\nNarasi kedua | tetap.';input[1][4]='CapCut: SFX "click", paper rustle\nKlip berikutnya.';
 const table=[['No','Timecode','Durasi','Narasi','Visual','Editing'],...input.map((row,i)=>[String(i+1),...row])];
 const csv=table.map(row=>row.map(cell=>'"'+cell.replace(/"/g,'""')+'"').join(',')).join('\r\n');
 assert.deepEqual(plain(sheet.importRows('\uFEFF'+csv)),input);assert.deepEqual(plain(sheet.parseDelimited(csv,',')),table);
});
test('semicolon CSV and reordered friendly headers map each field to its intended column',()=>{
 const csv='Narasi;No;Visual;Timecode;Editing;Durasi\n"Narasi asli, utuh.";1;[DOK] Sumber;00:00;SFX click;3,5 detik';
 assert.deepEqual(plain(sheet.importRows(csv)),[['00:00','3,5 detik','Narasi asli, utuh.','[DOK] Sumber','SFX click']]);
 const markdown='| No | Timecode | Durasi | VO | Visual | Editing |\n| --- | --- | --- | --- | --- | --- |\n| 1 | 00:00 | 5s | Narasi utuh. | [DOK] Sumber | SFX click |';
 assert.deepEqual(plain(sheet.importRows(markdown)),[['00:00','5s','Narasi utuh.','[DOK] Sumber','SFX click']]);
});
test('incomplete CSV, broken quotes and plain prose cannot silently become imported shots',()=>{
 for(const text of ['No,Timecode,Durasi,Narasi,Visual,Editing\n1,00:00,5s,Narasi,[DOK] Sumber','1,00:00,5s,Narasi,[DOK] Sumber,SFX click,Kolom tambahan','Narasi saja tanpa tabel','No,Timecode,Durasi,Narasi,Visual,Editing'])assert.throws(()=>sheet.importRows(text),/belum terbaca/);
 assert.throws(()=>sheet.importRows('"1","00:00","5s","Narasi belum ditutup'),/belum ditutup/);
 assert.throws(()=>sheet.parseDelimited('"sel"teks,berikutnya',','),/di luar tanda kutip/);
});
