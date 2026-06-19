# ⚙️ Dokumentasi Teknis Lanjut: BackEnd (BE)

## 1. Ikhtisar (Overview)
Modul **BackEnd (BE)** di `d:\PROTEL\src\BackEnd` adalah pusat saraf operasional untuk Smart AWD. Ini adalah API REST *Typescript/Express* yang sangat erat hubungannya dengan PostGIS, TimescaleDB, MQTT, dan *Decision Engine* Python.

## 2. Struktur Direktori Utama
```text
src/
├── config/              (Manajemen Environment Variables & Defaults)
│   └── index.ts
├── db/                  (Koneksi Database & Drizzle ORM)
│   ├── client.ts        (Inisialisasi Pool pg)
│   ├── geometry.ts      (Parser tipe geometri PostGIS WKT)
│   └── schema/
│       ├── mst.ts       (Schema Master: Users, Fields, Sub-blocks, Sensors)
│       └── trx.ts       (Schema Transaksi: Readings, States, Recommendations)
├── middleware/          (Express Middlewares)
│   ├── auth.middleware.ts, error.middleware.ts, dll.
├── modules/             (Logika Bisnis Terpisah)
│   ├── decision-engine/ (Integrasi DSS & Floyd-Warshall)
│   │   ├── engine-client.service.ts
│   │   ├── node-resolver.ts
│   │   └── routing.service.ts
│   ├── scheduler/       (Cron Jobs)
│   │   ├── scheduler.service.ts
│   │   └── jobs/state-builder.job.ts, decision-cycle.job.ts
│   ├── telemetry/       (MQTT Client)
│   │   └── mqtt.service.ts
│   └── map-visual/
├── app.ts               (Inisialisasi Express & Routes)
└── server.ts            (Entry point HTTP Server)
```

## 3. Rahasia Lingkungan (Environment Variables)
Backend mengharuskan konfigurasi `.env` yang solid. Beberapa yang krusial meliputi:
- `DATABASE_URL`: `postgresql://postgres:postgres@localhost:5433/smartawd_db` (Catatan: Berjalan di port 5433 karena 5432 mungkin terpakai).
- `JWT_SECRET`: Digunakan untuk menandatangani otorisasi (HMAC SHA256).
- `DECISION_ENGINE_URL`: Penunjuk URL ke layanan Model DSS Python (mis. `http://localhost:8002`).

## 4. Mekanisme Komponen Inti

### A. MQTT Ingestion (`mqtt.service.ts`)
Setiap data yang dipublikasikan perangkat IoT (ESP32) ke topik `sensor/data` ditangkap oleh fungsi `startMqttListener()`. Payload berupa:
`{ "device": [{"id": "N1", "d": 120}], "temperature": 29.6, "pressure": 1007 }`
Backend menelusuri ID `N1` ke tabel `mst.devices`, mengambil offset sensor aslinya (contoh: 1400mm), dan menghitung ketinggian air: `(1400 - 120)/10 = 12.8 cm`. Data ini disisipkan (*Batch Insert*) ke dalam tabel `trx.readings` tanpa memicu komputasi yang berat demi menjaga aliran data asinkron IoT tetap bersih.

### B. Background Jobs (Scheduler via `node-cron`)
Arsitektur sangat bergantung pada pekerjaan belakang layar (Daemon) agar API frontend tidak melambat.
- **`runStateBuilderJob` (*/10 * * * *)**: Berjalan tiap 10 menit. Mencari *Readings* terbaru dari tiap sawah. Jika sebuah petak (*Sub-block*) tidak mengirim data sama sekali (rusak), algoritma interpolasi (*K-Nearest Neighbors*) akan menyimulasikan data tersebut. Kemudian mengemasnya ke dalam tabel `trx.sub_block_current_states`.
- **`runDecisionCycleJob` (*/30 * * * *)**: Berjalan tiap 30 menit. Mengemas data kondisi terkini, data `crop_cycles` (Umur HST Padi), *Rule Profiles* AWD, dan mengirimkannya via HTTP POST ke `/evaluate` pada *Decision Engine*.

### C. Node Fallback Resolution (`node-resolver.ts`)
*Masterpiece* lapisan pengaman. Jika modul *Python GIS* dikirimi data Null, kalkulasi *Floyd-Warshall* akan meledak. Resolver memastikan setiap *node* yang dikirim memiliki nilai ketinggian air matematis dengan jaring pengaman berundak (L1: Data Orisinal $\rightarrow$ L2: Data Interpolasi $\rightarrow$ L3: Rata-rata 1 Lapangan Penuh $\rightarrow$ L4: Abort).

### D. Orkestrasi Water Routing (`routing.service.ts`)
Ini adalah modul jembatan (API Wrapper). Setelah DSS menyarankan "Buka Pompa Irigasi (IRRIGATE)" dan "Kurangi Air Banjir (DRAIN)", file ini akan merajut struktur *Directed Graph*. `routing.service.ts` mengekstrak titik `ST_Centroid` (dari database PostGIS) mengubahnya ke Teks WKT, dan melemparnya ke server `gis_risang` untuk menemukan rute penyaluran air terpendek.
Hasil dari server GIS (sebuah indeks angka) diterjemahkan ulang menjadi *UUID Array* petak sawah dan disimpan dalam `trx.irrigation_recommendations(route_path_ids)`.

## 5. Pengembangan Lanjutan (To-Do)
1. Backend perlu mengekspos endpoint API (`GET /recommendations/:fieldId`) yang khusus mengirimkan rekomendasi aktif kepada *FrontEnd* beserta rute jalur airnya.
2. Pertimbangkan penerapan WebSocket Server (seperti Socket.io) di *Backend* Node.js untuk memberikan pengalaman (*User Experience*) waktu-nyata bagi *Dashboard Frontend*.
