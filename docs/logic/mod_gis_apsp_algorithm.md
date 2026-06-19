# 📐 TIER 4 (GIS): All-Pairs Shortest Path (APSP) Algorithm

## 1. Mekanisme Kerja
Di dalam `gis_risang/ricemesh-gis-processing`. Algoritma Spasial tidak menggunakan metode konvensional A* atau Dijkstra karena kita tidak mencari dari 1 ke 1. Kita membangun graf seluruh koneksi tumpahan petak sawah menggunakan `NetworkX`. 
Algoritma utamanya adalah **Floyd-Warshall** yang menghitung biaya jarak dari semua titik ke semua titik (APSP).

## 2. Diagram Logika Komputasi Spasial
```mermaid
stateDiagram-v2
    [*] --> Inisialisasi_Graf
    
    Inisialisasi_Graf --> Ekstrak_WKT
    note right of Ekstrak_WKT
        Shapely mengubah 
        "POINT(110.1 -7.2)" 
        menjadi Objek Geometry Python
    end note
    
    Ekstrak_WKT --> Hitung_Jarak_Fisik
    note right of Hitung_Jarak_Fisik
        SciPy menghitung Euclidean Distance 
        antar Centroid (Edge Weight)
    end note
    
    Hitung_Jarak_Fisik --> Terapkan_Gravitasi
    note right of Terapkan_Gravitasi
        Elevasi Sumber (Z1) - Target (Z2).
        Jika nanjak -> Penalty Weight +1000
    end note
    
    Terapkan_Gravitasi --> Eksekusi_FloydWarshall
    
    state Eksekusi_FloydWarshall {
        FW_Iterasi --> Update_Matriks_Jarak
        Update_Matriks_Jarak --> Simpan_Matriks_Pointer
    }
    
    Eksekusi_FloydWarshall --> Hasil_MultiDimensi
    Hasil_MultiDimensi --> [*]
```

## 3. Kaitan Khusus (Technical Relation)
Penerapan *Penalty Elevasi* harus diawasi oleh Teknisi Lapangan karena kemiringan lahan akan menentukan ke mana pompa air membuang kelebihan genangan. Hasil keluaran (`Distance` dan `Predecessor Matrices`) akan diterjemahkan oleh Endpoint `/matrix`.
