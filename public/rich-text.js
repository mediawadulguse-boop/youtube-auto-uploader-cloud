/* Shared, dependency-free editor. Plain text remains available to search/export. */
window.HubRichText=(()=>{
  const editors=new WeakMap(),tags=new Set(['P','DIV','BR','B','STRONG','I','EM','U','S','STRIKE','UL','OL','LI','BLOCKQUOTE','H2','H3','FONT','SPAN','A','TABLE','THEAD','TBODY','TR','TH','TD']);
  const blocks=new Set(['P','DIV','LI','BLOCKQUOTE','H2','H3']);
  const urlPattern=/(?:https?:\/\/|www\.)[^\s<>"']+|[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi;
  const safeUrl=value=>{try{const u=new URL(/^www\./i.test(value)?'https://'+value:value);return ['http:','https:','mailto:'].includes(u.protocol)?u.href:''}catch{return ''}};
  function clean(html){
    const template=document.createElement('template');template.innerHTML=String(html||'');
    const walk=node=>{
      if(node.nodeType===3)return document.createTextNode(node.data);
      const out=document.createDocumentFragment();
      if(node.nodeType!==1)return out;
      if(['SCRIPT','STYLE','IFRAME','OBJECT','SVG','MATH','TEMPLATE'].includes(node.tagName))return out;
      const el=tags.has(node.tagName)?document.createElement(node.tagName.toLowerCase()):out;
      if(node.tagName==='A'){const url=safeUrl(node.getAttribute('href'));if(url){el.href=url;el.target='_blank';el.rel='noopener noreferrer'}}
      if(node.tagName==='FONT'&&/^[1-7]$/.test(node.getAttribute('size')))el.setAttribute('size',node.getAttribute('size'));
      for(const child of node.childNodes)el.append(walk(child));return el;
    };
    const out=document.createElement('div');for(const node of template.content.childNodes)out.append(walk(node));return out;
  }
  function plain(root){let value='',trailingBlock=false;const walk=node=>{if(node.nodeType===3){value+=node.data;trailingBlock=false;return}if(node.nodeName==='BR'){value+='\n';trailingBlock=false;return}if(node.nodeName==='TR'){if(value&&!value.endsWith('\n'))value+='\n';const cells=[...node.children].filter(c=>['TH','TD'].includes(c.nodeName));cells.forEach((cell,i)=>{if(i)value+='\t';for(const child of cell.childNodes)walk(child)});if(!value.endsWith('\n'))value+='\n';trailingBlock=true;return}if(blocks.has(node.nodeName)&&value&&!value.endsWith('\n')){value+='\n';trailingBlock=true}for(const child of node.childNodes)walk(child);if(blocks.has(node.nodeName)&&!value.endsWith('\n')){value+='\n';trailingBlock=true}};for(const node of root.childNodes)walk(node);return (trailingBlock?value.replace(/\n$/,''):value).replace(/\u00a0/g,' ')}
  function linkify(root){
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes=[];while(walker.nextNode())if(!walker.currentNode.parentElement?.closest('a'))nodes.push(walker.currentNode);
    for(const node of nodes){const value=node.data;urlPattern.lastIndex=0;let match,start=0;const fragment=document.createDocumentFragment();
      while((match=urlPattern.exec(value))){let label=match[0].replace(/[.,;:!?]+$/,'');while(label.endsWith(')')&&(label.match(/\)/g)||[]).length>(label.match(/\(/g)||[]).length)label=label.slice(0,-1);const url=safeUrl(label.includes('@')&&!/^(https?:\/\/|www\.)/i.test(label)?'mailto:'+label:label);if(!url)continue;fragment.append(document.createTextNode(value.slice(start,match.index)));const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=label;fragment.append(a);start=match.index+label.length;}
      if(start){fragment.append(document.createTextNode(value.slice(start)));node.replaceWith(fragment)}
    }
    return root;
  }
  function attach(textarea){
    if(editors.has(textarea))return editors.get(textarea);
    const wrapper=document.createElement('div');wrapper.className='rich-editor';
    // This component sits inside legacy labels; each control has its own name.
    wrapper.innerHTML=`<div class="rich-toolbar" role="toolbar" aria-label="Format teks">
      <button type="button" data-command="bold" aria-label="Bold / tebal" title="Tebal (Ctrl+B)"><b>B</b></button>
      <button type="button" data-command="italic" aria-label="Italic / miring" title="Miring (Ctrl+I)"><i>I</i></button>
      <button type="button" data-command="underline" aria-label="Underline / garis bawah" title="Garis bawah (Ctrl+U)"><u>U</u></button>
      <button type="button" data-command="strikeThrough" aria-label="Coret" title="Coret"><s>S</s></button>
      <select class="rich-size" aria-label="Ukuran huruf"><option value="2">Kecil</option><option value="3" selected>Normal</option><option value="5">Besar</option><option value="6">Sangat besar</option></select>
      <button type="button" data-case="upper" aria-label="Ubah ke huruf BESAR" title="Huruf BESAR">AA</button>
      <button type="button" data-case="lower" aria-label="Ubah ke huruf kecil" title="Huruf kecil">aa</button>
      <button type="button" data-command="insertUnorderedList" aria-label="Daftar poin" title="Daftar poin">• ≡</button>
      <button type="button" data-command="insertOrderedList" aria-label="Daftar nomor" title="Daftar nomor">1. ≡</button>
      <button type="button" data-link aria-label="Tambahkan link" title="Tambahkan link">↗ Link</button>
      <button type="button" data-format-script title="Rapikan tabel dan judul Markdown" aria-label="Rapikan format naskah">Rapikan format</button>
      <button type="button" data-command="removeFormat" aria-label="Hapus format" title="Hapus format">Tx</button>
      <button type="button" data-command="undo" aria-label="Urungkan" title="Urungkan (Ctrl+Z)">↶</button>
      <button type="button" data-command="redo" aria-label="Ulangi" title="Ulangi">↷</button>
    </div><div class="rich-input" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="true"></div>
    <div class="rich-link-form" hidden><input type="text" inputmode="url" aria-label="Alamat link" placeholder="https://… atau mailto:…"><button type="button" data-apply-link>Pasang</button><button type="button" data-cancel-link>Batal</button></div>
    <div class="rich-hint">Blok teks untuk memformat. Link terdeteksi otomatis.</div><div class="rich-links" aria-label="Link dalam teks"></div><div class="rich-error" role="status"></div>`;
    textarea.after(wrapper);textarea.hidden=true;textarea.classList.add('rich-source');
    const input=wrapper.querySelector('.rich-input'),toolbar=wrapper.querySelector('.rich-toolbar'),error=wrapper.querySelector('.rich-error');
    const label=textarea.labels?.[0]?.textContent.trim()||'Isi teks';input.setAttribute('aria-label',label);input.dataset.placeholder=textarea.placeholder;input.style.setProperty('--rich-rows',String(Math.min(Number(textarea.rows)||5,18)));
    let range=null,lastHtml='',composing=false;
    const remember=()=>{const selection=getSelection();if(selection.rangeCount&&input.contains(selection.anchorNode)&&input.contains(selection.focusNode))range=selection.getRangeAt(0).cloneRange()};
    const restore=()=>{input.focus();if(range&&input.contains(range.commonAncestorContainer)){const selection=getSelection();selection.removeAllRanges();selection.addRange(range)}};
    function refresh(){for(const b of toolbar.querySelectorAll('[data-command]'))if(['bold','italic','underline','strikeThrough','insertOrderedList','insertUnorderedList'].includes(b.dataset.command))b.setAttribute('aria-pressed',String(document.queryCommandState(b.dataset.command)))}
    function links(){const area=wrapper.querySelector('.rich-links');area.replaceChildren();const found=linkify(clean(input.innerHTML)),urls=[...new Set([...found.querySelectorAll('a[href]')].map(a=>a.href))];for(const url of urls){const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=url.replace(/^mailto:/,'');a.title='Buka '+url;area.append(a)}}
    function changed(){
      const value=plain(input);if(value.length>textarea.maxLength||input.innerHTML.length>1500000){error.textContent='Batas panjang teks tercapai.';input.innerHTML=lastHtml;return}
      error.textContent='';lastHtml=input.innerHTML;textarea.value=value;remember();links();refresh();textarea.dispatchEvent(new Event('input',{bubbles:true}));
    }
    function command(name,value){restore();document.execCommand('styleWithCSS',false,false);document.execCommand(name,false,value);changed()}
    input.addEventListener('input',e=>{e.stopPropagation();if(!composing)changed()});input.addEventListener('compositionstart',()=>composing=true);input.addEventListener('compositionend',()=>{composing=false;changed()});
    input.addEventListener('keyup',()=>{remember();refresh()});input.addEventListener('mouseup',()=>{remember();refresh()});
    input.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.ctrlKey){e.preventDefault();return}if((e.ctrlKey||e.metaKey)&&['b','i','u'].includes(e.key.toLowerCase())){e.preventDefault();command({b:'bold',i:'italic',u:'underline'}[e.key.toLowerCase()])}});
    input.addEventListener('paste',e=>{e.preventDefault();const html=e.clipboardData.getData('text/html'),text=e.clipboardData.getData('text/plain');const fragment=html?clean(html):document.createElement('div');if(!html)fragment.textContent=text;linkify(fragment);const selected=getSelection()?.toString().length||0;if(plain(input).length-selected+plain(fragment).length>textarea.maxLength){error.textContent='Teks yang ditempel melebihi batas karakter.';return}remember();command('insertHTML',fragment.innerHTML)});
    input.addEventListener('drop',e=>e.preventDefault());
    input.addEventListener('click',e=>{const a=e.target.closest('a[href]');if(a){e.preventDefault();const url=safeUrl(a.getAttribute('href'));if(url)window.open(url,'_blank','noopener,noreferrer')}});
    toolbar.addEventListener('mousedown',e=>{if(e.target.closest('button')){remember();e.preventDefault()}else remember()});
    toolbar.addEventListener('click',e=>{
      const button=e.target.closest('button');if(!button)return;e.preventDefault();
      if(button.hasAttribute('data-format-script')){if(!window.HubScriptFormat)return;const root=clean(HubScriptFormat.render(plain(input)));editor.set(plain(root),root.innerHTML);changed();return}
      if(button.dataset.command){command(button.dataset.command);return}
      if(button.dataset.case){restore();const selection=getSelection();if(!selection.rangeCount||selection.isCollapsed){error.textContent='Blok teks yang ingin diubah terlebih dahulu.';return}const selected=selection.getRangeAt(0).cloneContents(),walker=document.createTreeWalker(selected,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode;node.data=button.dataset.case==='upper'?node.data.toLocaleUpperCase('id-ID'):node.data.toLocaleLowerCase('id-ID')}const fragment=document.createElement('div');fragment.append(selected);command('insertHTML',clean(fragment.innerHTML).innerHTML);return}
      if(button.hasAttribute('data-link')){remember();wrapper.querySelector('.rich-link-form').hidden=false;const field=wrapper.querySelector('.rich-link-form input');field.value='';field.focus()}
    });
    toolbar.querySelector('select').addEventListener('change',e=>{e.stopPropagation();command('fontSize',e.target.value)});
    const linkForm=wrapper.querySelector('.rich-link-form');linkForm.addEventListener('input',e=>e.stopPropagation());linkForm.addEventListener('change',e=>e.stopPropagation());
    linkForm.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();applyLink()}if(e.key==='Escape'){e.preventDefault();linkForm.hidden=true;restore()}});
    function applyLink(){const url=safeUrl(linkForm.querySelector('input').value.trim());if(!url){error.textContent='Isi link http, https, atau mailto yang valid.';return}restore();if(getSelection().isCollapsed){const a=document.createElement('a');a.href=url;a.textContent=url;command('insertHTML',a.outerHTML)}else command('createLink',url);linkForm.hidden=true;links()}
    wrapper.querySelector('[data-apply-link]').onclick=applyLink;wrapper.querySelector('[data-cancel-link]').onclick=()=>{linkForm.hidden=true;restore()};
    wrapper.addEventListener('focusout',e=>{if(!wrapper.contains(e.relatedTarget)){const current=plain(input);const linked=linkify(clean(input.innerHTML));if(plain(linked)===current)input.replaceChildren(...linked.childNodes);lastHtml=input.innerHTML;range=null}});
    const editor={
      set(text,html){let root=html?clean(html):document.createElement('div');if(!html||plain(root)!==(text||'').replace(/\u00a0/g,' ')){root=document.createElement('div');root.textContent=text||''}linkify(root);input.replaceChildren(...root.childNodes);textarea.value=plain(input);lastHtml=input.innerHTML;range=null;error.textContent='';linkForm.hidden=true;toolbar.querySelector('select').value='3';for(const b of toolbar.querySelectorAll('[aria-pressed]'))b.setAttribute('aria-pressed','false');links()},
      html(){const root=linkify(clean(input.innerHTML));return plain(root).trim()?root.innerHTML:''},
      select(){input.focus();const r=document.createRange();r.selectNodeContents(input);getSelection().removeAllRanges();getSelection().addRange(r);remember()},
      input
    };
    editors.set(textarea,editor);editor.set(textarea.value);return editor;
  }
  return {attach,setFormatted:(el,html)=>{const root=clean(html);attach(el).set(plain(root),root.innerHTML)},set:(el,text,html)=>attach(el).set(text,html),html:el=>attach(el).html(),select:el=>attach(el).select()};
})();
