export const STORYBOARD_PROMPT=`Bertindaklah sebagai Senior Video Editor dan Visual Director spesialis video esai investigasi (gaya Vox, Johnny Harris, atau Reframe Investigatif) yang menggunakan CapCut PC.

Tugasmu adalah mengubah naskah/file subtitle (SRT) yang saya berikan menjadi STORYBOARD PRODUKSI LENGKAP dalam format Markdown Table.

IKUTI ATURAN KETAT BERIKUT:
1. Narasi Wajib Lengkap: Tuliskan seluruh teks narasi/VO kata per kata secara utuh. DILARANG meringkas, memotong, atau hanya menuliskan poin-poinnya.
2. Pacing Visual (Durasi Shot): Pecah visual dengan durasi rata-rata 3 sampai 7 detik per shot demi menjaga retensi penonton. Jika satu kalimat VO panjang, pecah menjadi beberapa cut/stimulus visual bertahap.
3. Label Jenis Aset: Setiap arahan visual wajib diawali dengan salah satu kode label ini:
   - [DOK]: Dokumen PDF resmi, UU, data audit, laporan keuangan, tabel.
   - [ARSIP]: Tangkapan layar headline portal berita, arsip TV, konferensi pers.
   - [B-ROLL]: Klip konseptual/stok video gratis (gedung, rapat, siluet, jalanan).
   - [MOTION]: Bagan alur, grafik statistik, teks tipografi besar, peta.
4. Instruksi CapCut & SFX Spesifik: Berikan arahan teknis CapCut yang aplikatif (seperti Punch-in Zoom 115%, Split Mask highlighter, Text Pop-up, Film Grain overlay) beserta rekomendasi kata kunci SFX CapCut (whoosh, thud, paper rustle, camera shutter, click).
5. Info Durasi: Cantumkan perkiraan durasi per shot dan hitung Total Durasi Keseluruhan di bagian paling atas tabel.

FORMAT OUTPUT TABEL:
Sajikan dalam tabel dengan 6 kolom berikut:
| No | Timecode / Estimasi | Durasi | Narasi Lengkap (Voice Over) | Arahan Visual & Jenis Footage | Teknik Editing CapCut & SFX |

---
Berikut naskah / subtitle yang harus kamu jadikan storyboard:
[TEMPEL NASKAH ATAU FILE SRT KAMU DI SINI]`;

const columns=['No','Timecode / Estimasi','Durasi','Narasi Lengkap (Voice Over)','Arahan Visual & Jenis Footage','Teknik Editing CapCut & SFX'];
const failure=message=>Object.assign(new Error(message),{status:502});
const normalize=value=>String(value).replace(/\s+/gu,' ').trim();
const cells=line=>line.trim().replace(/^\|/,'').replace(/(?<!\\)\|$/,'').split(/(?<!\\)\|/).map(c=>c.trim().replace(/\\\|/g,'|'));
const time=/^\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}(?:\s+.*)?$/;

export function storyboardNarration(input){
 const text=String(input).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
 if(!text.split('\n').some(line=>time.test(line.trim())))return {text,kind:'script'};
 const parts=[];
 for(const block of text.trim().split(/\n\s*\n/)){
  const lines=block.split('\n');if(/^\d+$/.test(lines[0].trim())&&time.test(lines[1]?.trim()))lines.shift();
  if(!time.test(lines.shift()?.trim())||!lines.some(line=>line.trim()))throw Object.assign(new Error('Subtitle SRT tidak valid. Periksa nomor, timecode dan teks setiap cue.'),{status:400});
  // Remove subtitle styling only; numeric dialogue remains narration.
  parts.push(lines.join('\n').replace(/<\/?(?:b|i|u|font)(?:\s[^>]*)?>/gi,''));
 }
 return {text:parts.join('\n'),kind:'srt'};
}

export function validateStoryboard(input,output){
 const original=storyboardNarration(input),lines=String(output).replace(/\r\n?/g,'\n').split('\n');
 const start=lines.findIndex((line,i)=>{
  const header=cells(line),divider=cells(lines[i+1]||'');
  return header.length===6&&header.every((cell,n)=>normalize(cell.replace(/\*\*|__/g,'')).toLowerCase()===columns[n].toLowerCase())&&divider.length===6&&divider.every(cell=>/^:?-{3,}:?$/.test(cell));
 });
 if(start<0)throw failure('Storyboard harus menggunakan tabel enam kolom sesuai template. Hasil belum diterapkan.');
 const rows=[];let i=start+2;
 while(i<lines.length&&lines[i].includes('|')){const row=cells(lines[i++]);if(row.length!==6)throw failure('Ada baris storyboard dengan jumlah kolom yang salah. Hasil belum diterapkan.');rows.push(row);}
 if(!rows.length||rows.some((row,n)=>row[0]!==String(n+1)||!row[1]||!row[2]||!/^\[(?:DOK|ARSIP|B-ROLL|MOTION)\]/.test(row[4])||!row[5]))throw failure('Periksa nomor, waktu, durasi, label aset dan arahan editing di setiap shot. Hasil belum diterapkan.');
 if(!/total\s+durasi/i.test(lines.slice(0,start).join('\n')))throw failure('Total durasi storyboard harus tampil sebelum tabel. Hasil belum diterapkan.');
 const narration=rows.map(row=>row[3].replace(/<br\s*\/?>/gi,'\n')).join('\n');
 if(normalize(narration)!==normalize(original.text))throw failure('Narasi storyboard berbeda, berulang atau terpotong. Seluruh VO harus sama dengan naskah/SRT, berurutan dan tanpa ringkasan. Hasil belum diterapkan; coba bagi bahan per bagian jika batas keluaran provider tidak cukup.');
 return {narrationComplete:true,shots:rows.length,inputKind:original.kind};
}
