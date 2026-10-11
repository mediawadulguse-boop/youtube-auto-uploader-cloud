/* Read the current Script in a same-origin overlay without leaving its editor. */
window.HubTeleprompter=(()=>{
  let active=null;
  function open(script,notify=()=>{},onClose=()=>{}){
    if(!script?.text?.trim()){notify('Isi script terlebih dahulu.');return null;}
    if(active)return active.dialog;
    const token=crypto.randomUUID(),snapshot={...script};
    const dialog=document.createElement('dialog');dialog.id='hubTeleprompter';dialog.setAttribute('aria-label','Teleprompter konten');
    dialog.innerHTML='<div class="teleprompter-loading" role="status">Memuat Teleprompter…</div><button type="button" class="btn teleprompter-fallback-close">Tutup · kembali ke Brief</button><iframe title="Mode baca Teleprompter" allow="microphone; fullscreen" allowfullscreen></iframe>';
    const frame=dialog.querySelector('iframe');let timer,loaded=false,sent=false,closed=false;
    const close=()=>{
      if(closed)return;closed=true;clearTimeout(timer);window.removeEventListener('message',receive);
      try{frame.contentWindow.postMessage({type:'hub-teleprompter-stop',token},location.origin);}catch{}
      if(document.fullscreenElement===frame)document.exitFullscreen().catch(()=>{});
      dialog.close();dialog.remove();active=null;onClose();
    };
    const receive=e=>{
      if(closed||e.origin!==location.origin||e.source!==frame.contentWindow||e.data?.token!==token)return;
      if(e.data.type==='hub-teleprompter-ready'&&!sent){sent=true;frame.contentWindow.postMessage({type:'hub-teleprompter-load',token,script:snapshot},location.origin);}
      if(e.data.type==='hub-teleprompter-loaded'&&sent&&!loaded){loaded=true;clearTimeout(timer);dialog.classList.add('ready');frame.focus();}
      if(e.data.type==='hub-teleprompter-close')close();
    };
    dialog.querySelector('button').onclick=close;
    dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    dialog.addEventListener('close',()=>{if(!closed)close();});
    active={dialog,close};window.addEventListener('message',receive);document.body.append(dialog);dialog.showModal();
    frame.src='/teleprompter.html#hub='+encodeURIComponent(token)+'&inline=1';
    timer=setTimeout(()=>{if(!loaded){notify('Teleprompter belum dapat dimuat. Coba buka kembali.');close();}},30000);
    return dialog;
  }
  return {open,close:()=>active?.close()};
})();
