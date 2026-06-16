# 🏗️ TIER 1: Arsitektur Utama Sistem (C4 Model)

## 1. Ikhtisar Arsitektur
Proyek Smart AWD dipecah menjadi beberapa *Microservices* yang memiliki tugas spesifik untuk menghindari titik tunggal kegagalan (*Single Point of Failure*). Diagram di bawah ini merepresentasikan Model Arsitektur C4 tingkat *Container/Component* yang menunjukkan aliran komunikasi antar-modul di *Cloud/On-Premise*.

## 2. Diagram C4 Komponen & Aliran Data
```mermaid
flowchart LR
    %% Entitas Eksternal
    subgraph External [Dunia Eksternal]
        Operator(["👤 Petani / Operator"])
        Drone(["🚁 Drone DJI"])
        SensorIoT(["📡 Sensor IoT"])
        BMKG(["⛈️ BMKG API"])
    end

    %% Web Client
    FE["🖥️ FrontEnd (React)"]

    %% Backend Monolith
    subgraph BE_Cluster [Backend Layer (Node.js)]
        BE_API["⚙️ Main API (Express)"]
        BE_Cron["⏱️ Background Jobs"]
        MQTT_Broker["✉️ MQTT Broker"]
    end

    %% Python Services
    subgraph Model_Cluster [AI & Model Layer (Python)]
        DSS["🤖 DSS Engine"]
        Titiler["🗺️ Titiler Map"]
    end

    subgraph GIS_Cluster [GIS Processing Layer]
        GIS_API["📐 GIS API"]
        ARQ["🛠️ ARQ Worker"]
    end

    %% Storage & Infrastructure
    subgraph Storage [Lumbung Data]
        Postgres[("🐘 PostGIS")]
        Timescale[("📈 TimescaleDB")]
        Redis[("🔴 Redis Cache")]
        R2[("☁️ Cloudflare R2")]
        WebODM["🏗️ WebODM (Docker)"]
    end

    %% --------------------------------
    %% Relasi yang dirapikan (Linear)
    %% --------------------------------

    %% Flow UI
    Operator -->|"Akses Web"| FE
    FE <-->|"REST API"| BE_API
    FE <-->|"XYZ Tiles"| Titiler

    %% Flow IoT
    SensorIoT -->|"Publish"| MQTT_Broker
    MQTT_Broker -->|"Ingest"| BE_Cron
    BE_Cron -->|"Simpan Timeseries"| Timescale

    %% Flow Drone
    Drone -->|"Upload"| WebODM
    WebODM -.->|"TIF to COG"| R2
    R2 -.->|"Load Map"| Titiler

    %% Flow Sistem Keputusan (DSS & GIS)
    BE_Cron -->|"Fetch Weather"| BMKG
    BE_Cron <-->|"Kirim State & Rules"| DSS
    BE_API <-->|"Kueri Rute Air"| GIS_API
    GIS_API <-->|"Antrean Task"| Redis
    Redis <-->|"Proses Matriks"| ARQ

    %% Flow Database Relasional
    BE_API <-->|"Kueri PostGIS"| Postgres
    BE_Cron <-->|"Update State"| Postgres
```

## 3. Penjelasan Interaksi
- **Pemisahan Penayangan Peta:** Backend Node.js sama sekali tidak memproses aset gambar peta. *FrontEnd* menarik lapisan poligon dan data rekomendasi dari Backend, tetapi menarik ubin peta (*Tiles*) secara terpisah dari `Titiler` yang terhubung langsung ke `Cloudflare R2`.
- **Komunikasi Internal (Internal Network):** Komunikasi antara Node.js dengan Python (DSS Engine dan GIS) dilakukan secara REST API privat tanpa ter-ekspos ke internet luar.
- **Isolasi Tugas Berat:** Semua beban perhitungan berat (*All-Pairs Shortest Path*) dilepaskan ke luar FastAPI melalui antrean *Redis* dan diproses oleh *Worker Daemon*.
