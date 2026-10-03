# Roadmap pembaruan Content Hub

Pembaruan dirilis bertahap. Fokus awal: kualitas data Radar, pengelompokan, rangkuman, laporan terjadwal, lalu alur produksi Reframe.

| Tahap | Versi usulan | Status | Lingkup |
| --- | --- | --- | --- |
| 1 | 4.14.1 | Diimplementasikan | Audit engine, perbaikan kualitas ekstraksi, atribusi, pengelompokan lokasi dan tampilan cakupan sumber. |
| 2 | 4.15.0 | Diimplementasikan | Variasi istilah dan identitas peristiwa, alasan penggabungan dan aturan koreksi manual. |
| 3 | 4.16.0 | Diimplementasikan | Kronologi, aktor, angka penting, pernyataan berbeda dan bahan riset yang belum tersedia. |
| 4 | 4.17.0 | Diimplementasikan | Arsip laporan harian/mingguan terjadwal dan perbandingan liputan. |
| 5 | 4.18.0 | Diimplementasikan | Ruang riset, brief dan kerangka naskah dari template; impor teks/transkrip. |
| 6 | 4.19.0 | Diimplementasikan | Pustaka prompt, penggunaan ulang hasil AI, riwayat pemakaian dan hubungan dengan performa konten. |

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

## Tahap 2 — v4.15.0

- Kamus alias terkendali mengenali Pemkab/Pemkot/Pemprov, Disdik/Dishub/Dinkes, PHK dan elpiji, serta variasi kata naik/turun/buka/tutup.
- Penanda nama dengan sapaan Gus/Ning, PT/CV, bank, universitas, partai, instansi dan tanggal dalam judul dipakai secara konservatif. Ini pola terbatas, bukan pengenal entitas umum atau verifikasi identitas.
- Menu **Alasan pengelompokan** menunjukkan evaluasi sekarang dan riwayat sumber masuk jika tersimpan. Riwayat sumber lama tidak direka ulang; skor adalah kemiripan teks.
- Pemisahan baru menyimpan hubungan batas antar kelompok. Dalam jendela pengelompokan 72 jam, bahan identik diarahkan ke sisi yang cocok; kecocokan ambigu ditampung sebagai kelompok perlu tinjau. Aturan bukan model semantik yang dilatih global.
- Penggabungan manual menjadi aturan untuk materi yang sama, dalam jendela waktu dan batas kapasitas yang sama. Tidak mengizinkan topik baru yang belum dikoreksi untuk otomatis melewati penjagaan entitas.
- Koreksi gabung/pisah/disetujui disimpan sebagai riwayat kelompok, maksimum 20 tindakan. Menggabungkan keluarga aturan menjaga kelompok lain; tanda sudah diperiksa tidak mengubah verifikasi sumber.
- Kelompok perlu tinjau tetap terlihat di Radar dan laporan, dengan penanda; tidak dipromosikan menjadi Hot News. Batasan ini ikut salinan rangkuman.
- Metodologi v5 memicu backup sebelum pengelompokan ulang impor otomatis yang belum disentuh. Kelompok editorial, terhubung ke konten dan kelompok yang memiliki aturan tetap dilindungi.

Pengujian mencakup alias, penjagaan entitas/tanggal/tindakan, alasan keputusan, riwayat dan pemulihan setelah restart, pemisahan ambigu, penggabungan antar keluarga aturan, perlindungan naskah, autentikasi API dan escaping antarmuka. Data produksi belum diekspor untuk evaluasi manual; pemeriksaan akurasi ini memakai regresi terkontrol dan pemeriksaan aplikasi online.

## Tahap 3 — v4.16.0

Kronologi memakai tanggal publikasi tersimpan; tanggal peristiwa editorial tetap terpisah. Nama hanya dari pola organisasi atau atribusi eksplisit. Angka disertai kalimat asli dan rujukan. Perbedaan negasi pada konteks literal ditampilkan untuk diperiksa, tanpa menentukan kebenaran. Daftar kebutuhan riset mengikuti cakupan, tanggal, verifikasi dan pembanding sumber. Semua ikut tampilan serta salinan rangkuman dan laporan.

## Tahap 4 — v4.17.0

Arsip otomatis berjalan tiap jam sesudah periode WIB selesai. Snapshot idempoten, tersimpan bersama data aplikasi dan mempertahankan laporan awal saat sumber berubah. Arsip dapat dicari/disalin; perbandingan memakai data tersedia saat pembuatan. Jadwal dapat dinonaktifkan. Catch-up harian maksimal tujuh hari dan satu minggu terakhir. Retensi maksimal 60 snapshot atau 20 MB, menghapus arsip terlama saja; sumber dan konten tidak dihapus.

## Tahap 5 — v4.18.0

Catatan dan checklist mengikuti revisi isu. Impor teks maksimal 50.000 karakter terikat sumber asal; TXT/SRT/VTT dibersihkan dan tidak menimpa deskripsi. Penggantian transkrip eksplisit dan mengembalikan status belum diperiksa. Engine mengambil maksimal 18 kalimat per sumber. Template Long/Short/3 Short menghasilkan brief dan kerangka dengan ruang isian, klaim tersimpan serta URL rujukan. Draft belum tersimpan sampai editor menekan Simpan. Penggabungan menjaga kedua catatan dan menolak jika melebihi kapasitas.

## Tahap 6 — v4.19.0

- Pustaka maksimal 50 prompt, dengan lima versi sebelumnya dan kontrol revisi. Contoh template tersedia pada pemilih Bantuan AI.
- Hasil AI tervalidasi dicache berdasarkan instruksi, seluruh bahan sumber terpilih, input, provider/model dan susunan cadangan. Perubahan bahan/prompt/model membatalkan kecocokan. Cache bertahan restart, maksimal 40 hasil atau 4 MB dengan umur 30 hari. Hasil gagal tidak dicache. Penggunaan ulang tidak menambah kuota atau memanggil provider, termasuk saat kuota penuh/jeda provider. Hasil baru dapat diminta eksplisit.
- Riwayat maksimal 300 aktivitas pratinjau: berhasil, gagal dan dipakai ulang, dengan provider/model serta tautan isu/konten. Token, biaya aktual dan uji koneksi provider belum dicatat sebagai tagihan.
- Performa memetakan isu ke konten dan ID video tersimpan. Metrik publik sepanjang umur video berasal dari cache channel sendiri; nilai kosong tetap kosong dan data berumur lebih dari 30 hari ditandai lama. Analytics video dapat dibuka untuk rincian; angka tidak membuktikan efektivitas prompt atau sebab-akibat.
- Impor per sumber maksimal 50.000 karakter dan kapasitas total teks impor 10 MB. AI menerima paling banyak 30 sumber dan 3.000 karakter teks per sumber; engine mengambil maksimal 18 kalimat per sumber.
- API baru diuji dengan sesi lokal terautentikasi serta penolakan akses tanpa sesi. Pengujian antarmuka memeriksa escaping, revisi prompt, perpindahan dialog dan penggunaan ulang saat provider jeda. Pengujian AI memakai respons simulasi; tidak mengklaim pengujian provider produksi.

Semua tahap roadmap sudah diimplementasikan. Validasi visual langsung pada sesi produksi tetap memerlukan sesi aplikasi terautentikasi; pemeriksaan rilis online memakai health, aset dan status deployment.

## Syarat rilis

1. `npm run check` dan `npm test` lulus.
2. Rangkuman engine tidak memanggil AI atau menambah kuota, termasuk ketika provider AI dikonfigurasi.
3. Rujukan, angka, atribusi, koreksi manual dan naskah tetap terpelihara.
4. CI berhasil dan deployment aplikasi online sehat pada versi yang dituju.

Untuk penyetelan berikutnya, lanjutkan evaluasi kelompok produksi jika tersedia melalui sesi aplikasi yang terautentikasi. Gunakan temuan nyata untuk menyetel kemiripan; pertahankan pengujian penghalang penggabungan salah.
