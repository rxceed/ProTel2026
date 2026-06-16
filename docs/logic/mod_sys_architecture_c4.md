# 🏗️ TIER 1: Arsitektur Utama Sistem (C4 Model)

## 1. Ikhtisar Arsitektur
Proyek Smart AWD dipecah menjadi beberapa *Microservices* yang memiliki tugas spesifik untuk menghindari titik tunggal kegagalan (*Single Point of Failure*). Diagram di bawah ini merepresentasikan Model Arsitektur C4 tingkat *Container/Component* yang menunjukkan aliran komunikasi antar-modul di *Cloud/On-Premise*.

## 2. Diagram C4 Komponen & Aliran Data
```mermaid
graph TD
    %% Entitas Eksternal
    Operator([👤 Operator / Petani])
    Drone([🚁 DJI Drone])
    SensorIoT([📡 Sensor IoT (ESP32)])
    BMKG([⛈️ API Cuaca BMKG])

    %% Sistem Utama
    subgraph KLASTER SISTEM SMART AWD
        
        FE["🖥️ FrontEnd Web (React/OpenLayers)"]
        
        BE["⚙️ BackEnd Server (Node.js/Express)"]
        
        subgraph Python_Cluster ["🧠 Python Microservices"]
            DSS["🤖 Decision Engine (FastAPI)"]
            Titiler["🗺️ Titiler COG Server"]
            GIS["📐 GIS Processing (FastAPI)"]
            ARQ["⏱️ ARQ Redis Worker"]
        end
        
        WebODM["🏗️ WebODM (Docker Cluster)"]
        
        subgraph Database_Cluster ["🗄️ Database Polyglot"]
            Postgres[("Relational & PostGIS")]
            Timescale[("TimescaleDB (Hypertable)")]
            Redis[("Redis Memory Cache")]
        end
        
        Cloudflare[("☁️ Cloudflare R2 (Object Storage)")]
        MQTT["✉️ MQTT Broker (Mosquitto)"]
    end

    %% Hubungan dan Aliran
    Operator -->|Interaksi UI| FE
    Drone -->|Upload Foto (.jpg)| WebODM
    SensorIoT -->|Publish JSON| MQTT
    
    %% Aliran Backend
    MQTT -->|Subscribe/Ingest| BE
    BMKG -->|Fetch Weather| BE
    BE -->|Read/Write Master & Spatial| Postgres
    BE -->|Batch Insert Sensor Data| Timescale
    
    %% Aliran Visual & Drone
    WebODM -.->|Konversi TIF to COG| Cloudflare
    Cloudflare -.->|Byte Range Read| Titiler
    Titiler -->|Serve XYZ Map Tiles| FE
    BE -->|Serve API (Auth, Field Data)| FE
    
    %% Aliran Algoritma
    BE <-->|Evaluate Req/Res| DSS
    BE -->|Post Centroid Graph| GIS
    GIS -->|Enqueue Task| Redis
    Redis -->|Dequeue & Compute| ARQ
    ARQ -->|Result| Redis
    Redis -->|Poll Result| GIS
```

## 3. Penjelasan Interaksi
- **Pemisahan Penayangan Peta:** Backend Node.js sama sekali tidak memproses aset gambar peta. *FrontEnd* menarik lapisan poligon dan data rekomendasi dari Backend, tetapi menarik ubin peta (*Tiles*) secara terpisah dari `Titiler` yang terhubung langsung ke `Cloudflare R2`.
- **Komunikasi Internal (Internal Network):** Komunikasi antara Node.js dengan Python (DSS Engine dan GIS) dilakukan secara REST API privat tanpa ter-ekspos ke internet luar.
- **Isolasi Tugas Berat:** Semua beban perhitungan berat (*All-Pairs Shortest Path*) dilepaskan ke luar FastAPI melalui antrean *Redis* dan diproses oleh *Worker Daemon*.
