/* Send current editor text directly to our same-origin teleprompter tab. */
window.HubTeleprompter=(()=>{
  function open(script,notify=()=>{}){
    if(!script?.text?.trim()){notify('Isi script terlebih dahulu.');return null;}
    const token=crypto.randomUUID(),snapshot={...script};
    const child=window.open('/teleprompter.html#hub='+encodeURIComponent(token),'_blank');
    if(!child){notify('Izinkan tab pop-up untuk membuka Teleprompter, lalu tekan tombol lagi.');return null;}
    let timer;
    const clear=()=>{window.removeEventListener('message',receive);clearTimeout(timer);};
    const receive=e=>{
      if(e.origin!==location.origin||e.source!==child||e.data?.token!==token)return;
      if(e.data.type==='hub-teleprompter-ready')child.postMessage({type:'hub-teleprompter-load',token,script:snapshot},location.origin);
      if(e.data.type==='hub-teleprompter-loaded')clear();
    };
    window.addEventListener('message',receive);
    timer=setTimeout(()=>{clear();if(!child.closed)notify('Teleprompter belum memuat script. Tutup tab tersebut lalu buka kembali.');},30000);
    return child;
  }
  return {open};
})();
