# ⏱️ TIER 2 (BackEnd): Scheduler & State Builder

## 1. Mekanisme Kerja
Berada pada `scheduler.service.ts` dan `state-builder.job.ts`. Inilah modul yang menyatukan potongan teka-teki data telemetri. Data sensor (`trx.readings`) yang masuk sering kali tidak konsisten (ada perangkat mati, baterai habis, dsb). *State Builder* menggunakan metode *K-Nearest Neighbors* spasial untuk "menebak" (*Interpolate*) nilai petak sawah yang sensornya sedang mati.

## 2. Diagram Alur Logika State Builder (Cron)
```mermaid
flowchart TD
    Start((⏰ Cron Job: Tiap 10 Menit)) --> A
    
    A[Kueri semua petak Sub-Block] --> B
    B[Kueri data sensor terakhir 'trx.readings' max 10 menit lalu] --> C{Apakah data tersedia?}
    
    %% Kondisi Fresh
    C -- Ya --> D[Tandai State = FRESH]
    D --> E[Set State_Source = 'OBSERVED']
    
    %% Kondisi Missing Data
    C -- Tidak --> F{Pernah ada data < 24 jam?}
    
    F -- Ya --> G[Tandai State = STALE]
    F -- Tidak --> H[Tandai State = NO_DATA]
    
    G & H --> I[Trigger Spatial KNN Interpolation]
    I --> J[Cari 3 Petak terdekat ST_Distance <br/> yang memiliki data FRESH]
    
    J --> K{Tetangga ketemu?}
    K -- Ya --> L[Hitung bobot rata-rata tinggi air tetangga]
    L --> M[Set State_Source = 'ESTIMATED']
    
    K -- Tidak --> N[Gagal tebak]
    N --> O[Set State_Source = 'NO_DATA']
    
    E & M & O --> P[Batch Upsert ke 'trx.sub_block_current_states']
    P --> End((Selesai))
```

## 3. Hubungan ke Modul Lain
- Hasil dari tabel `trx.sub_block_current_states` inilah yang menjadi basis bagi Cron Job ke-dua (*Decision Cycle / Evaluator*) untuk dibungkus ke dalam JSON dan dikirim menuju **Model DSS Engine**.
