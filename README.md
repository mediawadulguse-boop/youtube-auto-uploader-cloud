# YouTube Auto Uploader Cloud v3

Cloud dashboard untuk upload banyak video ke YouTube secara **bergantian** dan mengatur **jadwal tayang dari platform**.

## Cara kerja

1. Browser mengirim video ke cloud **satu per satu** dengan chunk upload.
2. Worker cloud mengunggah setiap video ke YouTube **satu per satu** memakai resumable upload.
3. Video masuk ke YouTube sebagai **Private**.
4. Setelah upload YouTube selesai, file sementara di cloud dihapus.
5. Pada waktu yang dijadwalkan, platform memanggil YouTube Data API dan mengubah video menjadi **Public**.

Dengan desain ini, video tidak perlu disimpan di cloud sampai tanggal tayang.

## Deployment paling sederhana: GitHub + Railway

### 1. Deploy repo

Di Railway:

- New Project → Deploy from GitHub Repo
- Pilih `mediawadulguse-boop/youtube-auto-uploader-cloud`
- Railway akan membaca `Dockerfile` secara otomatis.

### 2. Tambahkan Persistent Volume

Worker menyimpan queue, token terenkripsi, dan video sementara di `/data`.

Tambahkan Railway Volume dan mount ke:

```text
/data
```

Tanpa volume, queue/token akan hilang saat instance dibuat ulang.

### 3. Isi environment variables

Gunakan `.env.example` sebagai acuan:

```text
APP_URL=https://DOMAIN-RAILWAY-ANDA
APP_SECRET=RANDOM_SECRET_PANJANG
ADMIN_PASSWORD=PASSWORD_ADMIN
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
DATA_DIR=/data
```

Buat `APP_SECRET` minimal 32 karakter acak. Jangan commit secret ke GitHub.

### 4. Buat Google OAuth Web Application

Di Google Cloud Console:

1. Aktifkan **YouTube Data API v3**.
2. Buka Google Auth Platform → Clients.
3. Create client → **Web application**.
4. Tambahkan Authorized redirect URI persis:

```text
https://DOMAIN-RAILWAY-ANDA/auth/google/callback
```

Scheme, domain, path, dan slash harus sama persis dengan `APP_URL` aplikasi.

5. Salin Client ID dan Client Secret ke environment Railway.

Aplikasi meminta scope:

```text
https://www.googleapis.com/auth/youtube.force-ssl
```

Refresh token disimpan terenkripsi AES-256-GCM menggunakan `APP_SECRET`.

## Status Queue

- `receiving`: browser sedang mengirim video ke cloud
- `queued_upload`: siap dikirim ke YouTube
- `uploading_youtube`: worker sedang upload ke YouTube
- `waiting_publish`: sudah ada di YouTube sebagai Private dan menunggu jadwal platform
- `publishing`: platform sedang mengubah ke Public
- `published`: sudah tayang
- `failed`: gagal dan dapat di-retry
- `cancelled`: dibatalkan

## Keamanan

- Jangan menaruh OAuth Client Secret atau `APP_SECRET` di repository.
- Dashboard dilindungi `ADMIN_PASSWORD`.
- Session cookie HttpOnly + SameSite=Lax + Secure pada HTTPS.
- OAuth menggunakan `state` untuk proteksi CSRF.
- Refresh token disimpan terenkripsi pada persistent volume.
- Source repo boleh publik selama tidak ada secret, tetapi untuk aplikasi internal disarankan ubah repository menjadi **Private**.

## Catatan YouTube

Upload memakai YouTube resumable upload. Worker memproses satu upload pada satu waktu agar sederhana dan stabil. Jadwal publikasi dikelola platform ini, bukan `status.publishAt` YouTube.

Project YouTube API yang belum memenuhi kebijakan/audit Google tertentu dapat memiliki pembatasan terhadap video yang diupload melalui API. Pastikan konfigurasi OAuth consent screen dan status project Google Cloud sesuai penggunaan aplikasi Anda.
