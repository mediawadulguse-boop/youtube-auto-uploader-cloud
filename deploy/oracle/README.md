# Migrasi YouTube Hub: Railway ke Oracle Always Free

STATUS: Paket konfigurasi dan skrip. Belum ada data pengguna yang dipindahkan. Jangan hapus Railway sebelum salinan database dan /data terverifikasi.

## Audit sumber (19 Oktober 2026)

Railway project: youtube-auto-uploader-cloud.
- Database: Postgres-AkhX, volume postgres-volume-mgEy (500 MB, penuh; terakhir terbaca hanya 28 KB bebas).
- Aplikasi: youtube-auto-uploader-cloud, volume youtube-auto-uploader-data (500 MB) di /data.
- Deploy app gagal SQLSTATE 53100. PostgreSQL live start command dipakai untuk pemeriksaan. Ada perubahan start command tertunda berisi operasi pembersihan; JANGAN jalankan tanpa audit.
- Data konten, Note, Analytics, jobs, dan storyboard berada di PostgreSQL. Video dan OAuth token terenkripsi berada di /data.
- APP_SECRET ASLI diperlukan untuk mendekripsi token pindahan.

## 1. Pengamanan Railway (sumber tidak dihapus)

1. Jika tersedia, buat snapshot volume Railway sebelum pemulihan. Cek proses restore snapshot.
2. Database perlu dipulihkan dari kondisi penuh. Jika memilih Live Resize dari 500 MB ke 2 GB, cek biaya terlebih dahulu. Jangan menghapus WAL/tabel fisik untuk mengosongkan disk.
3. Pastikan PostgreSQL benar-benar melayani pg_isready dan SELECT 1 sebelum backup logis.
4. Unduh seluruh /data melalui Railway CLI di komputer tepercaya:

~~~powershell
railway login
railway link
railway volume files --volume a250a168-efc0-4249-8b80-d546d1f6bce2 list /
railway volume files --volume a250a168-efc0-4249-8b80-d546d1f6bce2 download / .\railway-data --concurrency 8
~~~

Simpan berkas terenkripsi, periksa jumlah file, ukuran dan SHA-256. Jangan unggah ke GitHub publik.

5. Setelah PostgreSQL sehat, Terminal A:

~~~powershell
railway connect Postgres-AkhX --environment production --tunnel-only --port 55432
~~~

Terminal B, setelah instal PostgreSQL client versi 18:

~~~powershell
pg_dump -h 127.0.0.1 -p 55432 -U YOUR_RAILWAY_DB_USER -d YOUR_RAILWAY_DB --format=custom --no-owner --no-acl -f .\youtubehub-full.dump
pg_restore --list .\youtubehub-full.dump
Get-FileHash .\youtubehub-full.dump -Algorithm SHA256
~~~

Gunakan prompt password, jangan ketik di chat. Catat jumlah app_documents, app_backups, checksum dan file /data. Jika DB belum dapat hidup, rencanakan salinan fisik offline yang konsisten; jangan copy PGDATA saat database menulis.

## 2. Oracle Cloud Always Free (akun dan login pengguna diperlukan)

Oracle VM.Standard.A1.Flex ARM64: alokasi gratis setara 2 OCPU/12 GB RAM pada home region; storage gabungan maksimal 200 GB termasuk boot volume, sesuai dokumentasi 2026. Pilih VM eligible dan 100 GB boot disk jika sesuai kuota. Kapasitas A1 dapat habis. Konfirmasikan tarif sebelum membuat resource non-eligible.

- Ubuntu ARM64 24.04.
- Network: SSH/22 batasi IP pribadi, 80/443 dibuka; jangan buka database 5432 atau Node 3000.
- Siapkan DNS A record untuk APP_DOMAIN ke public IP Oracle; HTTPS ditangani Caddy.
- Instal Docker Engine + Compose v2 dari dokumentasi resmi Docker.

Setelah login SSH di Oracle VM:

~~~bash
sudo mkdir -p /srv/youtube-hub/{data,postgres,backups,caddy-data,caddy-config}
sudo chown -R "$USER":"$USER" /srv/youtube-hub
sudo mkdir -p /opt
sudo chown "$USER":"$USER" /opt
git clone https://github.com/mediawadulguse-boop/youtube-auto-uploader-cloud.git /opt/youtube-auto-uploader-cloud
cd /opt/youtube-auto-uploader-cloud
git fetch origin migration/oracle-always-free-20261019
git checkout migration/oracle-always-free-20261019
cd deploy/oracle
cp .env.example .env
chmod 600 .env
nano .env
~~~

Isikan APP_SECRET ASLI dari Railway, OAuth Google, APP_URL, password PostgreSQL baru berupa hex acak panjang, dan API keys langsung di VM. Worker harus false sampai final cutover.

## 3. Restore dan validasi

Kirim backup terenkripsi /data dan file .dump lewat SCP ke Oracle VM secara privat.
Ekstrak /data ke /srv/youtube-hub/data (pastikan file OAuth, video, dan mirror tetap ada).

~~~bash
cd /opt/youtube-auto-uploader-cloud/deploy/oracle
docker compose --env-file .env config --quiet
docker compose --env-file .env up -d db
bash scripts/restore-postgres.sh /tmp/youtubehub-full.dump
~~~

Script restore hanya menerima database kosong dan memakai satu transaksi. Jangan aktifkan aplikasi lama dan baru secara bersamaan pada saat cutover.

Bandingkan empat key PostgreSQL: uploads, contents, notes, analytics; juga revision, jumlah job, naskah, kolom, kategori, storyboard, video dan hash file /data. Verifikasi OAuth callback baru pada Google Cloud Console: https://YOUR_DOMAIN/auth/google/callback.

Jika Railway worker lama sudah berhenti dan backup final terverifikasi:

~~~bash
docker compose --env-file .env up -d --build app caddy
curl -fsS https://YOUR_DOMAIN/api/health
~~~

Pastikan ok=true dan storage=postgresql; uji login dan beberapa fitur. Sebelum mengubah WORKER_ENABLED menjadi true, audit antrean upload untuk mencegah publikasi YouTube ganda. Simpan Railway sebagai rollback sampai verifikasi berhasil.

## 4. Backup rutin

~~~bash
cd /opt/youtube-auto-uploader-cloud/deploy/oracle
bash scripts/backup-postgres.sh
~~~

Wajib membuat salinan terenkripsi di luar Oracle untuk database dan /data. Uji pemulihan berkala. Script tidak menghapus backup historis otomatis.

Sumber:
- https://docs.railway.com/cli/volume
- https://docs.railway.com/cli/connect
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- https://docs.docker.com/engine/install/ubuntu/

PERINGATAN: Tidak ada perubahan produksi atau pemindahan data dalam cabang GitHub ini. Akses konsol Oracle dan kemampuan unduh file volume diperlukan untuk langkah berikutnya.
