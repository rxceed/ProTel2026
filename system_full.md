---
title: "Ringkasan Sistem Smart AWD DSS"
subtitle: "Visi Produk, Modul Bisnis, Arsitektur Teknis, dan Roadmap Implementasi"
author: "-"
date: "-"
geometry: margin=1in
fontsize: 11pt
toc: true
toc-depth: 2
colorlinks: true
linkcolor: blue
header-includes:
  - \usepackage{titlesec}
  - \usepackage{xcolor}
  - \usepackage{longtable}
  - \usepackage{booktabs}
  - \usepackage{array}
  - \usepackage{tabularx}
  - \usepackage{enumitem}
  - \setlength{\parskip}{6pt}
  - \setlength{\parindent}{0pt}
  - \definecolor{Accent}{HTML}{1F4E79}
  - \definecolor{SoftGray}{HTML}{5A5A5A}
  - \titleformat{\section}{\Large\bfseries\color{Accent}}{\thesection}{0.75em}{}
  - \titleformat{\subsection}{\large\bfseries\color{Accent}}{\thesubsection}{0.75em}{}
  - \titleformat{\subsubsection}{\normalsize\bfseries\color{Accent}}{\thesubsubsection}{0.75em}{}
---

\newpage

# Ringkasan eksekutif

Sistem yang dirancang adalah **Smart AWD DSS untuk padi**: platform digital yang menggabungkan monitoring lahan, weather fusion, digital twin spasial, dan decision support system (DSS) untuk irigasi presisi. Titik beratnya bukan sekadar menampilkan data sensor, tetapi membantu operator lapangan, admin kelompok tani, dan manajer lapangan mengambil keputusan irigasi yang lebih tepat, lebih hemat air, dan tetap menjaga hasil budidaya.

Sistem ini berangkat dari pendekatan **integrated AWD**. Setiap field dibagi menjadi beberapa **sub-block/kotak sawah** sebagai unit keputusan. Sensor berfungsi sebagai sumber observasi, tetapi rekomendasi sistem dikeluarkan per kotak, bukan per device. Sistem juga mengakomodasi realitas lapangan: tidak semua kotak wajib memiliki device sendiri, sehingga state kotak dapat berasal dari **observed state** atau **estimated state** berdasarkan tetangga dan graph aliran air.

Pada tahap awal, sistem difokuskan ke **dashboard web 2D** dengan orthomosaic, polygon digitize, weather fusion BMKG, rule-based decision engine, dan role-based access hingga level field. Tahap berikutnya memperluas dashboard menjadi 3D geospatial, lalu menambahkan aplikasi Android untuk operasional lapangan.

# Tujuan sistem

## Tujuan utama

1. Memonitor kondisi air per kotak sawah secara digital.
2. Menyatukan telemetry lapangan, orthomosaic, dan prakiraan cuaca dalam satu dashboard operasional.
3. Menghasilkan rekomendasi irigasi berbasis rule engine yang dapat dibaca manusia dan dipakai operator.
4. Mendukung precision irrigation yang dipersonalisasi berdasarkan varietas padi, fase tanam, sumber air, dan event lapangan.
5. Menjadi fondasi menuju digital twin sawah dan DSS climate-smart agriculture.

## Nilai praktis yang ingin dicapai

- Penggunaan air lebih efisien.
- Prioritas irigasi per kotak lebih jelas.
- Operator tidak hanya melihat angka sensor, tetapi memahami **apa yang harus dilakukan**.
- Sistem tetap berguna walaupun AI/model belum kompleks, karena rule-based engine sudah cukup untuk operasi tahap awal.
- Struktur data dan arsitektur sudah siap dikembangkan ke 3D, Android, dan model prediktif yang lebih canggih.

# Masalah yang diselesaikan

Sistem ini ditujukan untuk mengatasi beberapa masalah lapangan yang sering muncul pada pengelolaan irigasi padi:

- Pengambilan keputusan masih sangat manual dan bergantung pada intuisi.
- Kondisi air tiap kotak sawah tidak selalu terbaca seragam.
- Weather uncertainty membuat keputusan irigasi sering terlambat atau tidak presisi.
- Pola irigasi tidak bisa disamaratakan untuk semua varietas padi dan semua fase tanam.
- Event lapangan seperti pemupukan, herbisida, fungisida, insektisida, atau pestisida dapat memengaruhi cara operator membaca kondisi air, tetapi sering tidak tercatat secara sistemik.
- Data spasial, data sensor, dan keputusan operasional biasanya terpisah di banyak tempat.

# Ruang lingkup roadmap

## Tahap 1 - Dashboard web 2D

Fokus tahap 1:

- dashboard web internal
- orthomosaic 2D
- digitize polygon sub-block dari orthomosaic
- telemetry ingestion
- weather fusion BMKG
- state builder per kotak
- rule-based decision engine
- rekomendasi irigasi untuk operator manusia
- role-based access hingga level field

Belum termasuk pada tahap 1:

- point cloud 3D
- aplikasi Android lapangan
- kontrol aktuator otomatis
- model ML penuh untuk optimasi irigasi

## Tahap 2 - Dashboard web 3D

Fokus tahap 2:

- visualisasi 3D berbasis point cloud / raster 3D
- perluasan digital twin geospatial
- analisis spasial lanjutan pada web dashboard

## Tahap 3 - Android lapangan

Fokus tahap 3:

- aplikasi Android untuk pengguna lapangan
- input event, feedback, dan operasional lapangan
- sinkronisasi data mobile
- perluasan pengalaman operator di area sawah

# Pemangku kepentingan dan peran pengguna

## Peran utama pengguna

| Peran | Fokus penggunaan | Scope akses |
|---|---|---|
| Operator lapangan | Membaca rekomendasi, melihat kondisi kotak, menjalankan tindakan irigasi | Field tertentu |
| Admin kelompok tani | Mengelola data field, sub-block, crop cycle, orthomosaic, dan operasional | Field tertentu / beberapa field |
| Manajer lapangan | Memantau prioritas, histori, dan performa rekomendasi | Satu atau beberapa field |

## Prinsip role-based access

Scope akses tahap 1 dibatasi hingga level **field**. Artinya, user diberi akses ke satu atau lebih field, dan semua sub-block di dalam field tersebut otomatis dapat dilihat.

# Unit bisnis dan domain inti

## Unit evaluasi dan unit keputusan

- **Unit evaluasi**: field
- **Unit keputusan**: sub-block atau kotak sawah
- **Unit observasi**: device sensor
- **Unit personalisasi budidaya**: crop cycle aktif

## Hierarki domain

```text
Site
  -> Field
      -> Sub-block / Kotak sawah
          -> Crop cycle aktif
          -> Device assignment (opsional)
```

## Entitas paling penting

1. **Field** sebagai unit operasi, weather context, dan auth scope.
2. **Sub-block** sebagai polygon spasial dan unit DSS.
3. **Flow path** sebagai graph aliran antar kotak.
4. **Crop cycle** sebagai konteks fase tanam aktif.
5. **Recommendation** sebagai output keputusan yang bisa ditindak operator.

# Prinsip personalisasi sistem

Sistem harus mengakomodasi personalisasi, tetapi dengan desain yang tetap realistis untuk tahap awal. Pendekatan yang dipilih adalah **base rule + modifier**.

## 1. Personalisasi umur varietas padi

Tahap awal memakai **bucket** terlebih dahulu, bukan varietas sangat rinci per nama dagang. Contoh bucket:

- 70-80 hari
- 90-100 hari
- 100-120 hari
- 120-140 hari

Tujuannya adalah memberi baseline rule yang mudah dipilih pengguna, tetapi database tetap bisa diperluas untuk varietas lebih rinci nanti.

## 2. Personalisasi fase tanam

Sistem memakai label fase sebagai acuan utama, lalu HST menjadi turunannya. Ini membuat rule lebih mudah dipahami di dashboard dan lebih mudah dikaitkan ke crop cycle aktif.

Contoh fase:

- vegetatif awal
- vegetatif lanjut
- reproduktif
- pemasakan

## 3. Personalisasi sumber air

Profil sumber air per field cukup disederhanakan menjadi:

- irrigated
- mixed
- rainfed

Ini penting karena field dengan air terkontrol dan field yang sangat bergantung pada hujan jelas membutuhkan perilaku rekomendasi yang berbeda.

## 4. Personalisasi event lapangan

Semua event lapangan yang berpotensi memengaruhi pembacaan siklus air atau keputusan operator dicatat sebagai **management events**, misalnya:

- pupuk
- herbisida
- fungisida
- insektisida
- pestisida

Event tersebut **tidak diperlakukan sebagai jadwal kaku**, tetapi sebagai kejadian dinamis sesuai kebutuhan lapangan.

Pada tahap 1, event ini berfungsi sebagai:

- warning / attention flag
- tambahan context untuk operator
- penambah reason summary pada rekomendasi

Event dapat berlaku pada level **field**, namun bisa juga diarahkan ke **sub-block tertentu** di dalam field tersebut.

## 5. Prioritas objektif keputusan

Sistem tidak menggunakan satu prioritas tunggal untuk semua kondisi. Namun, arah objektif umumnya adalah:

1. hemat air
2. menjaga hasil budidaya
3. keselamatan budidaya
4. kepatuhan terhadap event lapangan

Ke depan, objektif ini bisa diwujudkan sebagai preset policy per field atau per crop cycle.

# Gambaran solusi tahap 1

## Komponen solusi utama

1. **Monitoring layer**
   - membaca telemetry
   - menampilkan state air per kotak
   - memetakan kondisi pada dashboard

2. **Weather fusion layer**
   - mengambil dan menormalisasi forecast BMKG
   - menyatukan weather context ke level field

3. **Spatial twin layer**
   - menyimpan polygon sub-block
   - menyimpan orthomosaic dan flow path
   - menjadi peta dasar digital twin

4. **Decision engine layer**
   - mengevaluasi kondisi air, fase tanam, cuaca, sumber air, dan event lapangan
   - memberi ranking dan command recommendation

5. **Serving layer**
   - menyajikan data final ke frontend modular

# Stack teknologi tahap 1

## Frontend

- React
- Vite
- TypeScript
- Tailwind CSS
- shadcn/ui
- OpenLayers
- Deploy: Cloudflare Pages

## Backend platform (Server 1)

- NestJS
- TypeScript
- JWT
- BullMQ
- Hosting: Railway

## Decision engine dan raster service (Server 2)

- Python
- FastAPI
- TiTiler
- Hosting: Railway

## Data layer dan queue

- Database: Timescale Cloud (PostgreSQL + PostGIS + TimescaleDB)
- Redis: Upstash Redis
- Storage: Cloudflare R2

## Fungsi stack secara singkat

| Komponen | Fungsi utama |
|---|---|
| React + Vite + Tailwind + shadcn/ui | Dashboard modular, UI internal, interaksi operator |
| OpenLayers | Peta 2D, orthomosaic, polygon sub-block |
| NestJS | API utama, auth, orchestration, ingestion, scheduler |
| BullMQ + Redis | Queue untuk decision jobs dan background processing |
| FastAPI | Decision engine dan layanan analitik/servis Python |
| TiTiler | Penyajian raster / COG ke frontend map |
| Timescale Cloud | Penyimpanan relational, geospatial, dan time-series |
| Cloudflare R2 | Penyimpanan GeoTIFF / COG |
| Cloudflare Pages | Hosting frontend static |

# Arsitektur sistem tingkat tinggi

```text
Frontend (React + Vite + Tailwind + shadcn/ui + OpenLayers)
    |
    v
Server 1 - NestJS Platform Backend
    |
    |-- Auth / RBAC
    |-- Telemetry Ingestion
    |-- Weather Sync BMKG
    |-- Scheduler
    |-- API Serving
    |
    +--> Queue (BullMQ + Upstash Redis)
    |       |
    |       v
    |   Decision Jobs
    |
    +--> Server 2 - FastAPI + TiTiler
    |       |
    |       |-- Rule Engine / DSS
    |       |-- Weather Fusion Support
    |       |-- Raster Tile Service
    |
    +--> Timescale Cloud
    |
    +--> Cloudflare R2
```

## Prinsip pembagian tanggung jawab

### Server 1 sebagai owner platform

Server 1 memegang tanggung jawab untuk:

- auth dan RBAC
- API utama frontend
- ingest telemetry
- penyimpanan raw dan normalized data
- weather sync BMKG
- scheduler decision cycle
- queue orchestration
- ownership data bisnis utama

### Server 2 sebagai decision dan geospatial service

Server 2 fokus pada:

- rule evaluation / DSS
- rekomendasi irigasi
- scoring dan ranking
- serving raster tiles / geospatial service Python

Server 2 **bukan** owner database bisnis utama.

# Modul frontend tahap 1

Dashboard tidak dirancang sebagai satu halaman tunggal yang sangat padat. Sistem frontend dibagi menjadi beberapa modul agar lebih mudah dipahami, dirawat, dan dikembangkan.

## Modul utama frontend

1. **Authentication & Access**
2. **Overview Dashboard**
3. **Field Monitoring Map**
4. **Sub-block & Polygon Management**
5. **Orthomosaic Layer Management**
6. **Telemetry & History**
7. **Weather BMKG**
8. **DSS Recommendations**
9. **Crop Cycle & Personalization**
10. **Admin / Master Data**

## Peran OpenLayers di frontend

OpenLayers digunakan untuk:

- menampilkan orthomosaic 2D
- menampilkan polygon sub-block
- menampilkan flow path antar kotak
- memberi warna status per kotak
- menghubungkan rekomendasi dengan objek spasial

## Prinsip UI yang diinginkan

- modular, bukan satu halaman raksasa
- data operasional harus mudah dibaca operator
- rekomendasi harus tampil sebagai tindakan, bukan hanya angka
- warna, badge, dan status harus memperjelas prioritas
- dashboard tetap usable walaupun user tidak membuka semua modul sekaligus

# Modul backend tahap 1

## Modul Server 1

1. **Auth & RBAC Module**
2. **Telemetry Ingestion Module**
3. **Weather Sync Module**
4. **State Builder Module**
5. **Queue & Scheduler Module**
6. **Recommendation Serving Module**
7. **Orthomosaic Metadata Module**
8. **Master Data Module**
9. **Archive Module**

## Modul Server 2

1. **Decision Engine Module**
2. **Recommendation Generator**
3. **Raster Tile Service (TiTiler)**
4. **Support services for future AI/ML expansion**

# Desain ingest telemetry

## Prinsip ingest yang dipilih

Solusi terbaik untuk tahap awal adalah **hybrid mini-batch**.

Artinya:

- sampling tetap dilakukan per device
- uplink ke server dapat berbentuk mini-batch beberapa device sekaligus
- setelah masuk backend, data tetap dipecah menjadi raw event per device

Dengan cara ini, sistem tetap efisien dari sisi uplink, tetapi konsisten dari sisi penyimpanan dan analytics.

## Rekomendasi cadence tahap awal

### Sensor sampling

- sekitar setiap 15 menit

### Telemetry uplink

- sekitar setiap 30 menit dalam mini-batch
- boleh lebih cepat bila ada reconnect atau crossing threshold penting

### Decision cycle

- default setiap 60 menit
- dapat diturunkan ke 30 menit pada kondisi siaga tertentu

## Alasan pemisahan cycle

Decision cycle **tidak berhubungan langsung** dengan cycle datangnya data sensor. Pemisahan ini penting agar:

- sistem lebih stabil
- rekomendasi lebih konsisten
- weather fusion tetap masuk akal
- operator tidak menerima perubahan keputusan terlalu sering

## Data freshness

Bila data sensor terlalu lama, state dianggap **stale**. State stale tidak langsung dibuang, tetapi ditandai agar tidak dipakai sebagai dasar ranking utama.

# Weather integration

## Sumber cuaca

Sistem menggunakan data BMKG untuk memberi konteks prakiraan dan peringatan cuaca pada level field.

## Fungsi weather di sistem

- menunda atau menurunkan prioritas irigasi saat risiko hujan signifikan meningkat
- memberi warning context pada decision engine
- membantu operator memahami kondisi beberapa jam ke depan

## Scope weather

Weather context dipakai pada level **field**, bukan langsung per sub-block.

# Desain crop cycle dan personalisasi

## Crop cycle sebagai unit aktif

Setiap sub-block memiliki **satu crop cycle aktif**. Crop cycle menyimpan:

- bucket varietas / durasi
- fase aktif
- HST aktif
- rule profile yang dipilih

## Default template

Sistem menyediakan template bawaan berdasarkan database varietas / duration bucket. User tidak perlu membuat semuanya dari nol.

## Rule profile

Rule profile minimal memuat:

- fase
- HST start-end
- water level minimum
- target water level
- batas atas
- kebijakan terhadap hujan ringan
- bobot prioritas

# State model per kotak

Setiap sub-block memiliki state operasional yang dibaca decision engine.

## Jenis state

### Observed state

Berasal langsung dari sensor/device yang aktif di kotak tersebut.

### Estimated state

Dipakai bila kotak tidak memiliki sensor langsung, dengan estimasi dari tetangga yang terhubung di flow path dan masih memiliki data fresh.

## Konsekuensi desain

State builder menjadi komponen penting, karena decision engine tidak sebaiknya membaca raw telemetry mentah setiap kali evaluasi.

# Decision engine tahap 1

## Pendekatan umum

Decision engine tahap 1 masih **rule-based**, belum AI model penuh. Namun struktur sistem dibuat agar mudah diperluas ke model prediktif di tahap berikutnya.

## Input utama decision engine

- sub-block states
- crop cycle aktif
- irrigation rule profile
- weather snapshot BMKG
- water source profile
- flow path graph
- operator count per field
- management events aktif

## Logika umum

Base rule diturunkan dari AWD dan profil padi. Kemudian recommendation dimodifikasi oleh:

- varietas / duration bucket
- fase tanam
- sumber air field
- weather condition
- event lapangan yang memerlukan perhatian operator

## Output decision engine

Output recommendation harus punya dua bentuk sekaligus:

### Machine-readable

- recommendation type
- priority score
- priority rank
- from sub-block
- to sub-block
- flow path id
- valid until

### Human-readable

- command template code
- command text
- reason summary
- operator warning text

## Contoh output command

- Prioritaskan irigasi Kotak B.
- Tunda irigasi Kotak D.
- Alirkan air dari Kotak A ke Kotak B melalui Jalur C.

# Management events

## Fungsi management events

Management events adalah catatan kejadian lapangan yang dapat memengaruhi interpretasi operator terhadap keputusan air.

Contoh event:

- pemupukan
- herbisida
- fungisida
- insektisida
- pestisida

## Prinsip tahap 1

Event tidak otomatis mengubah jadwal air secara kaku. Event berfungsi sebagai:

- warning flag
- attention modifier
- tambahan context untuk operator

Event dapat berlaku ke seluruh field, atau spesifik ke sub-block tertentu di dalam field tersebut.

# Orthomosaic dan digital twin spasial

## Fungsi orthomosaic

Orthomosaic berfungsi sebagai:

- base layer visual digital twin
- acuan digitize sub-block
- konteks visual monitoring lapangan

## Workflow orthomosaic tahap 1

1. orthomosaic diunggah ke storage
2. metadata dicatat di backend
3. layer dipublish ke dashboard
4. admin melakukan digitize polygon sub-block secara manual
5. flow path antar sub-block dipetakan manual

## Penyimpanan file dan metadata

- file orthomosaic / GeoTIFF / COG disimpan di **Cloudflare R2**
- metadata upload dan publish disimpan di database
- penyajian tile / raster dilakukan melalui **TiTiler**

# Desain data dan schema database

Basis data memakai pola empat schema utama:

- `mst`
- `trx`
- `sys`
- `logs`

## Schema `mst`

Menampung reference/master data seperti:

- users
- roles
- permissions
- field access
- sites
- fields
- sub blocks
- flow paths
- devices
- device assignments
- rice duration buckets
- growth phases
- crop cycles
- irrigation rule profiles
- weather sources
- map layers
- field operator configs

## Schema `trx`

Menampung data transaksi utama seperti:

- telemetry batches
- raw events
- telemetry records
- sub-block states
- weather snapshots
- irrigation recommendations
- recommendation feedback
- orthomosaic uploads
- orthomosaic publish history
- management events

## Schema `sys`

Menampung internal system tables seperti:

- decision jobs
- job attempts
- engine configs
- scheduler state
- integration configs
- archive jobs

## Schema `logs`

Menampung audit dan observability seperti:

- api requests
- api errors
- auth logs
- engine logs
- integration logs
- user activity logs

# Alur data tahap 1

## 1. Telemetry flow

```text
Device sampling
  -> mini-batch uplink
  -> Server 1 ingestion
  -> raw events
  -> telemetry records
  -> sub-block states
```

## 2. Weather flow

```text
BMKG source
  -> Server 1 weather sync
  -> normalized forecast snapshots
  -> decision input per field
```

## 3. Recommendation flow

```text
Scheduler per 60 menit
  -> decision job per field
  -> Queue (BullMQ)
  -> Server 2 rule engine
  -> irrigation recommendation
  -> frontend serving
```

## 4. Orthomosaic flow

```text
Upload raster
  -> Cloudflare R2
  -> metadata saved
  -> TiTiler serves tiles
  -> OpenLayers renders map
  -> admin digitizes polygons
```

# Strategy queue dan background processing

## BullMQ sebagai queue layer

BullMQ dipakai untuk:

- decision jobs
- weather sync jobs
- orthomosaic processing jobs
- archive jobs

## Upstash Redis sebagai managed Redis

Redis digunakan sebagai backend queue dan job state untuk BullMQ.

## Scheduler policy

Decision cycle berjalan tetap, bukan event-driven murni, agar hasil rekomendasi lebih konsisten dan mudah dibaca operator.

# Arsip dan siklus hidup data

## Prinsip arsip

Data tidak dihapus ketika satu siklus tanam selesai. Data akan **diarsipkan**.

## Unit arsip

Arsip mengacu pada **crop cycle**, bukan sekadar tanggal global.

## Data yang layak diarsipkan

- telemetry history
- sub-block states history
- recommendation history
- feedback history
- management events history

# Keamanan dan akses

## Autentikasi

- JWT untuk sesi user

## Otorisasi

- akses berbasis role
- scope akses berdasarkan field

## Prinsip keamanan tahap 1

- API backend menjadi satu pintu masuk utama
- frontend tidak berbicara langsung ke database
- raster access dan data serving tetap dikendalikan oleh arsitektur backend yang jelas

# Batasan tahap 1

Tahap 1 sengaja dibatasi agar sistem tetap realistis untuk dibangun.

## Belum termasuk

- aplikasi Android operasional lapangan
- point cloud 3D
- aktuasi otomatis ke pintu air
- model ML prediktif penuh
- workflow feedback operator yang sangat detail
- optimasi lintasan operator multi-constraint yang kompleks

# Risiko dan perhatian implementasi

## 1. Akurasi topologi aliran

Flow path harus dipetakan cukup baik agar command seperti "alirkan air dari A ke B" tidak sekadar asumsi text.

## 2. Kualitas orthomosaic dan digitize

Karena polygon sub-block dibangun manual dari orthomosaic, kualitas digitize akan sangat memengaruhi kualitas digital twin.

## 3. State estimasi

Kotak tanpa sensor perlu estimated state. Ini membantu cakupan, tetapi quality flag harus jelas agar operator tidak menganggap semua nilai sama presisinya.

## 4. Personalization creep

Sistem punya banyak faktor personalisasi. Tahap 1 harus dijaga agar tidak terlalu kompleks. Prinsip yang aman adalah default template + warning modifiers, bukan rule super detail untuk semua hal sekaligus.

## 5. Ketergantungan pada disiplin input lapangan

Management events dan crop cycle hanya akan berguna bila benar-benar diisi dan dijaga oleh user/admin.

# Definisi keberhasilan tahap 1

Tahap 1 dapat dianggap berhasil bila sistem sudah mampu:

1. menampilkan orthomosaic dan polygon sub-block per field
2. menerima telemetry mini-batch dari beberapa device
3. membangun state observed / estimated per kotak
4. menggabungkan weather context dari BMKG
5. menghasilkan ranking dan command recommendation per kotak
6. membatasi akses user hingga level field
7. mendukung crop-cycle personalization dasar
8. mencatat management events sebagai warning context

# Arah pengembangan setelah tahap 1

## Tahap 2

- 3D dashboard
- point cloud / model geospatial lanjutan
- digital twin yang lebih kaya

## Tahap 3

- aplikasi Android lapangan
- workflow feedback operator
- mobile data capture dan field execution support

## Jangka panjang

- model prediktif irigasi yang lebih canggih
- optimasi rekomendasi berbasis histori nyata
- DSS yang makin adaptif terhadap perilaku lahan, varietas, dan pola operasional

# Penutup

Secara keseluruhan, sistem ini bukan hanya dashboard teknis, tetapi **platform keputusan irigasi untuk padi**. Nilai utamanya ada pada kemampuan menghubungkan telemetry, weather, peta orthomosaic, crop cycle, dan konteks lapangan menjadi rekomendasi operasional yang bisa dipakai manusia. Tahap 1 sengaja dibangun dengan fondasi yang cukup kuat: modular, geospatial, role-based, personalized, dan siap diperluas ke tahap 3D maupun mobile tanpa harus merombak keseluruhan arsitektur.
