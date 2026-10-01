# YouTube Content Hub v4.1.1

Dashboard cloud untuk mengelola konten sejak ide dan riset, menyimpan script sebelum produksi, serta mengunggah video bergantian dengan penjadwalan native YouTube.

## Pengelolaan konten

- **Dashboard:** konten aktif, konten siap upload, jadwal YouTube, progres produksi, deadline terlambat, dan upload gagal.
- **Kalender:** tampilan bulan, minggu, dan agenda; rencana tayang atau deadline produksi; seluruh tanggal konten menggunakan WIB (`Asia/Jakarta`). Kalender juga menampilkan pekerjaan upload lama yang belum terhubung ke konten.
- **Kanban:** Ide → Naskah → Produksi → Editing → Review → Siap Upload. Geser kartu pada desktop atau buka detail untuk mengubah tahap pada ponsel.
- **Semua Konten:** cari berdasarkan judul/penanggung jawab; filter pilar, tahap, format, dan arsip.
- **Editor:** brief, audiens, penanggung jawab, deadline, hook, script lengkap, CTA, rencana produksi, deskripsi/tag YouTube, dan checklist.
- **Riset & aset:** simpan catatan fakta/angka dan tautan sumber, dokumen, gambar, atau bahan video. Status verifikasi ditandai secara manual. Lampiran berupa tautan; aplikasi belum menyediakan penyimpanan berkas riset langsung.
- **Autosave:** perubahan disimpan ke server setelah satu detik. Draft lokal dipertahankan jika penyimpanan gagal. Perubahan dari tab lain menghasilkan konflik versi; pengguna dapat memuat versi server atau menyimpan draft sebagai salinan.
- **Riwayat:** 30 versi terakhir per konten, dengan pemulihan yang membuat versi baru. Duplikasi menyalin script/bahan dan mengosongkan tanggal/checklist untuk episode baru.
- **Pilar:** nama dan warna dapat ditambah/diubah, konsisten pada kalender, Kanban, dan daftar.

Konten tanpa video dan tanpa tanggal tetap tersedia di Kanban/daftar. Status produksi terpisah dari status publikasi. Memindahkan kartu ke Siap Upload tidak menjalankan upload.

### Menghubungkan konten dengan video

Buka konten → Publikasi → **Siapkan Upload Video**, lalu pilih satu file final. Judul, deskripsi, tag, dan rencana tayang dibawa ke formulir upload. Tekan **Upload & Jadwalkan** untuk mengirim video. Satu konten dihubungkan dengan satu pekerjaan upload aktif; permintaan ganda ditolak.

Setelah upload terhubung, kalender menampilkan waktu dari antrean YouTube. Rencana tayang dikunci agar perubahan lokal tidak memberi kesan bahwa jadwal YouTube sudah diubah. Pengaturan ulang video yang sudah terjadwal dilakukan melalui YouTube Studio. Metadata yang diedit dalam ruang konten setelah upload tidak otomatis memperbarui video di YouTube.

## Cara kerja upload

1. Browser mengirim video ke cloud satu per satu menggunakan chunk upload.
2. Worker mengirim video satu per satu ke YouTube melalui resumable upload.
3. Video diunggah sebagai Private dengan `status.publishAt`; YouTube Studio menampilkan Scheduled.
4. File video sementara di cloud dihapus setelah upload selesai.
5. YouTube menerbitkan video sesuai jadwal; worker menyinkronkan status sesudah waktu tayang.

Pengaturan Related Video untuk Shorts tetap diselesaikan di YouTube Studio melalui tombol yang tersedia.

## YouTube Analytics

Menu **YouTube Analytics** menggunakan laporan resmi untuk channel yang terhubung. Menampilkan views, jam tonton, durasi rata-rata, subscriber baru/berhenti/bersih, likes, komentar, shares, tren harian, dan 10 video teratas. Pilih 7/28/90/365 hari atau rentang khusus maksimal 366 hari. Ringkasan dibandingkan dengan rentang tanggal sebelumnya yang sama panjang. Ekspor CSV berisi ringkasan, angka harian, serta video teratas. Video yang terhubung ke konten aplikasi menyediakan tombol untuk membuka script dan produksi.

1. Aktifkan **YouTube Analytics API** pada proyek Google Cloud yang sama dengan OAuth aplikasi: https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com.
2. Jika OAuth consent screen memakai daftar scope, tambahkan `https://www.googleapis.com/auth/yt-analytics.readonly` dan `https://www.googleapis.com/auth/youtube.readonly`. Tetap gunakan test user/konfigurasi publik sesuai pengaturan proyek Google yang berlaku.
3. Login aplikasi → **YouTube Analytics** → **Hubungkan Analytics**. Pilih akun/channel yang sama dan izinkan semua scope yang diminta. Koneksi Analytics menggunakan token terpisah dan divalidasi melalui YouTube Analytics API untuk ID channel yang sudah terhubung. Token upload tidak diganti oleh persetujuan Analytics.

Laporan berakhir paling lambat kemarin menurut zona waktu YouTube (Pacific/Los Angeles); kalender produksi tetap WIB. YouTube dapat terlambat memproses dan merevisi angka. Tanggal tanpa baris tidak diisi sebagai nol. Ringkasan channel dan video menampilkan seluruh periode, bukan hanya konten yang dibuat di aplikasi. Angka subscriber total dapat dibulatkan oleh YouTube. Jam tonton Analytics tidak sama dengan jam tayang publik yang memenuhi syarat monetisasi. Pendapatan, CTR thumbnail, dan data real-time tidak termasuk integrasi ini.

Cache laporan lengkap berada di memori server selama 10 menit, maksimal 12 rentang/channel. Tidak ada polling Analytics setiap empat detik, tidak ada laporan yang disimpan ke localStorage, dan token hanya dipakai server. Cache dibersihkan ketika channel dihubungkan ulang/diputus. Laporan yang gagal tidak dianggap nol; bagian opsional yang gagal ditandai. Kuota YouTube Data API yang habis dapat membuat statistik total/judul video tidak tersedia sementara laporan Analytics tetap tampil jika API tersebut tersedia. Pengambilan data ulang tidak dilakukan otomatis jika izin/API/kuota bermasalah.

## Menjalankan dan menguji

Node.js 22 atau lebih baru. Tidak ada dependency produksi tambahan.

```sh
npm start
npm run check
npm test
```

Pengujian menggunakan direktori sementara dan respons Google simulasi, tidak menghubungi YouTube. Mencakup CRUD, konflik versi, penyimpanan, hubungan konten/upload, query Analytics, cache, kuota/izin, tanggal Pacific, OAuth tambahan, pemeliharaan token lama jika koneksi gagal, refresh token serentak per jenis koneksi, serta koneksi Analytics saat kuota Data API habis.

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
- `/data/contents.json`: konten, script, bahan riset, pilar, serta riwayat.
- `/data/youtube-token.enc.json`: refresh token upload terenkripsi.
- `/data/youtube-analytics-token.enc.json`: token Analytics terenkripsi, terikat pada ID channel. Token gabungan v4.1 sebelumnya tetap didukung.
- `/data/uploads/`: video sementara.

Update dari v3 mempertahankan database antrean dan token yang ada. Data konten dibuat saat pertama kali disimpan. Seluruh data tersebut perlu persistent volume agar tetap tersedia saat redeploy. Gunakan satu instance aplikasi untuk penyimpanan berbasis berkas ini; beberapa instance yang menulis volume yang sama belum didukung. File database yang rusak ditolak dan dipertahankan, bukan diganti dengan database kosong.

## Google OAuth

1. Aktifkan YouTube Data API v3 di Google Cloud.
2. Buat OAuth client **Web application**.
3. Tambahkan redirect URI persis `https://DOMAIN-RAILWAY-ANDA/auth/google/callback`.
4. Salin Client ID dan Client Secret ke environment Railway.

Aplikasi meminta scope `https://www.googleapis.com/auth/youtube.force-ssl` untuk upload. Tombol Hubungkan Analytics meminta `yt-analytics.readonly` dan `youtube.readonly` melalui OAuth incremental consent. Token Analytics dipisahkan dari token upload; validasi Analytics tidak memanggil YouTube Data API. Jika pengguna memilih akun yang tidak memiliki akses ke ID channel terhubung, Google menolak validasi dan kredensial sebelumnya dipertahankan. Pesan kegagalan dikembalikan ke dashboard; authorization code tidak dicantumkan pada URL dashboard. Refresh token disimpan terenkripsi AES-256-GCM memakai `APP_SECRET`. Konfigurasi Google tidak wajib untuk menyimpan ide/script, tetapi wajib untuk menghubungkan YouTube.

## Keamanan dan batas versi ini

Dashboard menggunakan login admin bersama, cookie HttpOnly/SameSite, dan OAuth state. API konten dan Analytics juga membutuhkan login. Validasi sumber hanya menerima URL http/https. Pemisahan akun/role, komentar tim, serta ekspor kalender/laporan produksi belum termasuk versi ini.

Status antrean: `receiving`, `queued_upload`, `uploading_youtube`, `waiting_publish`, `scheduled_youtube`, `published`, `failed`, `cancelled`.
