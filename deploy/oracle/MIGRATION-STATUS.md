# Status eksekusi — 19 Oktober 2026

Migrasi BELUM selesai. File konfigurasi bukan backup pengguna.

- PR #1 digabungkan ke cabang PR #2 untuk menjalankan pengujian bersama; produksi Railway belum diperbarui.
- Pemeriksaan regresi gabungan: 389 tes lulus, 0 gagal. Dua tes migrasi tambahan juga lulus; mencakup file tersembunyi/symlink, perubahan atau kehilangan data, dan perubahan baris di tiga tabel dengan engine PostgreSQL WASM. Pemeriksaan sintaks aplikasi dan shell lulus. Docker/restore produksi belum diuji.
- Paket ZIP sebelumnya lolos CRC, tetapi hanya berisi konfigurasi dan skrip.
- PostgreSQL memiliki volume 500 MB; start command live menjalankan inspeksi disk dan `sleep 300`, bukan server PostgreSQL. Status deployment SUCCESS bukan bukti koneksi database sehat.
- Perubahan start command tertunda mencakup penghapusan file cache dan VACUUM. Perubahan tersebut TIDAK diterapkan.
- Volume /data masih terpasang pada aplikasi. Belum diekspor; belum ada checksum data produksi maupun uji restore data produksi.
- Connector Railway hanya mengembalikan nama variabel, tanpa APP_SECRET atau kredensial database. CLI Railway 5.70.0 berhasil diunduh dan dipasang pada percobaan lanjutan. Login browserless sudah dimulai, tetapi masih memerlukan penyelesaian autentikasi pengguna; `whoami` dan daftar file volume masih Unauthorized. Belum ada data produksi diekspor.
- Dashboard Railway bisa diakses. Pengaturan volume akun saat pemeriksaan hanya menunjukkan kapasitas 500 MB, tanpa kontrol resize atau ekspor.
- Tab Backups PostgreSQL menyatakan pembuatan backup baru memerlukan Pro. Console PostgreSQL menunjukkan No running instances. Tidak ada upgrade berbayar atau perubahan paket dilakukan.
- Konsol Oracle cloud.oracle.com menampilkan Site Unavailable, termasuk setelah satu reload. Belum ada OCI config atau VM Oracle yang dapat diakses dari sesi ini.
- Tidak ada volume, restore point, database, atau file Railway dihapus. DNS belum dialihkan. Worker Oracle belum diaktifkan.

## Syarat melanjutkan eksekusi

1. Akses Railway CLI terautentikasi dari lingkungan yang dapat mengunduh kedua volume. Selamatkan /data dan salinan fisik PostgreSQL yang konsisten saat server berhenti, sebelum perubahan recovery; jangan menganggap salinan fisik ini sudah lolos restore.
2. Akses OCI tenancy pada home region melalui konsol/API yang berfungsi; verifikasi sisa kuota Always Free sebelum membuat VM.
3. Pindahkan APP_SECRET asli dan konfigurasi OAuth secara privat ke VM. Jangan masukkan nilai rahasia ke issue, PR, log, atau chat.

## Bukti wajib sebelum cutover

- Backup database custom-format utuh, hash SHA-256, dan restore ke PostgreSQL 18 kosong berhasil.
- Inventori sumber/target ketiga tabel identik; empat document key lengkap.
- Inventori seluruh /data identik, termasuk file tersembunyi, backup historis, dan symlink; cek hash sebelum dan sesudah transfer.
- Login, dekripsi token OAuth, konten/naskah/storyboard, Note, analytics dan file video diuji.
- Sumber berhenti menulis selama backup final sampai pengalihan. Aplikasi target mulai dengan worker mati. Audit antrean sebelum satu worker diaktifkan.
- Railway tetap disimpan. Setelah Oracle menerima data baru, rollback memerlukan pemindahan perubahan balik; jangan menyalakan sumber lama begitu saja.
