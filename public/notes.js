const notesUi={notes:[],q:'',category:null,categories:[],archived:false,loading:false,serial:0,editing:null,timer:null};
const noteDraftKey=id=>'yt-note-draft-'+id;
function renderNoteCategories(){
  const categories=[...(notesUi.categories||[])].sort((a,b)=>a.localeCompare(b,'id-ID'));
  const filter=$('#noteCategoryFilter');if(filter){filter.innerHTML='<option value="">Semua kategori</option><option value="none">Tanpa kategori</option>'+categories.map(c=>`<option value="category:${esc(c)}">${esc(c)}</option>`).join('');filter.value=notesUi.category===null?'':notesUi.category===''?'none':'category:'+notesUi.category;}
  $('#noteCategoryOptions').innerHTML=categories.map(c=>`<option value="${esc(c)}"></option>`).join('');
}
function openNoteCategory(){const form=$('#noteCategoryForm');form.reset();$('#noteCategoryError').classList.add('hide');$('#noteCategoryDialog').showModal();form.elements.name.focus();}
window.renderNotes=body=>{
  if(body.querySelector('#notesPanel'))return;
  body.innerHTML=`<div id="notesPanel"><div class="notes-toolbar"><div class="notes-search"><input id="noteSearch" placeholder="Cari judul, isi, atau tag…" aria-label="Cari catatan"><select id="noteCategoryFilter" aria-label="Kategori Note"><option value="">Semua kategori</option><option value="none">Tanpa kategori</option></select><label class="inline-check"><input id="noteArchiveFilter" type="checkbox"> Arsip</label></div><div class="feature-actions"><button class="btn" id="newNoteCategory">+ Kategori</button><button class="btn" id="recoverNoteDraft">Pulihkan draft</button><button class="btn primary" id="newNote">${hubIcon('plus')} Catatan baru</button></div></div><div id="notesError" class="notice hide" role="alert"></div><div id="notesList" aria-live="polite"></div></div>`;
  $('#noteSearch').value=notesUi.q;renderNoteCategories();$('#noteArchiveFilter').checked=notesUi.archived;
  $('#noteSearch').oninput=e=>{notesUi.q=e.target.value;clearTimeout(notesUi.searchTimer);notesUi.searchTimer=setTimeout(loadNotes,250)};
  $('#noteCategoryFilter').onchange=e=>{notesUi.category=e.target.value===''?null:e.target.value==='none'?'':e.target.value.slice(9);loadNotes()};$('#noteArchiveFilter').onchange=e=>{notesUi.archived=e.target.checked;loadNotes()};
  $('#newNoteCategory').onclick=openNoteCategory;$('#newNote').onclick=()=>createNote();$('#recoverNoteDraft').onclick=recoverNoteDraft;$('#notesList').onclick=async e=>{const el=e.target.closest('[data-note-open],[data-note-pin]');if(!el)return;try{if(el.dataset.noteOpen)await openNote(el.dataset.noteOpen);else{const n=notesUi.notes.find(n=>n.id===el.dataset.notePin);await api('/api/notes/'+n.id,{method:'PATCH',body:JSON.stringify({revision:n.revision,pinned:!n.pinned})});await loadNotes()}}catch(e){toast(e.message)}};
  loadNotes();
};
async function loadNotes(){
  const serial=++notesUi.serial,query=new URLSearchParams({q:notesUi.q,archived:notesUi.archived?'1':'0'});if(notesUi.category!==null)query.set('category',notesUi.category);
  try{const r=await api('/api/notes?'+query);if(serial!==notesUi.serial)return;notesUi.notes=r.notes;notesUi.categories=r.categories;renderNoteCategories();if($('#notesList')){renderNotesList();$('#notesError').classList.add('hide')}}catch(e){if(serial!==notesUi.serial||!$('#notesError'))return;$('#notesError').textContent=e.message;$('#notesError').classList.remove('hide')}
}
function renderNotesList(){
  const list=$('#notesList');if(!list)return;
  list.innerHTML=notesUi.notes.length?`<div class="notes-grid">${notesUi.notes.map(n=>`<article class="note-card"><div class="note-card-top"><span class="note-kind">${hubIcon('folder')}${esc(n.category||'Tanpa kategori')}</span><button class="icon-button ${n.pinned?'is-pinned':''}" data-note-pin="${n.id}" aria-label="${n.pinned?'Lepas pin':'Pin'} ${esc(n.title)}" aria-pressed="${n.pinned}">${hubIcon('pin')}</button></div><button class="note-open" data-note-open="${n.id}"><h3>${esc(n.title)}</h3><p>${esc(n.preview||'Belum ada isi. Buka untuk mulai menulis.')}</p><div class="note-tags">${n.tags.map(tag=>`<span>${esc(tag)}</span>`).join('')}</div><div class="hint">${new Date(n.updatedAt).toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta',day:'numeric',month:'short',year:'numeric'})} · ${n.bodyLength.toLocaleString('id-ID')} karakter</div></button></article>`).join('')}</div>`:'<div class="hub-panel empty">Belum ada catatan yang sesuai. Buat Note pertama Anda.</div>';
}
async function createNote(fields={}){try{const r=await api('/api/notes',{method:'POST',body:JSON.stringify({title:'Catatan baru',category:notesUi.category||'',...fields})});await openNote(r.note.id);void loadNotes();return r.note.id}catch(e){toast(e.message)}}
function noteFields(){const f=$('#noteForm');return {title:f.elements.title.value,category:f.elements.category.value,body:f.elements.body.value,tags:f.elements.tags.value.split(',').map(t=>t.trim()).filter(Boolean),pinned:f.elements.pinned.checked,archived:notesUi.editing.note.archived}}
function fillNote(note){const f=$('#noteForm');for(const k of ['title','category','body'])f.elements[k].value=note[k];f.elements.tags.value=note.tags.join(', ');f.elements.pinned.checked=note.pinned;$('#noteEditorHeading').textContent=note.title;$('#archiveNote').textContent=note.archived?'Pulihkan arsip':'Arsipkan';noteStats();}
function noteStats(){const body=$('#noteForm').elements.body.value;$('#noteWordCount').textContent=`${body.trim().split(/\s+/).filter(Boolean).length.toLocaleString('id-ID')} kata · ${body.length.toLocaleString('id-ID')} karakter`;}
async function openNote(id){
  if(notesUi.editing&&!await saveNote())return;
  const r=await api('/api/notes/'+id);notesUi.editing={note:r.note,dirty:false,epoch:0,saving:null,conflict:false};fillNote(r.note);$('#noteConflict').classList.add('hide');$('#noteSaveIndicator').textContent='Tersimpan di server';$('#noteEditor').showModal();
  let draft;try{draft=JSON.parse(localStorage.getItem(noteDraftKey(id))||'null')}catch{}
  if(draft?.fields&&confirm('Pulihkan draft catatan yang belum tersimpan?')){fillNote({...r.note,...draft.fields});markNoteDirty();if(draft.revision!==r.note.revision)noteConflict('Draft berasal dari versi sebelumnya. Muat versi server atau simpan sebagai salinan.');}
}
function noteConflict(message){notesUi.editing.conflict=true;clearTimeout(notesUi.timer);$('#noteConflictText').textContent=message;$('#noteConflict').classList.remove('hide');$('#noteSaveIndicator').textContent='Draft belum tersimpan';}
function markNoteDirty(){const edit=notesUi.editing;if(!edit)return;edit.dirty=true;edit.epoch++;$('#noteSaveIndicator').textContent='Perubahan belum tersimpan…';try{localStorage.setItem(noteDraftKey(edit.note.id),JSON.stringify({id:edit.note.id,revision:edit.note.revision,fields:noteFields(),at:Date.now()}))}catch{}clearTimeout(notesUi.timer);if(!edit.conflict)notesUi.timer=setTimeout(saveNote,900);noteStats();}
async function saveNote(){
  clearTimeout(notesUi.timer);const edit=notesUi.editing;if(!edit)return true;if(edit.saving)return edit.saving;
  edit.saving=(async()=>{while(edit.dirty){const epoch=edit.epoch;try{const fields=noteFields();if(!fields.title.trim())throw Error('Judul wajib diisi. Draft tetap disimpan.');$('#noteSaveIndicator').textContent='Menyimpan…';const r=await api('/api/notes/'+edit.note.id,{method:'PATCH',body:JSON.stringify({...fields,revision:edit.note.revision})});edit.note=r.note;edit.conflict=false;$('#noteConflict').classList.add('hide');if(epoch===edit.epoch){edit.dirty=false;try{localStorage.removeItem(noteDraftKey(edit.note.id))}catch{}}$('#noteEditorHeading').textContent=r.note.title;$('#noteSaveIndicator').textContent=edit.dirty?'Menyimpan perubahan berikutnya…':'Tersimpan di server';}catch(e){noteConflict(e.message);return false}}void loadNotes();return true})();try{return await edit.saving}finally{edit.saving=null}
}
async function closeNote(){if(!await saveNote())return;notesUi.editing=null;$('#noteEditor').close();}
$('#noteForm').oninput=markNoteDirty;$('#noteForm').onchange=markNoteDirty;$('#noteForm').onsubmit=e=>{e.preventDefault();saveNote()};$('#saveNote').onclick=saveNote;$('#closeNoteEditor').onclick=closeNote;
$('#noteEditor').addEventListener('cancel',e=>{e.preventDefault();closeNote()});
$('#copyNote').onclick=async()=>{try{await navigator.clipboard.writeText($('#noteForm').elements.body.value);toast('Isi catatan disalin.')}catch{const t=$('#noteForm').elements.body;t.focus();t.select();toast('Pilih Salin pada teks yang disorot.')}};
$('#duplicateNote').onclick=async()=>{if(!await saveNote())return;const fields=noteFields();fields.title=(fields.title+' (salinan)').slice(0,200);fields.archived=false;await closeNote();await createNote(fields)};
$('#archiveNote').onclick=async()=>{if(!await saveNote())return;notesUi.editing.note.archived=!notesUi.editing.note.archived;markNoteDirty();if(await saveNote()){await closeNote();toast('Status arsip diperbarui.')}};
$('#deleteNote').onclick=async()=>{if(!await saveNote()||!confirm('Hapus catatan ini secara permanen?'))return;try{const n=notesUi.editing.note;await api('/api/notes/'+n.id,{method:'DELETE',body:JSON.stringify({revision:n.revision})});notesUi.editing=null;$('#noteEditor').close();void loadNotes();toast('Catatan dihapus.')}catch(e){toast(e.message)}};
$('#reloadNote').onclick=async()=>{if(!confirm('Muat versi server dan abaikan draft lokal catatan ini?'))return;const id=notesUi.editing.note.id;clearTimeout(notesUi.timer);notesUi.editing=null;try{localStorage.removeItem(noteDraftKey(id))}catch{}$('#noteEditor').close();try{await openNote(id)}catch(e){toast(e.message)}};
$('#copyNoteDraft').onclick=async()=>{const fields=noteFields(),id=notesUi.editing.note.id;fields.title=(fields.title+' (draft)').slice(0,200);fields.archived=false;try{const r=await api('/api/notes',{method:'POST',body:JSON.stringify(fields)});clearTimeout(notesUi.timer);try{localStorage.removeItem(noteDraftKey(id))}catch{}notesUi.editing=null;$('#noteEditor').close();await openNote(r.note.id);void loadNotes();return r.note.id}catch(e){toast(e.message)}};
async function recoverNoteDraft(){let drafts=[];try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key.startsWith('yt-note-draft-')){const d=JSON.parse(localStorage.getItem(key));if(d?.fields)drafts.push(d)}}}catch{}drafts.sort((a,b)=>b.at-a.at);if(!drafts.length)return toast('Tidak ada draft lokal yang belum tersimpan.');const draft=drafts[0];try{await openNote(draft.id)}catch(e){if(confirm('Catatan asli belum tersedia. Simpan draft sebagai catatan baru?')){const id=await createNote(draft.fields);if(id)try{localStorage.removeItem(noteDraftKey(draft.id))}catch{}}}}
window.addEventListener('beforeunload',e=>{if(notesUi.editing?.dirty){e.preventDefault();e.returnValue=''}});
let noteCategorySaving=false;
$('#closeNoteCategory').onclick=()=>{if(!noteCategorySaving)$('#noteCategoryDialog').close()};
$('#noteCategoryDialog').addEventListener('cancel',e=>{if(noteCategorySaving)e.preventDefault()});
$('#noteCategoryForm').onsubmit=async e=>{
  e.preventDefault();if(noteCategorySaving)return;noteCategorySaving=true;const button=e.target.querySelector('button[type=submit]');button.disabled=true;$('#noteCategoryError').classList.add('hide');
  try{const r=await api('/api/note-categories',{method:'POST',body:JSON.stringify({name:e.target.elements.name.value})});notesUi.categories=r.categories;renderNoteCategories();$('#noteCategoryDialog').close();await loadNotes();toast('Kategori '+r.category+' tersedia di editor Note.');}
  catch(error){$('#noteCategoryError').textContent=error.message;$('#noteCategoryError').classList.remove('hide')}
  finally{noteCategorySaving=false;button.disabled=false}
};
