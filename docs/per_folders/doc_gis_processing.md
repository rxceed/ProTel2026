# 🗺️ Dokumentasi Teknis Lanjut: Ricemesh GIS Processing

## 1. Ikhtisar (Overview)
Modul **GIS Processing** (berlokasi di `d:\PROTEL\gis_risang\ricemesh-gis-processing`) adalah tulang punggung komputasi berat proyek ini. Modul ini merupakan API FastAPI terpisah dari *Decision Engine* dan bertindak murni sebagai "Kalkulator Graf Spasial".

## 2. Struktur Modul & Fungsi
```text
ricemesh-gis-processing/
├── 1-server-run.bash      (Skrip menjalankan FastAPI web)
├── 2-arq-worker.bash      (Skrip menjalankan Daemon Redis)
├── docker-compose.yml     (Layanan Redis)
└── src/
    ├── main.py            (Endpoint /run & /matrix)
    ├── arq_worker/        (Pengatur antrean tugas asinkron)
    └── models/            (Pydantic input/output validation)
```

## 3. Komputasi Utama (Floyd-Warshall Algorithm)
Bagaimana kita tahu air harus mengalir dari Petak A ke Petak F? Sistem menggunakan *Teori Graf* tingkat lanjut dari modul Python `NetworkX`.

### Endpoint: `POST /run` (Hitung Semua Rute / APSP)
Saat *Backend* (Node.js) menyuruh *GIS Processing* mencari jalan air, ia memberikan graf berstruktur:
```json
{
  "num_nodes": 4,
  "nodes": [{"water_height": 0.08, "optimal_height": 0.05, "elevation": 12.0}, ...],
  "edges": [{"u": 0, "v": 1, "centroid_u": "SRID=4326;POINT(..)", ...}]
}
```
**Algoritma Fisika Air:**
1. **Pemberian Bobot Jarak:** `NetworkX` mengekstrak WKT (*Well Known Text*) Centroid PostGIS menjadi geometri spasial. Ia menggunakan `SciPy` dan koordinat Bumi untuk menghitung jarak absolut (meter) antar-titik tengah lahan.
2. **Pemberian Bobot Gravitasi (Penalty):** Air tidak bisa mengalir naik ke atas bukit tanpa pompa. GIS menambahkan "nilai penalti hambatan" ke rute yang menuju elevasi lebih tinggi. Jika jalurnya menurun sesuai gravitasi, nilai hambatan akan dikurangi.
3. **Eksekusi Floyd-Warshall:** Setelah graf jaringan sawah terbentuk dengan bobot hambatan (`Weight`), algoritma *All-Pairs Shortest Path* akan dikerjakan. Hasilnya berupa Matriks 2D (Array dalam Array) Jarak dan Suksesor.

### Endpoint: `POST /matrix` (Rekonstruksi Rute)
Node.js memiliki kelemahan dalam array multi-dimensi besar. Ia menembakkan indeks petak sumber (contoh: Petak 0) dan target (contoh: Petak 3) bersama Matriks Suksesor ke `/matrix`.
Python menggunakan perulangan balik (*backtracking*) untuk menyusun rute `[0, 1, 3]`. Inilah jalur perambatan air (*Water Route*) sebenarnya yang akan disimpan ke database Backend.

## 4. Tantangan Teknis (Technical Debts)
*Developer* berikutnya harus berhati-hati dengan parameter Bobot Gravitasi (*Penalty*). Jika kalibrasi koefisien tekanan air/elevasi terlampau besar, rute mungkin saja memilih jalur yang melingkar jauh memutari lahan hanya karena rute terdekat sedikit mendaki (elevasi tanah tidak rata). Uji lapangan menggunakan alat semprot drone sangat dianjurkan untuk menyesuaikan rumus pembobotan spasial (Weighting Formula) di Python.
