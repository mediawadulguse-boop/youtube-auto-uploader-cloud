# YouTube Content Hub v4.7.1

Dashboard cloud untuk mengelola konten sejak ide dan riset, menyimpan script sebelum produksi, serta mengunggah video bergantian dengan penjadwalan native YouTube.

## Tampilan dan navigasi

Sidebar pada desktop dan menu drawer pada ponsel; dashboard, kalender, library, upload, Analytics, serta editor mengikuti ukuran layar. Editor menjadi layar penuh pada ponsel. Menu dapat digunakan dengan keyboard, fokus terjaga pada drawer, dan input mobile berukuran 16px untuk menghindari zoom otomatis. Kanban menyerupai struktur visual Trello dengan identitas Content Hub.

Status memakai badge ikon + warna + teks pada judul kolom Kanban, dashboard, kalender, daftar, editor, dan antrean. Tahap produksi memakai badge berisi warna: Ide abu-abu, Naskah biru, Produksi amber, Editing ungu, Review pink, Siap Upload hijau. Publikasi memakai badge berbingkai: Belum upload, Masuk Cloud, Antre YouTube, Upload YouTube, Menyiapkan Jadwal, Terjadwal YouTube, Tayang, Gagal, dan Dibatalkan. Warna status tetap konsisten dan terpisah dari warna pilar.

## Data & Backup dan riwayat update

Halaman Data & Backup tidak dibuat ulang oleh sinkronisasi empat detik. Status dimuat saat halaman dibuka atau melalui **Muat ulang**; proses backup, pesan hasil, dan scroll tetap tersedia. Pemeriksaan Analytics mempunyai status/error sendiri. Backup manual memakai cooldown satu menit di dalam transaksi untuk menolak permintaan bersamaan. Unduhan memeriksa status HTTP dan format gzip; kegagalan ditampilkan pada halaman. Jika salinan volume gagal dibuat, backup PostgreSQL tetap tersedia untuk unduhan dan peringatan salinan volume ditampilkan.

Menu **Riwayat Update** menampilkan versi terpasang, tanggal WIB, catatan fitur/perbaikan, pencarian, dan filter jenis perubahan. Riwayat rilis dikelola di `releases.mjs`, terpisah dari riwayat perubahan naskah.

## Pengelolaan konten

- **Dashboard:** konten aktif, konten siap upload, jadwal YouTube, progres produksi, deadline terlambat, dan upload gagal.
- **Kalender:** tampilan bulan, minggu, dan agenda; rencana tayang atau deadline produksi; seluruh tanggal konten menggunakan WIB (`Asia/Jakarta`). Kalender juga menampilkan pekerjaan upload lama yang belum terhubung ke konten. Badge kategori video Long (ungu) dan Short (biru) tampil pada kalender, Kanban, dan Semua Konten. Kategori diubah melalui editor konten; upload tanpa konten memiliki pemilih kategori sebelum upload dan dialog kalender dengan tombol Simpan. Upload lama tanpa pilihan ditandai Belum dipilih. Label ini tidak mengubah klasifikasi video di YouTube.
- **Kanban:** Ide → Naskah → Produksi → Editing → Review → Siap Upload. Papan bergaya Trello dengan kolom abu-abu, kartu putih, label pilar dan kategori video Long/Short, badge deadline/checklist, dan inisial penanggung jawab. Tambah kartu langsung pada kolom, geser kartu pada desktop, atau gunakan tombol pindah kartu pada ponsel. Papan dapat digeser horizontal, dan posisi scroll/draft kartu dipertahankan saat sinkronisasi. Melalui tombol **Kolom**, tambah/ubah nama, warna, ikon, urutan, dan penanda selesai (maksimal 24 kolom). Saat menghapus kolom, pilih kolom tujuan; seluruh kartu termasuk arsip dipindahkan tanpa kehilangan script/riset/jadwal. Perubahan kolom tidak menjalankan upload. Urutan kartu manual belum tersedia.
- **Note:** Simpan catatan dengan kategori custom (maksimal 100 kategori, nama 60 karakter), isi multiline, tag, pin, pencarian isi, duplikasi, dan arsip. Note baru maupun perubahan Note disimpan hanya dengan tombol **Simpan**, menggunakan pemeriksaan revisi. Membuka atau menutup editor tidak membuat Note otomatis. Draft lokal berisi teks dapat dipulihkan; judul kosong ditolak. Kategori hanya dibuat melalui **Tambah kategori**, dipilih dari daftar di editor, serta dapat diubah/dihapus melalui pengaturan kategori. Menghapus kategori mempertahankan isi Note dan memindahkannya ke Tanpa kategori. Isi dapat disalin untuk digunakan saat produksi.
- **Semua Konten:** cari berdasarkan judul/penanggung jawab; badge kategori video serta filter pilar, tahap, kategori video, dan arsip.
- **Format teks:** Note, brief, Script, dan rencana produksi memakai toolbar bold, italic, underline, coret, ukuran huruf, huruf BESAR/kecil (teks yang diblok), daftar poin/nomor, link, hapus format, undo/redo. URL http/https, www, dan email terdeteksi otomatis; link dapat dibuka dari isi atau daftar link di bawah editor. Format tersimpan bersama teks biasa untuk pencarian/salin, draft lokal, duplikasi, dan riwayat konten. Note tetap disimpan melalui tombol Simpan. Deskripsi/judul YouTube tetap teks biasa. HTML dibersihkan di browser dan server; gambar/script/style dari paste tidak disimpan.
- **Editor:** brief, audiens, penanggung jawab, deadline, satu editor Script, rencana produksi, deskripsi/tag YouTube, dan checklist. Kolom Hook/CTA dihilangkan dari tampilan; data lama tetap dipertahankan saat menyimpan. Script mempunyai tombol Salin, jumlah kata/karakter, dan estimasi durasi narasi dengan patokan 140 kata/menit (bukan pengukuran audio). Progress bar berdasarkan empat checklist (0–100%) tampil pada detail konten, Kanban, dashboard, dan Semua Konten; checkbox pada detail dibuka dari Progres produksi. Persentase tidak otomatis mengikuti kolom/status.
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

## Radar Konten (4.7.0)

Radar memakai tiga lensa editorial yang dapat digabung: The System & Capital, The Hidden History & Mechanics, dan The Human Mirror. Topik, RSS custom, serta channel YouTube ditambahkan melalui tombol Simpan. Radar tersimpan dalam dokumen konten dan ikut backup PostgreSQL yang sama.

Berita dikumpulkan dari Google News RSS dan RSS custom (server publik HTTP/S saja), maksimum 3 topik bergiliran setiap 6 jam dengan 6 keyword bergiliran per topik. Sinkronisasi manual mempunyai jeda satu menit. Maksimum 60 topik, 15 RSS, 20 channel, 800 isu, 2.000 sumber total, dan 100 sumber per isu. Hapus/gabungkan isu yang tidak diperlukan ketika kapasitas penuh. Link RSS Google News dapat menuju halaman agregator; cuplikan tidak berarti artikel penuh telah dibaca. URL dedup, penggabungan manual, verifikasi sumber dan penanda repost tersedia. Coverage hanya menggambarkan sumber yang dipantau, bukan keseluruhan internet.

YouTube menggunakan koneksi Google aplikasi atau `YOUTUBE_API_KEY` opsional. URL channel harus `/@handle` atau `/channel/UC…`. Maksimum 10 video publik terbaru diperiksa per channel; snapshot dipertahankan 30 kali. Tidak mengakses CTR/retention/revenue channel lain. Kegagalan sinkronisasi mempertahankan data sebelumnya, dan kuota habis menunda YouTube satu jam.

AI opsional mendukung OpenAI Responses API dan Gemini generateContent API. Pilih `AI_PROVIDER=openai` (default untuk instalasi lama) dengan `OPENAI_API_KEY` + `OPENAI_MODEL`, atau `AI_PROVIDER=gemini` dengan `GEMINI_API_KEY` + `GEMINI_MODEL`. Provider dipilih secara eksplisit; tidak berpindah otomatis ke provider lain ketika gagal. Tanpa key/model, Radar tetap berfungsi dan UI menjelaskan variabel yang diperlukan. `AI_DAILY_LIMIT` default 20 (maksimum 100), jeda 10 detik per permintaan, maksimum 60.000 karakter script dan 30 cuplikan sumber. Tidak menyimpan API key di dokumen data. Hasil JSON divalidasi dan disajikan sebagai pratinjau; penerapan atau pembuatan draft harus dipilih pengguna. Tidak memublikasikan otomatis.

`RADAR_AUTO_SYNC=false` menonaktifkan jadwal Radar untuk pengujian atau pengumpulan manual saja. Instagram/TikTok/X belum dikumpulkan otomatis; link manual dari platform tersebut dapat disimpan tanpa mengklaim platformnya sudah dipantau.

### Aktivasi Gemini (4.7.1)

Buat key dari https://aistudio.google.com/apikey lalu tambahkan variabel pada service aplikasi Railway:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=isi_key_di_Railway
GEMINI_MODEL=gemini-3.8-flash
AI_DAILY_LIMIT=20
```

Nama model dapat diganti dengan model Gemini teks yang mendukung structured output dan tersedia pada akun Anda; identifier harus `gemini-…` (prefix `models/` diterima). Contoh model mengacu dokumentasi Google pada 2 Oktober 2026; ketersediaan serta kuota tetap mengikuti akun Google. Terapkan perubahan dengan Deploy, lalu coba Radar → Ringkas & angle AI → Buat pratinjau, atau Script → Bantuan AI.

Key dikirim hanya dari server dalam header `x-goog-api-key`, tidak pada URL, UI, atau backup. Gemini memakai satu candidate, output JSON ber-schema, batas 12.000 output tokens termasuk alokasi pemrosesan model, dan timeout 60 detik. Thought parts tidak ditampilkan; hanya jawaban akhir dengan finishReason STOP diproses. Respons terpotong/ditolak/invalid tidak diterapkan. Permintaan gagal tetap dihitung pada batas harian aplikasi, yang mengikuti pergantian hari UTC dan dibagi lintas provider. Tidak ada API call otomatis setelah key diisi: pengguna menekan Cek koneksi & model atau Buat pratinjau.

Dokumentasi: https://ai.google.dev/gemini-api/docs/generate-content/structured-output dan https://ai.google.dev/api/generate-content.

### Status koneksi & model (4.7.2)

Radar → Koneksi & model AI, atau modal Bantuan AI, menampilkan status dengan ikon, warna, dan teks. Cek koneksi & model membaca models.list dari provider (tanpa generateContent/Responses dan tanpa menghitung batas harian aplikasi). Hasil pemeriksaan tersimpan di memori server maksimum 10 menit, dengan jeda pemeriksaan 30 detik serta penggabungan permintaan bersamaan. Restart memerlukan pemeriksaan ulang. API terhubung berarti daftar model berhasil dibaca; akses generasi, kuota, dan dukungan JSON baru terbukti setelah pratinjau berhasil.

Gemini mengambil model yang mendukung generateContent, mengabaikan embedding/audio/image/live. Pilihan model berlaku untuk permintaan pratinjau, tidak mengganti GEMINI_MODEL di Railway dan tidak menulis isi draft. Pilih Cek koneksi & model untuk memuat alternatif; model default yang tidak ditemukan tidak dapat dipakai setelah pemeriksaan. OpenAI hanya menawarkan OPENAI_MODEL dan model tambahan yang ditentukan admin pada OPENAI_MODELS (daftar dipisahkan koma), setelah tersedia di akun. Server memvalidasi pilihan alternatif terhadap katalog yang masih berlaku.

Kegagalan provider disajikan sebagai pesan aman tanpa key, script, atau respons mentah. Jika Gemini menolak field responseFormat sebagai unknown name, server mencoba responseMimeType + responseJsonSchema satu kali di model yang sama, tetap memvalidasi hasil dengan schema aplikasi. Tidak mencoba ulang untuk masalah key, model, kuota atau hasil terpotong.

### Perbaikan format Gemini (4.7.3)

`generationConfig.responseFormat.text.mimeType` adalah enum REST dan memakai `APPLICATION_JSON`, bukan string MIME `application/json`. Field kompatibel lama `generationConfig.responseMimeType` tetap bertipe string dan memakai `application/json`. Kontrak ini diverifikasi dengan discovery resmi https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta dan dicatat sebagai fixture `test/fixtures/gemini-text-format.json` pada 2 Oktober 2026. Tes provider simulasi menolak nilai di luar enum resmi. Error invalid payload dipisahkan dari masalah dukungan model.

### Gangguan Gemini 503 (4.7.4)

HTTP 503 Gemini dicoba ulang maksimum dua kali (maksimum tiga panggilan per format; anggaran dua retry 503 dibagi dengan percobaan format kompatibel), dengan backoff 1s lalu 2s dan jitter 0–250ms. Retry-After berupa detik/tanggal dihormati; jeda melebihi 10 detik tidak ditunggu dalam request ini. Seluruh pemanggilan generateContent, termasuk format kompatibel, berbagi deadline 60 detik. Tidak mencoba ulang timeout, network error, 400 selain kompatibilitas field yang dikenal, 401/403, 404 atau 429. Tidak berganti model/provider otomatis. Batas harian aplikasi tetap satu reservasi per aksi pengguna, termasuk jika semua percobaan gagal. Kuota/billing provider mengikuti provider.

Setelah 503 terminal, model yang sama diberi jeda minimal 30 detik atau Retry-After yang valid. UI menampilkan hitung mundur; backend menolak pengulangan selama jeda sebelum menambah pemakaian aplikasi. Permintaan bersamaan untuk model yang sama ditolak selama pratinjau berjalan. Status katalog API dan hasil pratinjau terakhir terpisah; Cek koneksi tidak menyembunyikan kegagalan pratinjau. Hasil pratinjau terakhir tersimpan di memori server sampai restart, sedangkan katalog model tetap kedaluwarsa setelah 10 menit.

Acuan strategi retry: https://ai.google.dev/gemini-api/docs/troubleshooting.

### Schema Gemini dan uji langsung (4.7.5)

Schema Gemini memakai object bertipe dengan field wajib text, drafts (title/script/angle), dan citations, tanpa additionalProperties:false milik kontrak strict OpenAI. Hasil tetap melalui validateResult: format JSON, panjang teks, jumlah Short, jenis field, nomor kutipan, dan URL sumber harus valid. OpenAI tetap memakai schema strict aslinya.

Pada 2 Oktober 2026, pemeriksaan satu kali dari runtime produksi memakai prompt sintetis tanpa konten pengguna/key dalam log: teks biasa berhasil HTTP200, beberapa permintaan JSON mengembalikan503, schema sederhana berhasil200, dan complete aplikasi dengan schema Gemini yang disesuaikan berhasil200 serta lolos validasi pada10:12:05UTC. Hasil campuran ini belum membuktikan satu parameter tertentu sebagai satu-satunya penyebab503. Uji nyata tersebut merupakan satu smoke test, bukan jaminan ketersediaan provider. Model default tetap gemini-3.8-flash. Modul dan hook diagnosis sementara telah dihapus setelah pemeriksaan.
