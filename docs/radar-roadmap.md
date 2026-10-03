# Roadmap pembaruan Content Hub

Pembaruan dirilis bertahap. Fokus awal: kualitas data Radar, pengelompokan, rangkuman, laporan terjadwal, lalu alur produksi Reframe.

| Tahap | Versi usulan | Status | Lingkup |
| --- | --- | --- | --- |
| 1 | 4.14.1 | Diimplementasikan | Audit engine, perbaikan kualitas ekstraksi, atribusi, pengelompokan lokasi dan tampilan cakupan sumber. |
| 2 | 4.15.0 | Berikutnya | Variasi istilah dan identitas peristiwa, alasan penggabungan dan aturan koreksi manual. |
| 3 | 4.16.0 | Direncanakan | Kronologi, aktor, angka penting, pernyataan berbeda dan bahan riset yang belum tersedia. |
| 4 | 4.17.0 | Direncanakan | Arsip laporan harian/mingguan terjadwal dan perbandingan liputan. |
| 5 | 4.18.0 | Direncanakan | Ruang riset, brief dan kerangka naskah dari template; impor teks/transkrip. |
| 6 | 4.19.0 | Direncanakan | Pustaka prompt, penggunaan ulang hasil AI, riwayat pemakaian dan hubungan dengan performa konten. |

## Tahap 1 — v4.14.1

Audit kode dan 30 kasus regresi sintetis, dengan satu pengujian antarmuka tambahan. Kasus ini mewakili bentuk artikel, RSS dan deskripsi YouTube; tidak mengklaim telah mengaudit 30 kelompok dari database produksi. Pengujian sebelumnya tetap mencakup autentikasi, tanpa pemakaian AI, filter periode dan pelestarian konten/koreksi manual.

Temuan dan perbaikan:

- `Menurut` dan `mengklaim` merupakan atribusi. Kalimat numerik/faktual tetap menjadi klaim sumber, bukan otomatis opini atau fakta terverifikasi.
- Singkatan gelar dan mata uang, angka desimal, paragraf HTML serta entitas HTML diproses tanpa memotong kalimat secara keliru.
- Promosi pada baris/kalimat tersendiri disaring; tautan di kalimat yang bermakna tidak membuang seluruh klaim.
- Cuplikan yang mengulang judul diberi label judul saja. Teks kosong, terlalu panjang atau terpotong memakai judul sebagai cadangan dengan penanda yang sesuai.
- Peringatan perbedaan angka hanya membandingkan kalimat berkonteks dan bersatuan sama. Tahun dan tanggal kalender tetap menjadi konteks pembanding.
- Judul umum yang sama tidak mengalahkan perbedaan lokasi yang teridentifikasi dalam cuplikan.
- Alias penerbit tidak dihitung sebagai penerbit baru pada laporan.
- Ringkasan utama dan salinan mempertahankan informasi keterbatasan bahan. Antarmuka menunjukkan cuplikan, judul saja, bahan terpotong, serta butir ditampilkan/total.

Pengelompokan tersimpan tidak ditulis ulang oleh patch ini. Penjagaan lokasi berlaku pada pencocokan berikutnya; koreksi kelompok lama tetap melalui gabung/pisah manual.

## Syarat rilis

1. `npm run check` dan `npm test` lulus.
2. Rangkuman engine tidak memanggil AI atau menambah kuota, termasuk ketika provider AI dikonfigurasi.
3. Rujukan, angka, atribusi, koreksi manual dan naskah tetap terpelihara.
4. CI berhasil dan deployment aplikasi online sehat pada versi yang dituju.

Sebelum tahap 2, lanjutkan evaluasi kelompok produksi jika tersedia melalui sesi aplikasi yang terautentikasi. Gunakan temuan nyata untuk menyetel kemiripan; pertahankan pengujian penghalang penggabungan salah.
