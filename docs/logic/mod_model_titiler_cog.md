# 🗺️ TIER 3 (Model): Titiler COG Server

## 1. Mekanisme Kerja
Titiler adalah server pemetaan dinamis berbasis Python (FastAPI). Ia bertugas merender *XYZ Tiles* secara *On-The-Fly* (langsung). Petani/Operator lapangan ingin melihat keadaan nyata dari pemotretan *drone* bulan lalu di aplikasinya. Foto hasil jahit bernilai resolusi triliunan pixel tersebut (`.tif`) disimpan di penyimpanan eksternal untuk menghemat biaya hardisk server kita.

## 2. Diagram Alir Data Titiler & Cloudflare
```mermaid
sequenceDiagram
    autonumber
    actor Browser as 💻 React/OpenLayers (FE)
    participant Titiler as 🗺️ Titiler API (Python)
    participant Cloudflare as ☁️ Cloudflare R2 (Object Storage)
    
    Browser->>Titiler: GET /cog/tiles/WebMercatorQuad/15/26330/16550@1x.png <br/>?url=s3://awd-ortho/proc.tif
    
    Note over Titiler: Menerima permohonan XYZ Tile
    Titiler->>Cloudflare: HTTP GET Range (Hanya minta sekian KB dari offset)
    
    Note over Cloudflare: Mengembalikan pecahan bytes dari Cloud Optimized GeoTIFF
    Cloudflare-->>Titiler: [Binary Bytes]
    
    Note over Titiler: Merender Bytes menjadi PNG Image secara asinkron
    Titiler-->>Browser: HTTP 200 Image/PNG
    
    Note over Browser: Lapisan Raster menempel di atas peta dasar (Mapbox/OSM)
```

## 3. Hubungan ke Modul Lain
- Modul ini tidak berhubungan dengan Backend Node.js.
- Titiler murni dikonsumsi secara langsung oleh **FrontEnd (React)** melalui pemanggilan alamat URL *layer* yang di-pasang di `OpenLayers`.
