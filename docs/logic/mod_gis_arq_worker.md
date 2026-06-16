# ⏱️ TIER 4 (GIS): ARQ Redis Worker

## 1. Mekanisme Kerja
Jika *Frontend* menanyakan rute air secara terus-menerus dan algoritma di *TIER 4* (Floyd-Warshall) dilakukan di dalam fungsi `async def /run`, maka API Python FastAPI akan memblokir (*Blocked*) server karena komputasi matriks V³ itu *Synchronous CPU Bound*.
Mekanisme `arq` dengan `Redis` mengatasi hal ini dengan sistem "Titip Pesan" (*Task Queue*).

## 2. Diagram Aliran Queue ARQ
```mermaid
sequenceDiagram
    autonumber
    participant Client as ⚙️ BE Node.js (Orchestrator)
    participant API as 🗺️ FastAPI (GIS API)
    participant Redis as 🗄️ Redis (In-Memory)
    participant Worker as 🛠️ ARQ Daemon (Worker)

    Client->>API: POST /run (Beban Ratusan Node)
    
    Note over API,Redis: Enqueue Task
    API->>Redis: job_id="gis_task_x1", function="gis_processing_task", data=[...]
    
    API-->>Client: HTTP 202 Accepted { job_id: "gis_task_x1" }
    Note over Client: Node.js Tidak menunggu komputasi selesai
    
    Note over Worker: Berjalan terus-menerus di belakang (Background)
    Worker->>Redis: Pop Task "gis_task_x1"
    
    Note over Worker: Menjalankan Algoritma Floyd-Warshall (3-10 Detik 100% CPU)
    
    Worker->>Redis: Set Result "gis_task_x1_result" = [Matrices]
    
    %% Polling/Fetching
    Client->>API: POST /matrix (Minta Rute dengan ID Tersebut)
    API->>Redis: Get Result "gis_task_x1_result"
    Redis-->>API: [Matrices]
    API-->>Client: [Array of Route Nodes]
```

## 3. Prasyarat Operasional
Modul ini menghubungkan dua dunia: Web API dan Terminal Daemon. Membutuhkan Docker *Redis* untuk dijalankan bersama *Worker* (`uv run arq arq_worker.settings.WorkerSettings`).
