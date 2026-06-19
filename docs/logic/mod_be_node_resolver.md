# 🛡️ TIER 2 (BackEnd): Node Resolver (4-Level Fallback)

## 1. Mekanisme Kerja
Terletak di `node-resolver.ts`. Sebelum Backend membiarkan *GIS Processing* mulai mencari rute dari target A ke B menggunakan *Floyd-Warshall*, ia harus memastikan setiap petak koordinat memiliki angka elevasi riil. Algoritma Spasial tidak menerima nilai `NULL`. Resolusi *Node* ini adalah sabuk pengaman tingkat tinggi agar sistem perhitungan air tidak panik (*Crash*).

## 2. Diagram Pohon Keputusan (Decision Tree)
```mermaid
graph TD
    Start([Node Target DRAIN/IRRIGATE Diterima]) --> L1
    
    %% LEVEL 1
    L1{"L1: Apakah State_Source = 'OBSERVED'?"}
    L1 -- Ya --> L1_Result["✅ Gunakan water_level orisinal"]
    L1 -- Tidak (Mati) --> L2
    
    %% LEVEL 2
    L2{"L2: Apakah State_Source = 'ESTIMATED'?"}
    L2 -- Ya --> L2_Result["⚠️ Gunakan water_level hasil Interpolasi KNN"]
    L2 -- Tidak (KNN Gagal) --> L3
    
    %% LEVEL 3
    L3["Hitung rata-rata air seluruh petak dalam 1 Entitas Lahan (Field Average)"] --> L3_C
    L3_C{"Apakah rata-rata > 0?"}
    L3_C -- Ya --> L3_Result["🚧 Gunakan nilai Rata-rata Lahan"]
    L3_C -- Tidak (Satu Lahan Mati Total) --> L4
    
    %% LEVEL 4
    L4["❌ Fatal Error: Tidak ada data referensi"] --> L4_Result
    L4_Result(("ABORT ROUTING"))
    
    %% Penyelesaian
    L1_Result --> Finish((Lanjut ke GIS Routing))
    L2_Result --> Finish
    L3_Result --> Finish
    L4_Result -.->|Hentikan| Cancel((Simpan Rekomendasi Tanpa Rute Air))
```

## 3. Hubungan ke Modul Lain
- **Pembantu Modul Routing:** Modul ini dijalankan secara sekejap tepat di tengah-tengah antara hasil dari DSS Engine, sebelum merakit beban (*Payload*) untuk dikirim ke API `gis-processing`.
