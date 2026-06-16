# ☁️ TIER 6 (Data Pipeline): WebODM & COG Pipeline

## 1. Mekanisme Kerja
Bagaimana mengubah ratusan foto JPEG mentah dari kamera satelit/drone agar menjadi satu peta super resolusi yang bisa dibuka lewat peramban web? Ini adalah proses pipanisasi (*Pipelining*) arsitektur *Cloud*. WebODM menangani pemrosesan lokal berat, `GDAL` untuk penerjemahan format, dan *Cloudflare R2* sebagai lumbung data bebas pungutan batas wilayah.

## 2. Diagram Aliran Pemrosesan Fotogrametri
```mermaid
sequenceDiagram
    autonumber
    actor Pilot as 🚁 Drone Pilot
    participant WebODM as 🏗️ WebODM (Docker Node)
    participant Shell as 💻 GDAL Shell Script
    participant Cloudflare as ☁️ Cloudflare R2
    
    Pilot->>WebODM: Upload 500x JPEG Images (With GPS EXIF)
    
    Note over WebODM: OpenSfM memproses ratusan poin <br/> menjahit foto, menyeimbangkan warna
    
    WebODM-->>Shell: Ekspor 'proc_rgb.tif' (2.5 GB)
    
    Note over Shell: Menjalankan "gdal_translate" & "gdaladdo"
    
    Shell->>Shell: Konversi TIF Menjadi COG <br/> (Membangun piramida zoom terbalik)
    
    Shell->>Cloudflare: AWS S3 PutObject (Upload COG)
    
    Cloudflare-->>Shell: 200 OK
    Note over Cloudflare: File kini bersifat Publik namun <br/> tanpa biaya Egress saat di-akses
```

## 3. Titik Temu Sistem (*System Integration*)
Output (*Keluaran*) dari alur ini akan ditaruh di *Cloudflare R2 Bucket*, yang kemudian akan dikonsumsi URL-nya oleh **Titiler Model** (Python) di *TIER 3* agar bisa dilukis menjadi kotak-kotak peta (*Tiles*) di *Frontend*.
Penyimpanan file COG ini juga memungkinkan kita untuk mendirikan server peta untuk desa lain tanpa perlu menambah pangkalan data.
