# Penyimpanan dan pemulihan v4.38.0

`DATABASE_URL` mengaktifkan PostgreSQL. Empat model versioned (upload, produksi,
Note/kategori, Analytics per channel) disimpan sebagai JSONB dengan row lock dan
transaksi. Konten, kolom, kategori, script, revisi, serta histori tidak diubah.
Worker upload masih memerlukan satu instance aplikasi; jangan menambah replica.

Startup pertama menyimpan file JSON asli dan manifest SHA-256 di
`/data/backups/migration-<uuid>/`, lalu mengimpor empat model dalam satu transaksi
dan membandingkan checksum hasil PostgreSQL. Startup berikutnya memakai database;
file JSON lama tidak diimpor lagi. Koneksi/migrasi gagal menghentikan startup dan
tidak beralih ke database kosong. File OAuth terenkripsi dan video tetap di `/data`.

Backup harian menyimpan maksimal 3 salinan; manual maksimal 2. Snapshot konsisten memakai
satu SELECT, disimpan dalam tabel `app_backups` dan gzip di volume `/data/backups`.
Unduhan tersedia lewat menu Data & Backup, hanya setelah login. Backup manual memakai
cooldown satu menit di dalam transaksi. Proses snapshot dan mirror diserialkan; file
sementara memakai nama unik. Jika penulisan mirror gagal, snapshot PostgreSQL tetap
tersimpan dan bisa diunduh. Status menandai salinan volume yang hilang, termasuk
setelah restart. Backup aplikasi
tidak memuat token OAuth, password, ataupun file video. Backup volume Railway
melengkapi backup aplikasi untuk pemulihan database/volume secara menyeluruh.

## Pemulihan backup aplikasi

1. Unduh backup dari Data & Backup dan validasi: `npm run restore -- backup.json.gz`.
2. Hentikan instance aplikasi serta worker. Simpan salinan database terkini dahulu.
3. Pada lingkungan administrator dengan `DATABASE_URL` tersedia, jalankan
   `STORAGE_RESTORE_OFFLINE=true npm run restore -- backup.json.gz --apply`.
4. Empat model dipulihkan dalam satu transaksi. Jalankan aplikasi kembali dan
   periksa Note, produksi, kategori, kolom, serta antrean. Restore dapat mengembalikan
   job lama; periksa status publikasi YouTube sebelum meneruskan worker.

Jangan menghapus `/data` maupun database selama migrasi/pemulihan. Untuk kembali
ke versi JSON, ekspor model terkini dari backup PostgreSQL ke nama file aslinya
terlebih dahulu; file sebelum migrasi tidak mencerminkan perubahan terbaru.

## Statistik harian

Perubahan subscriber/views berasal dari laporan Analytics dimensi `day`.
Hari tanpa baris laporan tetap kosong. Daily cache direvisi ketika Google mengirim
data terbaru; data cache yang tidak disegarkan dalam 30 hari tidak ditampilkan.
Total channel dicatat ketika Data API tersedia, dengan tanggal Pacific dan timestamp
pengambilan. Snapshot disimpan 30 hari. Subscriber total dapat dibulatkan; tidak
digunakan untuk menghitung mundur total historis. Perubahan video publik bisa
menunjukkan upload, penghapusan, atau perubahan visibilitas. Backup dapat berisi
riwayat lebih lama dan hanya digunakan untuk pemulihan; cache tetap dibatasi saat tampil.

## Retensi hemat dan verifikasi (4.38.0)

Saat ada salinan melebihi batas, snapshot terkini disimpan atau snapshot identik yang valid dipakai ulang. Salinan gzip ditulis ke file sementara, dibaca kembali dan diperiksa checksum-nya sebelum mengganti mirror. Salinan yang akan dipertahankan juga diperiksa. Kegagalan verifikasi mempertahankan backup lama; data produksi tidak dipangkas oleh aturan ini.

Penghapusan baris backup selesai dahulu sebelum mirror lama dibersihkan. Penguncian transaksi melindungi proses backup bersamaan. Direktori migrasi dan berkas data/video/token lain tidak dibersihkan oleh aturan backup ini.

Backup otomatis dengan data identik memakai snapshot valid yang ada walau tanggal berubah. Metadata tanda terima backup yang terus diperbarui tidak dianggap perubahan isi; perubahan folder akun Drive tetap diperhitungkan. Pemakaian ulang file Drive memerlukan verifikasi ulang ukuran, checksum dan folder. Backup manual tetap tersedia, dan riwayat Drive tidak dihapus.

Penghapusan backup tidak menjamin ukuran fisik database langsung turun; PostgreSQL dapat memakai ulang ruang yang telah dibersihkan.
