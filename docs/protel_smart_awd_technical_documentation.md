# 📘 PROTEL Smart AWD: The Ultimate System & Architecture Documentation

Dokumen ini adalah *"Kitab Suci"* teknis untuk proyek **Smart AWD (Alternate Wetting and Drying) DSS**. Dirancang khusus untuk pengembang (*Developer/Engineer*) saat ini dan masa depan agar memahami seberapa luas, seberapa dalam, dan seberapa kompleks ekosistem sistem ini dari hulu ke hilir.

---

## 1. 🏗 Ringkasan Arsitektur Makro (High-Level Architecture)
Sistem ini bukanlah sekadar aplikasi web *CRUD* biasa. Ini adalah **IoT, GIS (Sistem Informasi Geografis), dan Rule-Based Decision System** berskala *Enterprise* yang dipecah ke dalam arsitektur *Microservices*. 

Ada 5 pilar utama (*Microservices*) dalam ekosistem ini:
1. **FrontEnd (FE):** Antarmuka visual (React/Vite).
2. **BackEnd (BE):** Konduktor utama logika, telemetri, dan penyimpanan (Node.js + TypeScript).
3. **Model Service (DSS & Titiler):** Otak cerdas pengambil keputusan dan penyaji peta (Python FastAPI).
4. **GIS Processing Service:** Mesin komputasi rute air tingkat lanjut (Python FastAPI + ARQ Worker).
5. **WebODM (Open Drone Map):** Pengolah fotogrametri gambar *drone* (Docker Container).

---

## 2. 🌊 4 Alur Data Utama (Data Flows)

Sistem ini sangat kompleks karena data bergerak melalui banyak pipa. Berikut adalah 4 jalur kehidupan data di dalam sistem:

### Alur 1: GIS Pipeline (Dari Drone Menjadi Peta Digital)
Bagaimana sawah asli masuk ke layar *Frontend*?
1. *Drone* terbang dan memotret ratusan foto lapangan.
2. Ratusan foto tersebut dimasukkan ke **WebODM** (berjalan via Docker).
3. WebODM menjahit (*stitching*) gambar tersebut menjadi satu file `.tif` raksasa (*Orthomosaic*).
4. File `.tif` ini sangat berat (bisa bergiga-giga). Kita mengonversinya menjadi **Cloud Optimized GeoTIFF (COG)** dan mengunggahnya ke **Cloudflare R2** (layanan S3 Storage yang cepat).
5. Saat pengguna membuka Peta di **FrontEnd**, FE tidak mendownload `.tif` mentah, melainkan meminta ke modul **Titiler (di dalam Model Service)**.
6. Titiler membaca file `.tif` dari Cloudflare R2 *secara live* dan memotongnya menjadi kotak-kotak peta kecil (XYZ Tiles) yang sangat ringan untuk ditampilkan di FE layaknya Google Maps.

### Alur 2: Telemetry Pipeline (Dari Sawah ke Database)
Bagaimana perangkat mendeteksi air?
1. Tiang sensor IoT (*Ultrasonik, Suhu, Tekanan*) di sawah menembakkan data via protokol **MQTT** ke topik `sensor/data` setiap 5-10 menit.
2. Modul **MQTT Listener** di **BackEnd** menangkap payload JSON ini.
3. BE melakukan *Kalibrasi Dinamis*: Mengubah jarak (D) menjadi Tinggi Air (Water Level) menggunakan rumus: `(sensor_max_distance_mm - jarak) / 10`.
4. BE menyuntikkan data mentah ini secara masif ke dalam tabel waktu-nyata (**TimescaleDB**). Penyimpanan ini dilakukan tanpa memicu proses perhitungan apapun agar *broker* MQTT tidak kelebihan beban (*Overload*).

### Alur 3: Decision Pipeline (Kompilasi ke Rekomendasi)
Bagaimana sistem berpikir untuk irigasi?
1. **Cron Job (Setiap 10 & 15 Menit):** *State Builder* di BE berjalan setiap 10 menit untuk mengambil data sensor terbaru dan melakukan interpolasi. Sementara itu, *Stale Flag* berjalan setiap 15 menit untuk mendeteksi sensor mati.
2. **Cron Job (Setiap 3 Jam):** BE memiliki jadwal independen untuk menyinkronkan data prakiraan hujan dari **BMKG API** agar server pihak ketiga tidak *overload*.
3. **Cron Job (Setiap 30 Menit):** BE menjalankan *Decision Cycle*. Ia mengambil semua state petak sawah, aturan AWD saat ini, dan data BMKG terbaru dari database, kemudian memaketkannya ke dalam format JSON besar dan menembakkannya (HTTP POST) ke **Model Service (DSS Engine)**.
4. **Python DSS Engine** melakukan evaluasi hierarki secara *Black Box*:
   - Jika badai/hujan deras: **SKIP** (Tunda irigasi agar sawah tidak tenggelam).
   - Jika data sensor kosong: **NO_DATA** (Jangan bertindak buta).
   - Bandingkan dengan ambang batas (Kering vs Target AWD).
   - Memberikan skor prioritas (0.0 - 1.0) untuk menentukan petak mana yang harus diselamatkan duluan.
5. Rekomendasi dikembalikan ke Node.js dan disimpan ke database `trx.irrigation_recommendations`.

### Alur 4: Water Routing Pipeline (Dari Rekomendasi Menjadi Jalur Air)
Bagaimana pompa tahu lewat mana air harus mengalir?
1. Tepat setelah DSS mengeluarkan hasil, BE mencari satu petak *DRAIN* (Sumber Air) berskor tertinggi dan satu petak *IRRIGATE* (Target Air) berskor tertinggi.
2. BE menjalankan **4-Level Node Fallback** untuk meresolusi ketinggian air sesungguhnya agar perhitungan gravitasi tidak *error* jika sensor mati.
3. BE menembakkan Graph Topologi Lahan ke **GIS Processing Service**.
4. **GIS Processing** (melalui antrean *ARQ Redis Worker*) menjalankan **Algoritma Floyd-Warshall** (*All-Pairs Shortest Path*). Air secara alami akan mencari rute dari dataran tinggi ke rendah.
5. Matriks rute dikembalikan. BE mengonversinya menjadi array UUID lahan dan menyimpannya di kolom `route_path_ids`. *Frontend* akan membacanya dan menggambar garis panah laju air.

---

## 3. 🛠 Komponen Teknis (Deep Dive)

### 3.1. FrontEnd (FE)
- **Tech Stack:** React, Vite, TypeScript.
- **Library Peta:** Mapbox GL JS atau Maplibre GL.
- **Tugas:** Menyajikan Dashboard interaktif. Menerima *tiles* dari Titiler dan menggambar *Polygon* (petak sawah) dari Drizzle PostGIS via API BackEnd. Memberikan status *Offline/Online* node secara *real-time*.

### 3.2. BackEnd (BE)
*Bertindak sebagai Otak Penengah (Orchestrator).*
- **Tech Stack:** Node.js (Express), TypeScript.
- **ORM & DB:** Drizzle ORM, **PostgreSQL** (Data relasional), **PostGIS** (Fungsi keruangan spt *Centroid*), **TimescaleDB** (Hypertable untuk data sensor bervolume tinggi).
- **Proses Inti:**
  - `mqtt.service.ts`: Jendela penerima data IoT.
  - `state-builder.job.ts`: Penyatu interpolasi *stale/fresh/no_data*.
  - `engine-client.service.ts`: Pengirim data ke Python DSS.
  - `routing.service.ts`: Konverter *PostGIS Centroid* ke graf matematis Python.

### 3.3. Model Service (DSS & Titiler)
*Layanan Mikro berbasis Python.*
- **Tech Stack:** Python 3.10+, FastAPI, Pydantic, Uvicorn.
- **Titiler:** *Middleware* pengolah `.tif` dari S3 ke peta visual XYZ.
- **DSS Engine:** Mesin *Rule-Based* murni. Sangat tangguh (tervalidasi *Fuzz Testing* tingkat tinggi). Mendahulukan keamanan (*Weather Action*) di atas segalanya. Terlindung kuat oleh `Pydantic` *Schemas* sehingga tidak akan putus (*Crash*) jika menerima data anomali.

### 3.4. Ricemesh GIS Processing
*Mesin Analisis Spasial Berat.*
- **Tech Stack:** Python FastAPI, `NetworkX` (Library Teori Graf), `SciPy`, Redis.
- **ARQ Worker:** Tugas seperti *Floyd-Warshall* O(V³) sangat membebani CPU. Jika dieksekusi secara sinkron di API, server akan _timeout_. Oleh karena itu, *GIS Processing* menampung pekerjaan (*Job*) ke dalam **Redis** (antrean). Antrean ini akan dikerjakan di belakang layar oleh `2-arq-worker.bash`. BackEnd Node.js akan menerima hasilnya secara matang.

### 3.5. WebODM & Cloudflare R2
- **WebODM:** Mesin *fotogrametri* berat. Menghabiskan RAM dan CPU besar untuk menempelkan foto *drone*. Berjalan di container Docker tersendiri agar tidak mengganggu *Database* atau *BackEnd*.
- **Cloudflare R2:** Alih-alih menyimpan file TIF 2GB di server lokal yang akan menghabiskan ruang disk VPS (*Virtual Private Server*), file ini disimpan di Object Storage berbiaya murah tanpa biaya *Egress* bandwith.

---

## 4. 🏁 Status Perkembangan (Progress) & Catatan Developer Selanjutnya

Saat ini, sistem telah mencapai fase **Maturity / Production-Ready pada Sisi Logika (*Backend & Engine*)**.
Semua poin kritis telah terselesaikan hari ini (16-17 Juni 2026):
- [x] Kalibrasi IoT Otomatis.
- [x] Interpolasi dan penanganan *Missing Node* dengan 4 tahap jaring pengaman.
- [x] Routing Air dengan Floyd-Warshall selesai dipasang di BE.
- [x] Akurasi 100% pada *Black-Box Testing* mesin DSS.

### 🚀 PR Untuk Developer Selanjutnya:
1. **Penyelarasan FE (Frontend):** Karena sekarang BE mengembalikan `route_path_ids` pada baris DRAIN/IRRIGATE, FE harus membaca *array* ini dan menggambar *Polyline/Arrow* animasi di peta *Mapbox* dari sumber air ke target air. FE juga harus mengakomodasi tampilan "Offline" di *dashboard* meskipun interpolasi tetap berjalan.
2. **Koneksi Live GIS Worker:** Pastikan server Redis berjalan pada level infrastruktur *Production* agar modul ARQ *Worker* dari *GIS Processing* bisa menarik antrean *Floyd-Warshall*.
3. **Ekspansi Kasus Esktrim (Full Drain / Full Irrigate):** Logika *Routing* saat ini berfokus pada "Kasus Ketimpangan Ideal" (Satu banjir, satu kering). Untuk pembaruan berikutnya, algoritma perlu diubah jika **Seluruh lahan banjir** (Harus buang ke gorong-gorong pembuangan) atau **Seluruh lahan kering** (Harus menyedot air tanah dari pompa sumur).

---

> [!IMPORTANT]
> Sistem ini memiliki arsitektur yang sangat rapat dan saling terkait (*Tightly Coupled via API*). Jika Anda mengganti versi database atau menonaktifkan salah satu *Microservice* Python, maka modul di Node.js dapat mengalami *Abort/Timeout*. Pastikan Docker Compose selalu menjalankan seluruh ekosistem servis secara berdampingan.
