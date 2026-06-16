# 🗺️ TIER 2 (BackEnd): Routing Orchestrator

## 1. Mekanisme Kerja
Modul `routing.service.ts` adalah "Penerjemah". Bahasa PostgreSQL dan FrontEnd adalah Bahasa GeoJSON (Bentuk peta petak/poligon). Sedangkan Bahasa untuk menghitung *Shortest Path* air adalah Bahasa *Graf Node & Vertex* matematika.
Orkestrator ini menarik titik berat tengah (*Centroid*) per-petak menggunakan PostGIS, menyusunnya dalam struktur matriks Graf, menembakkannya ke server *Ricemesh GIS*, kemudian menerjemahkan indeks yang dikembalikan menjadi array ID Petak untuk disimpan di database.

## 2. Sequence Diagram Pemanggilan API
```mermaid
sequenceDiagram
    autonumber
    participant Engine Client as 🧠 BE: engine-client.service
    participant Orchestrator as 🗺️ BE: routing.service.ts
    participant DB as 🗄️ PostgreSQL (PostGIS)
    participant GIS API as ⚙️ GIS Processing (Python)
    
    Engine Client->>Orchestrator: runWaterRouting(recommendations)
    
    Note over Orchestrator: Menentukan Petak "Sumbang Air" (DRAIN) <br/> dan "Butuh Air" (IRRIGATE) berdasarkan Prioritas
    
    Orchestrator->>DB: Kueri ST_Centroid() & ST_AsText() dari seluruh petak
    DB-->>Orchestrator: Hasil (Point X Y, water_height, optimal_height)
    
    Orchestrator->>GIS API: POST /run (num_nodes, nodes, edges)
    Note over GIS API: Menjalankan Worker Floyd-Warshall
    GIS API-->>Orchestrator: Respon Matriks Suksesor (D & P)
    
    Orchestrator->>GIS API: POST /matrix (Kirim Source Index & Target Index)
    GIS API-->>Orchestrator: Array Indeks [0, 1, 4]
    
    Note over Orchestrator: Menerjemahkan Indeks: 0 -> "UUID-A", 1 -> "UUID-B"
    
    Orchestrator->>DB: UPDATE trx.irrigation_recommendations <br/> SET route_path_ids = ["UUID-A", "UUID-B"]
    DB-->>Orchestrator: Berhasil disimpan
```

## 3. Hubungan ke Modul Lain
Ini merupakan langkah *Final/Terakhir* dalam siklus evaluasi pintar (DSS). Hasil dari modul ini langsung dibaca secara *real-time* oleh **FrontEnd** untuk menganimasi panah alur air dari sawah sumber hingga sawah tujuan di atas peta *OpenLayers*.
