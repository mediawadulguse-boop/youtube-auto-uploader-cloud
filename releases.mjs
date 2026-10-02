export const APP_VERSION='4.6.3';
// Release dates follow WIB. This is the shipped application history, not user edits.
export const RELEASES=[
 {version:'4.6.3',date:'2026-10-02',title:'Label kategori video pada konten',changes:[{type:'fix',text:'Badge Long ungu dan Short biru tampil jelas pada kalender, Kanban, dan Semua Konten. Kategori dipilih di editor konten.'},{type:'fix',text:'Kategori video dan filter Long/Short dihapus dari tampilan Note; kategori custom Note tetap tersedia.'},{type:'fix',text:'Kartu Kanban tidak lagi mengulang status proses produksi yang sudah terlihat pada kolom.'},{type:'feature',text:'Kategori video upload tanpa konten dapat dipilih saat upload atau melalui kalender dengan tombol Simpan. Upload lama tanpa kategori ditandai Belum dipilih.'}]},
 {version:'4.6.2',date:'2026-10-02',title:'Kategori video Long dan Short',changes:[{type:'feature',text:'Note mempunyai pilihan kategori video Long atau Short, badge pada kartu, serta filter Long, Short, dan Belum dipilih. Pilihan disimpan lewat tombol Simpan; catatan lama tetap tanpa pilihan.'},{type:'feature',text:'Label Long dan Short dibuat konsisten pada konten, Kanban, dan filter format.'}]},
 {version:'4.6.1',date:'2026-10-02',title:'Data & Backup stabil dan Riwayat Update',changes:[
  {type:'fix',text:'Halaman Data & Backup tetap terbuka saat sinkronisasi; tombol, pesan hasil, dan posisi scroll dipertahankan.'},
  {type:'fix',text:'Kegagalan pemeriksaan Analytics ditampilkan terpisah dan tidak menghilangkan daftar backup.'},
  {type:'fix',text:'Backup manual dilindungi dari permintaan bersamaan; hasil unduhan dan masalah salinan volume ditampilkan dengan jelas.'},
  {type:'feature',text:'Menu Riwayat Update menampilkan versi, tanggal rilis, fitur baru, dan perbaikan aplikasi.'}]},
 {version:'4.6.0',date:'2026-10-02',title:'Format teks dan deteksi link',changes:[{type:'feature',text:'Editor Note, brief, hook, naskah, CTA, dan rencana produksi mendukung bold, italic, underline, ukuran huruf, huruf BESAR/kecil, daftar, dan link.'},{type:'feature',text:'Format ikut tersimpan dalam draft, duplikasi, dan riwayat konten. Note tetap memakai tombol Simpan.'}]},
 {version:'4.5.0',date:'2026-10-02',title:'PostgreSQL, backup, dan statistik harian',changes:[{type:'feature',text:'Migrasi PostgreSQL dengan verifikasi data serta backup harian, manual, dan unduhan.'},{type:'feature',text:'Statistik harian subscriber, views, jam tonton, snapshot total channel, dan ekspor CSV.'}]},
 {version:'4.4.1',date:'2026-10-01',title:'Antrean upload lebih aman',changes:[{type:'fix',text:'Worker berhenti sementara saat kuota API habis dan mempertahankan offset upload serta jadwal native YouTube.'}]},
 {version:'4.4.0',date:'2026-10-01',title:'Analytics channel dan per video',changes:[{type:'feature',text:'Tab Overview, Reach, Engagement, Audience, pendapatan, katalog video, CSV, dan pengelolaan video.'},{type:'fix',text:'Judul video dan data yang sudah tersedia dipertahankan ketika kuota Google habis.'}]},
 {version:'4.3.2',date:'2026-10-01',title:'Simpan secara eksplisit',changes:[{type:'fix',text:'Note disimpan lewat tombol Simpan, kategori dibuat secara eksplisit, dan formulir kosong ditolak.'}]},
 {version:'4.3.1',date:'2026-10-01',title:'Kategori Note',changes:[{type:'feature',text:'Nama menu Note, kategori custom, serta filter catatan berdasarkan kategori.'}]},
 {version:'4.3.0',date:'2026-10-01',title:'Note dan kolom Kanban custom',changes:[{type:'feature',text:'Catatan, tag, pin, arsip, kolom Kanban yang dapat diatur, dan Analytics per video.'}]},
 {version:'4.2.1',date:'2026-10-01',title:'Pembeda status',changes:[{type:'feature',text:'Badge ikon, warna, dan tulisan membedakan tahap produksi dengan status publikasi.'}]},
 {version:'4.2.0',date:'2026-10-01',title:'Tampilan modern dan mobile',changes:[{type:'feature',text:'Sidebar desktop, menu ponsel, editor responsif, dan papan Kanban bergaya Trello.'}]},
 {version:'4.1.0',date:'2026-10-01',title:'Integrasi YouTube Analytics',changes:[{type:'feature',text:'Dashboard Analytics dan izin Google tambahan untuk membaca performa channel.'}]},
 {version:'4.0.0',date:'2026-10-01',title:'Content Hub',changes:[{type:'feature',text:'Dashboard, kalender, Kanban, penyimpanan naskah, riset, pilar, dan riwayat versi konten sebelum produksi.'}]}
];
