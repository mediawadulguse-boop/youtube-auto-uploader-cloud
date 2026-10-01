# YouTube Content Hub v4.6.1

Dashboard cloud untuk mengelola konten sejak ide dan riset, menyimpan script sebelum produksi, serta mengunggah video bergantian dengan penjadwalan native YouTube.

## Tampilan dan navigasi

Sidebar pada desktop dan menu drawer pada ponsel; dashboard, kalender, library, upload, Analytics, serta editor mengikuti ukuran layar. Editor menjadi layar penuh pada ponsel. Menu dapat digunakan dengan keyboard, fokus terjaga pada drawer, dan input mobile berukuran 16px untuk menghindari zoom otomatis. Kanban menyerupai struktur visual Trello dengan identitas Content Hub.

Status memakai badge ikon + warna + teks di Kanban, dashboard, kalender, daftar, editor, dan antrean. Tahap produksi memakai badge berisi warna: Ide abu-abu, Naskah biru, Produksi amber, Editing ungu, Review pink, Siap Upload hijau. Publikasi memakai badge berbingkai: Belum upload, Masuk Cloud, Antre YouTube, Upload YouTube, Menyiapkan Jadwal, Terjadwal YouTube, Tayang, Gagal, dan Dibatalkan. Warna status tetap konsisten dan terpisah dari warna pilar.

## Data & Backup dan riwayat update

Halaman Data & Backup tidak dibuat ulang oleh sinkronisasi empat detik. Status dimuat saat halaman dibuka atau melalui **Muat ulang**; proses backup, pesan hasil, dan scroll tetap tersedia. Pemeriksaan Analytics mempunyai status/error sendiri. Backup manual memakai cooldown satu menit di dalam transaksi untuk menolak permintaan bersamaan. Unduhan memeriksa status HTTP dan format gzip; kegagalan ditampilkan pada halaman. Jika salinan volume gagal dibuat, backup PostgreSQL tetap tersedia untuk unduhan dan peringatan salinan volume ditampilkan.

Menu **Riwayat Update** menampilkan versi terpasang, tanggal WIB, catatan fitur/perbaikan, pencarian, dan filter jenis perubahan. Riwayat rilis dikelola di `releases.mjs`, terpisah dari riwayat perubahan naskah.

## Pengelolaan konten

- **Dashboard:** konten aktif, konten siap upload, jadwal YouTube, progres produksi, deadline terlambat, dan upload gagal.
- **Kalender:** tampilan bulan, minggu, dan agenda; rencana tayang atau deadline produksi; seluruh tanggal konten menggunakan WIB (`Asia/Jakarta`). Kalender juga menampilkan pekerjaan upload lama yang belum terhubung ke konten.
- **Kanban:** Ide → Naskah → Produksi → Editing → Review → Siap Upload. Papan bergaya Trello dengan kolom abu-abu, kartu putih, label pilar, badge deadline/checklist, dan inisial penanggung jawab. Tambah kartu langsung pada kolom, geser kartu pada desktop, atau gunakan tombol pindah kartu pada ponsel. Papan dapat digeser horizontal, dan posisi scroll/draft kartu dipertahankan saat sinkronisasi. Melalui tombol **Kolom**, tambah/ubah nama, warna, ikon, urutan, dan penanda selesai (maksimal 24 kolom). Saat menghapus kolom, pilih kolom tujuan; seluruh kartu termasuk arsip dipindahkan tanpa kehilangan script/riset/jadwal. Perubahan kolom tidak menjalankan upload. Urutan kartu manual belum tersedia.
- **Note:** simpan catatan dengan kategori custom (maksimal 100 kategori, nama 60 karakter), isi multiline, tag, pin, pencarian isi, duplikasi, dan arsip. Note baru maupun perubahan Note disimpan hanya dengan tombol **Simpan**, menggunakan pemeriksaan revisi. Membuka atau menutup editor tidak membuat Note otomatis. Draft lokal berisi teks dapat dipulihkan; judul kosong ditolak. Kategori hanya dibuat melalui **Tambah kategori**, dipilih dari daftar di editor, serta dapat diubah/dihapus melalui pengaturan kategori. Menghapus kategori mempertahankan isi Note dan memindahkannya ke Tanpa kategori. Isi dapat disalin untuk digunakan saat produksi.
- **Semua Konten:** cari berdasarkan judul/penanggung jawab; filter pilar, tahap, format, dan arsip.
- **Format teks:** Note, brief, hook, script, CTA, dan rencana produksi memakai toolbar bold, italic, underline, coret, ukuran huruf, huruf BESAR/kecil (teks yang diblok), daftar poin/nomor, link, hapus format, undo/redo. URL http/https, www, dan email terdeteksi otomatis; link dapat dibuka dari isi atau daftar link di bawah editor. Format tersimpan bersama teks biasa untuk pencarian/salin, draft lokal, duplikasi, dan riwayat konten. Note tetap disimpan melalui tombol Simpan. Deskripsi/judul YouTube tetap teks biasa. HTML dibersihkan di browser dan server; gambar/script/style dari paste tidak disimpan.
- **Editor:** brief, audiens, penanggung jawab, deadline, hook, script lengkap, CTA, rencana produksi, deskripsi/tag YouTube, dan checklist.
- **Riset & aset:** simpan catatan fakta/angka dan tautan sumber, dokumen, gambar, atau bahan video. Status verifikasi ditandai secara manual. Lampiran berupa tautan; aplikasi belum menyediakan penyimpanan berkas riset langsung.
- **Penyimpanan konten:** konten baru menjadi draft lokal sampai tombol Simpan ditekan. Membuka kalender/editor tanpa mengisi judul tidak membuat konten otomatis. Setelah konten dibuat, perubahan konten yang valid disimpan ke server setelah satu detik; bahan riset/aset yang seluruh kolomnya kosong tidak disimpan. Draft lokal dipertahankan jika penyimpanan gagal. Perubahan dari tab lain menghasilkan konflik versi; pengguna dapat memuat versi server atau menyimpan draft sebagai salinan.
- **Riwayat:** 30 versi terakhir per konten, dengan pemulihan yang membuat versi baru. Duplikasi menyalin script/bahan dan mengosongkan tanggal/checklist untuk episode baru.
- **Pilar:** nama dan warna dapat ditambah/diubah, konsisten pada kalender, Kanban, dan daftar.

Konten tanpa video dan tanpa tanggal tetap tersedia di Kanban/daftar. Status produksi terpisah dari status publikasi. Memindahkan kartu ke Siap Upload tidak menjalankan upload.

### Menghubungkan konten dengan video

Buka konten → Publikasi → **Siapkan Upload Video**, lalu pilih satu file final. Judul, deskripsi, tag, dan rencana tayang dibawa ke formulir upload. Tekan **Upload & Jadwalkan** untuk mengirim video. Satu konten dihubungkan dengan satu pekerjaan upload aktif; permintaan ganda ditolak.

Setelah upload terhubung, kalender menampilkan waktu dari antrean YouTube. Rencana tayang dikunci agar perubahan lokal tidak memberi kesan bahwa jadwal YouTube sudah diubah. Pengaturan ulang video yang sudah terjadwal dilakukan melalui YouTube Studio. Metadata yang diedit dalam ruang konten setelah upload tidak otomatis memperbarui video di YouTube.

## Cara kerja upload

Worker mempertahankan status/offset job saat kuota habis dan menyimpan jeda satu jam pada database, termasuk setelah redeploy. Pemeriksaan video terjadwal yang masih private dibatasi satu kali per menit per job. Error hanya mengubah job yang sedang diproses; status/jadwal job lain dipertahankan. Kegagalan sementara diberi jeda, sedangkan kegagalan permanen dapat dicoba ulang melalui antrean.

1. Browser mengirim video ke cloud satu per satu menggunakan chunk upload.
2. Worker mengirim video satu per satu ke YouTube melalui resumable upload.
3. Video diunggah sebagai Private dengan `status.publishAt`; YouTube Studio menampilkan Scheduled.
4. File video sementara di cloud dihapus setelah upload selesai.
5. YouTube menerbitkan video sesuai jadwal; worker menyinkronkan status sesudah waktu tayang.

Pengaturan Related Video untuk Shorts tetap diselesaikan di YouTube Studio melalui tombol yang tersedia.

## YouTube Analytics

Menu **YouTube Analytics** menggunakan laporan resmi untuk channel yang terhubung. Menampilkan views, jam tonton, durasi rata-rata, subscriber baru/berhenti/bersih, likes, komentar, shares, tren harian, dan 10 video teratas. Pilih 7/28/90/365 hari atau rentang khusus maksimal 366 hari. Ringkasan dibandingkan dengan rentang tanggal sebelumnya yang sama panjang. Ekspor CSV berisi ringkasan, angka harian, serta video teratas. Video yang terhubung ke konten aplikasi menyediakan tombol untuk membuka script dan produksi.

Tab **Per video** menggabungkan katalog upload channel yang dipaginasi dengan laporan maksimal 200 video teratas per periode. Sinkronisasi katalog memproses hingga empat halaman (200 video) per giliran; tombol **Lanjutkan sinkronisasi** dan worker berikutnya melanjutkan halaman berikutnya. Video di luar laporan teratas tetap dapat dibuka; angka periode yang belum dimuat ditampilkan kosong, bukan nol. Daftar mendukung pencarian judul/ID, filter visibilitas, pengurutan, pagination 25 video, dan perbandingan maksimal tiga video.

Channel dan detail video menggunakan tab **Ringkasan, Jangkauan, Interaksi, Audiens, Pendapatan**. Laporan mencakup perbandingan periode, grafik harian, engaged views, rata-rata persentase ditonton, sumber traffic, perangkat, negara, status subscriber, demografi usia/gender, dan kata pencarian. Detail video menyediakan grafik retensi; ringkasan channel menyediakan jenis konten. Demografi dan traffic kecil dapat dibatasi YouTube. CSV menyertakan data yang sudah dimuat, termasuk Reach/demografi/pendapatan dan status cakupan.

### Judul video dan sinkronisasi

Metadata disimpan pada persistent volume, dipisahkan berdasarkan channel, dan diperbarui berkala. API Data yang gagal diberi backoff agar tombol muat ulang tidak terus menghabiskan kuota. Judul publik memiliki fallback oEmbed tanpa mengirim token Google, hanya untuk ID yang ditemukan dalam laporan Analytics channel atau playlist upload milik channel. Video tanpa metadata menampilkan **Judul belum tersedia** serta ID sebagai identitas tambahan. Tidak membuat judul palsu dan tidak mengganti catatan pengguna. Cache metadata yang belum diperbarui lebih dari 30 hari tidak disajikan. Katalog diperbarui harian; katalog parsial dilanjutkan pada pemeriksaan worker setiap 30 menit. Cache laporan lengkap 10 menit, laporan parsial dua menit; data laporan tidak disimpan di localStorage.

### Aktivasi API

1. Aktifkan **YouTube Analytics API** pada proyek Google Cloud OAuth aplikasi: https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com.
2. Tambahkan `yt-analytics.readonly` dan `youtube.readonly` pada OAuth consent screen jika daftar scope dikonfigurasi. Login aplikasi → **YouTube Analytics** → **Hubungkan Analytics**, pilih pemilik/channel yang sama.
3. Untuk impressions/CTR thumbnail, aktifkan **YouTube Reporting API**: https://console.cloud.google.com/apis/library/youtubereporting.googleapis.com. Buka **Jangkauan → Aktifkan laporan Reach**. Aplikasi memeriksa ketersediaan `channel_reach_basic_a1`, membuat/menggunakan job bernama `Content Hub Reach`, serta menyimpan laporan harian pada volume. Laporan pertama dapat membutuhkan hingga 48 jam. Riwayat awal Reporting mencakup sekitar 30 hari sebelumnya; tidak menjanjikan riwayat CTR seumur hidup.
4. Laporan Reach disinkronkan setiap enam jam setelah job diaktifkan. CSV dibaca berdasarkan header; report ID dicatat, dan backfill mengganti tanggal lama, bukan dijumlahkan dua kali. CTR dilaporkan dalam persen, dibobot dengan impressions. Hari belum tersedia dan impressions tanpa CTR ditandai secara eksplisit. Angka tidak direkayasa dari views. Laporan Reach yang disimpan dibatasi 366 hari.
5. Untuk pendapatan, buka **Pendapatan → Hubungkan pendapatan**, tambahkan/izinkan `yt-analytics-monetary.readonly`. Channel harus anggota YouTube Partner Program. Data mencakup estimated revenue, pendapatan iklan/Premium, monetized playbacks, ad impressions, dan playback-based CPM dalam USD. Pendapatan merupakan estimasi, bukan pembayaran AdSense. Penolakan izin mempertahankan token yang sebelumnya bekerja; token upload tetap terpisah.

Tanggal laporan menggunakan waktu YouTube (Pacific); kalender produksi menggunakan WIB. Analytics memiliki jeda pemrosesan dan bukan grafik realtime 48 jam Studio. Hari tanpa laporan tidak dianggap nol; total subscriber dapat dibulatkan YouTube. Jam tonton Analytics berbeda dari jam tayang publik untuk syarat monetisasi.

### Kelola video dan produksi

Detail video mempunyai tab **Kelola video** untuk memuat/mengedit judul, deskripsi, dan tag; mengirim PNG/JPEG thumbnail maksimal 2 MB; memuat playlist channel dan menambahkan video; membaca 20 komentar per halaman dan mempublikasikan balasan. Playlist menampilkan maksimal 50 playlist awal dan memberi keterangan jika ada halaman berikutnya. Semua penulisan dikirim hanya setelah tombol Simpan/Tambahkan/Publikasikan ditekan. Edit snippet mempertahankan category/default language, memakai ETag untuk menolak konflik, dan memeriksa pemilik video/playlist/komentar sebelum menulis. Mengubah metadata lokal script tidak otomatis mengubah YouTube.

**Hubungkan ke produksi** menghubungkan video yang diunggah di luar aplikasi ke konten yang sudah ada, atau membuat konten baru setelah **Simpan hubungan** ditekan. Judul kosong ditolak, pilar hanya dipilih dari yang sudah ada. Script, riset, Note, kategori, serta kolom Kanban sebelumnya tetap disimpan dengan aturan yang sama. Fitur copyright/Content ID, eligibility YPP, pembayaran AdSense, editor video dan seluruh metrik khusus Studio belum tersedia; link Studio disediakan pada detail video.

Jika `DATABASE_URL` dikonfigurasi, penyimpanan memakai PostgreSQL dengan migrasi JSON yang diverifikasi dan backup sebelum impor. Tanpa variabel ini, mode JSON tetap tersedia untuk pengembangan lokal. Lihat [DATA-RECOVERY.md](DATA-RECOVERY.md) untuk backup dan pemulihan.

## Menjalankan dan menguji

Node.js 22 atau lebih baru. Jalankan `npm ci` untuk memasang dependency PostgreSQL dan sanitasi teks.

```sh
npm start
npm run check
npm test
```

Pengujian menggunakan direktori sementara dan respons Google simulasi. Uji fallback oEmbed mengganti fetch dengan respons lokal, tanpa mengirim kredensial atau menulis ke channel asli. Mencakup CRUD Note/konten, kategori custom dan kompatibilitas catatan lama, migrasi schema, kolom custom dan pemindahan kartu/arsip, konflik versi, penyimpanan, hubungan konten/upload, query Analytics, cache, kuota/izin, tanggal Pacific, OAuth tambahan, pemeliharaan token lama jika koneksi gagal, refresh token serentak per jenis koneksi, serta koneksi Analytics saat kuota Data API habis.

## Deployment GitHub + Railway

1. Deploy repo `mediawadulguse-boop/youtube-auto-uploader-cloud`. Railway membaca `Dockerfile`.
2. Tambahkan persistent volume dan mount di `/data`.
3. Isi environment variables berdasarkan `.env.example`:

```text
APP_URL=https://DOMAIN-RAILWAY-ANDA
APP_SECRET=RANDOM_SECRET_PANJANG
ADMIN_PASSWORD=PASSWORD_ADMIN
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
DATA_DIR=/data
```

Buat `APP_SECRET` minimal 32 karakter acak. Jangan commit secret ke GitHub.

### Penyimpanan

- `/data/db.json`: channel dan antrean upload lama maupun baru.
- `/data/contents.json`: konten, script, bahan riset, pilar, kolom Kanban custom, serta riwayat (schema v2).
- `/data/contents.v1.backup.json`: salinan schema lama sebelum penulisan pertama setelah migrasi v4.3.
- `/data/notes.json`: catatan pribadi dan daftar kategori custom.
- `/data/analytics.json`: katalog/metadata per channel, status sinkronisasi, job Reporting dan Reach harian. Tidak menyimpan token Google.
- `/data/youtube-token.enc.json`: refresh token upload terenkripsi.
- `/data/youtube-analytics-token.enc.json`: token Analytics terenkripsi, terikat pada ID channel. Token gabungan v4.1 sebelumnya tetap didukung.
- `/data/uploads/`: video sementara.

Update dari v3 mempertahankan database antrean dan token yang ada. Data konten/Notes dibuat saat pertama kali disimpan. Schema konten v1 dibaca dengan enam kolom bawaan; file asli dicadangkan sebelum penulisan v2 pertama. Kolom yang telah dihapus tidak dipulihkan oleh riwayat kartu; pemulihan mempertahankan kolom aktif kartu. Seluruh data tersebut perlu persistent volume agar tetap tersedia saat redeploy. Gunakan satu instance aplikasi untuk penyimpanan berbasis berkas ini; beberapa instance yang menulis volume yang sama belum didukung. File database yang rusak ditolak dan dipertahankan, bukan diganti dengan database kosong.

## Google OAuth

1. Aktifkan YouTube Data API v3 di Google Cloud.
2. Buat OAuth client **Web application**.
3. Tambahkan redirect URI persis `https://DOMAIN-RAILWAY-ANDA/auth/google/callback`.
4. Salin Client ID dan Client Secret ke environment Railway.

Aplikasi meminta scope `https://www.googleapis.com/auth/youtube.force-ssl` untuk upload. Tombol Hubungkan Analytics meminta `yt-analytics.readonly` dan `youtube.readonly` melalui OAuth incremental consent. Token Analytics dipisahkan dari token upload; validasi Analytics tidak memanggil YouTube Data API. Jika pengguna memilih akun yang tidak memiliki akses ke ID channel terhubung, Google menolak validasi dan kredensial sebelumnya dipertahankan. Pesan kegagalan dikembalikan ke dashboard; authorization code tidak dicantumkan pada URL dashboard. Refresh token disimpan terenkripsi AES-256-GCM memakai `APP_SECRET`. Konfigurasi Google tidak wajib untuk menyimpan ide/script, tetapi wajib untuk menghubungkan YouTube.

## Keamanan dan batas versi ini

Dashboard menggunakan login admin bersama, cookie HttpOnly/SameSite, dan OAuth state. API konten, Notes, kolom, dan Analytics juga membutuhkan login. Validasi sumber hanya menerima URL http/https. Pemisahan akun/role, komentar tim, serta ekspor kalender/laporan produksi belum termasuk versi ini.

Status antrean: `receiving`, `queued_upload`, `uploading_youtube`, `waiting_publish`, `scheduled_youtube`, `published`, `failed`, `cancelled`.

## PostgreSQL, backup, dan statistik harian

Konfigurasi `DATABASE_URL` dengan referensi database privat Railway. Migrasi otomatis mempertahankan file asli, memverifikasi checksum, dan berhenti jika gagal. Menu **Data & Backup** menyediakan status migrasi, backup manual, unduhan, dan pemeriksaan Analytics. Petunjuk pemulihan ada di [DATA-RECOVERY.md](DATA-RECOVERY.md).

Tab **Statistik Harian** menyajikan subscriber baru/berhenti/bersih, views harian, jam tonton, total channel hasil snapshot, serta perubahan jumlah video publik. Hari tanpa data tetap kosong; total sebelum pencatatan tidak diestimasi.
