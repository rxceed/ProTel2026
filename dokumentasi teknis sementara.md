**Rangkuman Teknis Tahap 1**

**Smart AWD Rice Monitoring, Personalized Irrigation DSS,  
dan Dashboard Orthomosaic 2D**

| **Lingkup**  | **Frontend dan backend Tahap 1 (dashboard web 2D, monitoring, BMKG fusion, dan rule-based DSS)** |
|--------------|--------------------------------------------------------------------------------------------------|
| **Frontend** | React + Vite + Tailwind CSS + OpenLayers                                                         |
| **Backend**  | Node.js + Express + PostgreSQL/PostGIS + FastAPI Decision Engine                                 |
| **Status**   | Ringkasan desain teknis yang siap diturunkan ke DDL, API contract, dan backlog implementasi      |

*Dokumen ini merangkum keputusan desain yang telah dikunci selama
diskusi: unit keputusan per kotak sawah/sub-block, evaluasi per field,
personalisasi berdasarkan bucket umur varietas padi, profil sumber air,
event budidaya dinamis, integrasi BMKG, serta orthomosaic 2D sebagai
konteks visual digital twin.*

# 1. Ringkasan eksekutif

Tahap 1 difokuskan pada dashboard web 2D untuk monitoring smart AWD padi
dan decision support system (DSS) irigasi berbasis aturan. Aplikasi
mobile lapangan dan visualisasi 3D tidak termasuk di tahap ini. Sistem
bekerja dengan memadukan telemetry sensor AWD, polygon sub-block dari
orthomosaic, prakiraan cuaca BMKG, dan rule profile padi yang
dipersonalisasi berdasarkan bucket umur varietas, fase tanam aktif,
profil sumber air, serta event budidaya dinamis.

- Unit evaluasi DSS: field

- Unit keputusan dan visualisasi: sub-block / kotak sawah

- Output DSS: rekomendasi untuk operator manusia, bukan kontrol aktuator
  otomatis

- Decision cycle: default 60 menit, dapat diturunkan ke 30 menit pada
  kondisi siaga

- Telemetry policy: sampling perangkat lebih rapat, uplink mini-batch
  periodik, dan normalisasi per-device di server

- Data satu siklus tanam tidak dihapus, tetapi diarsipkan setelah crop
  cycle selesai

# 2. Tujuan dan scope Tahap 1

Tujuan utama tahap ini adalah menyediakan satu dashboard operasional
yang mampu menampilkan kondisi lahan, status air per kotak, orthomosaic
aktif, konteks cuaca, serta rekomendasi irigasi yang dapat dijalankan
operator secara manual.

## Termasuk dalam Tahap 1

- Dashboard web modular berbasis React + Tailwind

- Monitoring telemetry AWD per field dan sub-block

- Orthomosaic 2D sebagai base layer visual

- Digitasi manual polygon sub-block dari orthomosaic

- Rule-based irrigation DSS per field dengan output per sub-block

- Integrasi BMKG (prakiraan 3 hari, peringatan dini, kategori hujan)

- Role-based access control hingga level field

## Di luar Tahap 1

- Visualisasi 3D point cloud LAS/LAZ

- Aplikasi Android lapangan

- Otomatisasi aktuator pintu air

- Model ML penuh untuk prediksi irigasi

- Workflow status rekomendasi yang kompleks

# 3. Konsep sistem dan domain model

Sistem diposisikan sebagai personalized precision-irrigation DSS untuk
padi dalam skenario smart AWD. Monitoring dan pengambilan keputusan
tidak berpusat pada perangkat, melainkan pada unit digital twin berupa
sub-block/kotak sawah.

| **Lapisan**    | **Unit Utama**               | **Fungsi**                                                                 | **Catatan Desain**                                |
|----------------|------------------------------|----------------------------------------------------------------------------|---------------------------------------------------|
| Spatial twin   | Field dan sub-block          | Menyimpan polygon, flow path, orthomosaic, dan konteks spasial             | Field = unit evaluasi; sub-block = unit keputusan |
| Monitoring     | Telemetry record dan state   | Menyerap batch sensor, menormalkan per-device, dan membangun state terkini | State bisa observed atau estimated                |
| Weather fusion | Snapshot BMKG per field      | Menambahkan forecast, warning, dan kategori hujan ke engine                | Tidak perlu per sub-block pada tahap 1            |
| Decision layer | Recommendation per sub-block | Menghasilkan ranking prioritas dan command tekstual                        | Output ditujukan ke operator manusia              |

# 4. Personalisasi rule irigasi

Tahap 1 tidak memakai satu rule universal untuk semua sawah. Sistem
menggunakan pendekatan base rule + modifier. Base rule berasal dari AWD
dan fase tanam; modifier berasal dari bucket umur varietas, profil
sumber air, BMKG, dan event budidaya dinamis.

## 4.1 Profil personalisasi yang dipakai

- Bucket umur varietas padi terlebih dahulu, bukan nama varietas
  spesifik. Contoh: early, medium, late.

- Current growth phase dan HST aktif sebagai konteks rule aktual.

- Sumber air per field: irrigated, mixed, atau rainfed.

- Event budidaya dinamis: pupuk, herbisida, insektisida, fungisida,
  pestisida.

## 4.2 Prinsip pemanfaatan event budidaya

Event budidaya tidak diperlakukan sebagai jadwal kaku. Event dicatat
saat benar-benar terjadi di lapangan dan dipakai untuk memberi
tanda/peringatan tambahan kepada operator. Pada tahap 1, event belum
mengubah command secara paksa; sistem lebih aman bila menambahkan
warning, attention flag, atau penurunan confidence agar operator tetap
menjadi pengambil keputusan akhir.

| **Komponen**         | **Sifat**             | **Owner**      | **Dampak ke DSS**                                       |
|----------------------|-----------------------|----------------|---------------------------------------------------------|
| Template varietas    | Default bawaan sistem | Admin/agronom  | Menentukan baseline rule per bucket umur dan fase       |
| Water source profile | Tetap per field       | Admin          | Menentukan agresivitas AWD dan ketergantungan pada BMKG |
| Management event     | Dinamis per kebutuhan | Operator/admin | Menambah warning tekstual dan attention flag            |
| BMKG context         | Dinamis eksternal     | Sistem         | Memodifikasi prioritas dan validitas rekomendasi        |

# 5. Arsitektur frontend Tahap 1

Frontend tahap 1 menggunakan React SPA agar beban komputasi server tetap
kecil. Dengan Vite, dashboard dapat dibangun sebagai static app yang
ringan, sementara Tailwind dipakai untuk konsistensi visual dan
pengembangan modul yang cepat.

## Stack frontend

- React

- Vite

- Tailwind CSS

- OpenLayers untuk orthomosaic dan polygon spasial 2D

- Library charting seperti ECharts untuk histori dan panel status

## Modul frontend

| **Modul**                    | **Isi Utama**                                              | **Kegunaan**                                          |
|------------------------------|------------------------------------------------------------|-------------------------------------------------------|
| Auth & Field Access          | Login, role, field scoping                                 | Membatasi akses user sampai level field               |
| Overview Dashboard           | Ringkasan field, status aktif, alert dan weather           | Gambaran cepat kondisi operasional                    |
| Monitoring Map               | Orthomosaic, polygon sub-block, warna status, popup detail | Inti visual digital twin tahap 1                      |
| Telemetry & History          | Grafik water level, suhu, pressure, data freshness         | Menganalisis perubahan per kotak                      |
| Weather BMKG                 | Forecast, warning, rain category                           | Konteks cuaca untuk keputusan operator                |
| DSS Recommendations          | Ranking prioritas dan command                              | Menyajikan rekomendasi tindakan yang dapat dijalankan |
| Crop Cycle & Personalization | Bucket varietas, fase aktif, water source, event budidaya  | Mengatur konteks rule tiap field                      |
| Admin & Master Data          | Field, sub-block, device, flow path, template rule         | Menjaga data referensi sistem                         |

# 6. Arsitektur backend Tahap 1

Backend dipisah menjadi dua server agar monitoring tetap stabil dan
decision engine dapat berkembang terpisah. Server 1 adalah owner
platform dan database; Server 2 hanya fokus pada evaluasi logika
rekomendasi.

## 6.1 Server 1 - Platform Backend

- Node.js + Express

- PostgreSQL + PostGIS

- Object storage untuk orthomosaic

- Auth + RBAC per field

- Ingest telemetry dan normalisasi data

- Sinkronisasi BMKG

- State builder per sub-block

- Scheduler decision cycle

- Serving API untuk dashboard

## 6.2 Server 2 - Decision Engine

- Python + FastAPI

- Rule engine untuk padi dan AWD

- Weather fusion pada data yang sudah dinormalisasi

- Priority scoring dan recommendation generation

- Tidak menjadi owner database bisnis utama

# 7. Telemetry ingestion strategy

Strategi ingest yang direkomendasikan adalah hybrid. Perangkat atau
gateway boleh mengirim mini-batch berisi beberapa device demi efisiensi
jaringan, namun backend selalu menyimpan dan menormalkan data pada level
per-device/per-record. Pendekatan ini lebih aman dibanding memaksa satu
request besar lintas semua device atau request independen yang terlalu
sering.

| **Lapisan**      | **Rekomendasi**       | **Alasan**                                                      | **Catatan**                                              |
|------------------|-----------------------|-----------------------------------------------------------------|----------------------------------------------------------|
| Sampling device  | 15 menit              | Perubahan air sawah relevannya jam-ke-jam, bukan detik-ke-detik | Boleh disesuaikan setelah uji lapangan                   |
| Uplink telemetry | Mini-batch 30 menit   | Efisien untuk koneksi lapangan dan memudahkan retry             | Batch berisi device_id, timestamp, dan seq               |
| Decision cycle   | Default 60 menit      | Selaras dengan kebutuhan operasional manusia dan konteks BMKG   | Mode siaga dapat diturunkan menjadi 30 menit             |
| Freshness policy | Data \> 2 jam = stale | Mencegah ranking memakai data terlalu lama                      | Stale tetap ditampilkan tetapi tidak menjadi dasar utama |

# 8. Decision cycle dan rule engine

Decision cycle tidak dikaitkan langsung dengan datangnya telemetry.
Scheduler berjalan tetap per field, lalu memproses snapshot state
terkini, cuaca, dan rule profile. Pendekatan ini membuat perilaku sistem
stabil dan lebih cocok untuk DSS operasional.

## 8.1 Unit evaluasi dan unit output

- Unit evaluasi job: field

- Unit command: sub-block

- Unit arsip: crop cycle

## 8.2 Bentuk output

Rekomendasi disimpan dalam dua bentuk sekaligus: machine-readable untuk
logika aplikasi dan human-readable untuk operator.

| **Lapisan Output** | **Contoh Field**                                                                                       | **Tujuan**                                                             |
|--------------------|--------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------|
| Machine-readable   | recommendation_type, priority_score, from_sub_block_id, to_sub_block_id, via_flow_path_id, valid_until | Memudahkan ranking, filter, dan analytics                              |
| Human-readable     | command_template_code, command_text, reason_summary                                                    | Memperjelas tindakan yang harus dilakukan operator                     |
| Warning layer      | attention_flags_json, operator_warning_text, confidence_level                                          | Menandai adanya event budidaya atau kondisi yang perlu validasi manual |

# 9. Model data dan schema database

Tahap 1 menggunakan satu PostgreSQL database dengan empat schema: mst,
trx, sys, dan logs. Pembagian ini cukup rapi untuk memisahkan reference
data, transaksi aktif, mesin internal, dan jejak audit.

**mst -** Master/reference: user, role, field, sub-block, device, crop
cycle, template rule, flow path, map layer.

**trx -** Data aktif dan historis operasional: batch telemetry, raw
events, telemetry records, state, BMKG snapshot, recommendation,
orthomosaic upload.

**sys -** Mesin internal: decision_jobs, engine_configs, integration
configs, archive_jobs, scheduler_state.

**logs -** Audit dan troubleshooting: api_requests, api_errors,
engine_logs, integration_logs, auth_logs.

## 9.1 Tabel inti yang wajib ada

| **Schema.Table**               | **Peran**                   | **Kunci Utama**                          | **Catatan**                                    |
|--------------------------------|-----------------------------|------------------------------------------|------------------------------------------------|
| mst.fields                     | Unit evaluasi operasional   | id, geom, operator_count_default         | Scope auth per field                           |
| mst.sub_blocks                 | Unit keputusan digital twin | id, field_id, polygon_geom               | Polygon hasil digitasi manual dari orthomosaic |
| mst.flow_paths                 | Graph aliran antar kotak    | from_sub_block_id, to_sub_block_id       | Mendukung command flow transfer                |
| mst.crop_cycles                | Konteks fase tanam aktif    | sub_block_id, current_phase, current_hst | Satu sub-block satu crop cycle aktif           |
| mst.irrigation_rule_profiles   | Template rule personalisasi | duration_bucket, growth_phase            | Default template bawaan sistem                 |
| trx.telemetry_batches          | Header mini-batch telemetry | field_id, received_at                    | Payload tetap disimpan untuk audit             |
| trx.raw_events                 | Payload mentah per device   | batch_id, device_id, event_timestamp     | Source of truth mentah                         |
| trx.telemetry_records          | Data sensor ternormalisasi  | raw_event_id, water_level_cm             | Siap dipakai state builder                     |
| trx.sub_block_states           | State terkini per kotak     | sub_block_id, state_time, state_source   | Observed atau estimated                        |
| trx.weather_forecast_snapshots | Forecast BMKG per field     | field_id, valid_from, bmkg_category      | Dipakai decision engine                        |
| trx.management_events          | Event budidaya dinamis      | field_id/crop_cycle_id, event_type       | Hanya warning pada tahap 1                     |
| trx.irrigation_recommendations | Output DSS                  | field_id, sub_block_id, priority_rank    | Machine-readable + human-readable              |

# 10. Orthomosaic workflow

Orthomosaic tahap 1 dipakai sebagai base layer visual, bukan sebagai
input model utama. File fisik disimpan di object storage; database hanya
menyimpan metadata upload, status proses, dan layer aktif.

- Admin upload orthomosaic TIF/GeoTIFF.

- File disimpan ke object storage dalam bentuk raw dan turunan
  web-ready.

- Layer aktif dipublikasikan ke mst.map_layers.

- Admin melakukan digitasi manual polygon sub-block di atas orthomosaic.

- Polygon sub-block disimpan ke PostGIS dan menjadi unit visual
  sekaligus unit keputusan.

# 11. Auth dan access control

RBAC tahap 1 sengaja dibatasi sampai level field agar implementasinya
sederhana. Satu user dapat memiliki satu atau lebih field yang
diizinkan, dengan role yang relevan seperti operator lapangan, admin
kelompok tani, atau manajer lapangan.

- Field adalah scope akses minimum.

- Semua sub-block di dalam field mengikuti hak akses field.

- User-field mapping disimpan eksplisit agar mudah diaudit.

# 12. Arsip data

Data historis tidak dihapus saat satu siklus tanam selesai. Sistem
memakai strategi archive table yang dipicu ketika crop cycle ditutup.

- Tabel aktif tetap dipakai untuk operasi harian.

- Data satu crop cycle yang selesai dipindahkan ke tabel archive yang
  setara.

- History telemetry, state, recommendation, dan feedback menjadi
  kandidat utama arsip.

# 13. Risiko teknis dan keputusan yang masih terbuka

| **Topik**                     | **Keputusan Saat Ini**                                | **Catatan Lanjutan**                                |
|-------------------------------|-------------------------------------------------------|-----------------------------------------------------|
| Interval final decision cycle | Default 60 menit; 30 menit mode siaga                 | Perlu validasi lewat uji lapangan awal              |
| Cycle telemetry               | Sampling 15 menit; uplink 30 menit                    | Dapat disesuaikan setelah melihat perilaku air riil |
| Digitasi polygon              | Belum diputuskan lewat dashboard atau seed GIS        | Tentukan setelah modul admin peta dipilih           |
| Interpolasi state             | Hanya dari tetangga yang terhubung langsung dan fresh | Metode bisa ditingkatkan pada tahap berikutnya      |

# 14. Rekomendasi implementasi bertahap

- Bangun master spasial terlebih dahulu: field, sub-block, flow path,
  device assignment, crop cycle, rule profile.

- Lanjutkan ke ingest telemetry dan state builder.

- Tambahkan sinkronisasi BMKG dan scheduler decision cycle.

- Terakhir, aktifkan modul recommendation dashboard dan orthomosaic
  management.

# Lampiran ringkas: alur data sistem

> Telemetry/Gateway -\> Server 1 ingest API -\> trx.telemetry_batches
> -\> trx.raw_events -\> trx.telemetry_records -\>
> trx.sub_block_states  
> BMKG -\> Server 1 weather sync -\> trx.weather_forecast_snapshots /
> trx.weather_warning_snapshots  
> Scheduler 60 menit -\> sys.decision_jobs -\> Server 2 Decision Engine
> -\> trx.irrigation_recommendations  
> Dashboard React -\> Server 1 serving API -\> orthomosaic + polygon
> sub-block + state + weather + recommendation

# Referensi singkat

1\. BMKG Open Data - prakiraan cuaca 3 hari, interval 3 jam, batas akses
60 request/menit/IP.

2\. IRRI Knowledge Bank - AWD, growth stages, dan praktik pengelolaan
air padi.

3\. FAO - klasifikasi sistem padi irrigated vs rainfed dan implikasi
manajemen air.
