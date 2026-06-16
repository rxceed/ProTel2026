# 🗄️ Dokumentasi Teknis Lanjut: Sistem Database (Polyglot)

## 1. Ikhtisar (Overview)
Ini adalah mahakarya penyimpanan. Kita tidak membagi data menjadi berbagai server basis data yang terpisah. Seluruh data disimpan terpusat di `PostgreSQL` versi terbaru dengan konfigurasi 2 ekstensi mutlak (*PostGIS* dan *TimescaleDB*). Terhubung dengan port `5433` (konfigurasi dev Docker).

## 2. Struktur Skema (Drizzle ORM)
Kode di `d:\PROTEL\src\BackEnd\src\db\schema\` tidak mengandung *raw SQL*. Proyek memanfaatkan tipe ketat *TypeScript* menggunakan Drizzle ORM.

### A. Skema Master (`mst.ts`)
Berisi rancang bangun aset mati (Master Data):
- `mst.users`: Autentikasi Pengguna & *Operator Roles*.
- `mst.fields`: Data makro lapangan/lahan (*Entity/Tenant*).
- `mst.sub_blocks`: Potongan per-petak sawah. Menyimpan tipe geometri `geometry(Polygon,4326)` di kolom `boundaries` dan menyimpan titik poros rute gravitasional air di kolom `centroid`.
- `mst.flow_paths`: Arah irigasi. Titik A ke Titik B (*Edges* dalam teori Graf).
- `mst.sensor_calibrations`: (*Baru ditambahkan*) Tempat mengikat panjang fisik tiang sensor IoT untuk fungsi kalibrasi dinamis (*Dynamic Calibration* `sensor_max_distance_mm`).

### B. Skema Transaksi (`trx.ts`)
Berisi rekam jejak fluktuatif sistem:
- `trx.readings`: Hasil jepretan Telemetri dari IoT.
- `trx.sub_block_current_states`: Keadaan saat ini (Fresh, Stale, No Data).
- `trx.irrigation_recommendations`: Produk mutakhir dari sistem pakar (DSS). Disuntikkan dengan kolom perutean air (`route_path_ids`) berjenis array JSON.

## 3. Ekstensi PostGIS (Pemrosesan Geospasial Internal)
Mengapa kita butuh koordinat poros (*Centroid*) petak sawah untuk kalkulasi rute, namun Node.js tidak pernah menghitungnya?
- **Fungsi Trigger Asinkron:** Drizzle mengatur migrasi *Custom Postgres Trigger* yang diletakkan pada tabel `sub_blocks`. 
- Kapanpun Frontend atau admin membengkokkan poligon bentuk petak sawah baru (`boundaries`), server basis data Postgres dengan sendirinya menjalankan rumus spasial C++ dari `ST_Centroid(NEW.boundaries)` dan menyimpannya secara transparan. Hal ini membuat Node.js lepas dari komputasi titik buta (*Blind Computation*).

## 4. Ekstensi TimescaleDB (Time-Series & Hypertable)
Ratusan node IoT mengirim baris data suhu dan tinggi air per 5 Menit. 
Dalam satu hari: 100 x (24 jam x 12 laporan) = **28.800 Ribu Baris**.
Dalam setahun = **10.5 Juta Baris Data**.
- **The Hypertable:** Kita mengubah tipe tabel konvensional `trx.readings` menjadi *Timescale Hypertable*.
- **Partisi Waktu (*Time Partitioning*):** Database membelah 10 Juta baris ini ke dalam laci-laci per 1 bulan di belakang layar. Ketika Cron Job *State Builder* dari Node.js menanyakan *"Beri aku data 10 menit terakhir"*, Postgres tidak mencari (*Full Scan*) dari 10 Juta baris tadi, melainkan langsung menuju laci spesifik "Hari Ini". Kecepatannya instan O(1).

## 5. Deployment / Pemeliharaan (*Maintenance*)
Seluruh versi database tersimpan di *log* `/migrations/meta/_journal.json`.
Setiap developer backend yang melakukan perubahan ke tipe kolom (misal: penambahan konfigurasi pompa air baru di tabel) dilarang mengetik manual di database (*PgAdmin/DBeaver*).
- Gunakan: `npx drizzle-kit generate:pg` untuk mencetak skrip SQL baru.
- Gunakan: `npm run db:migrate` untuk mendorongnya secara permanen ke *Docker PostgreSQL*.
