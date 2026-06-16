# ☁️ Dokumentasi Teknis Lanjut: WebODM & Cloudflare R2 Pipeline

## 1. Ikhtisar (Overview)
Ini adalah ujung tombak suplai data visual (Satelit Udara) dari sistem ini. Mengingat peta *Drone* sangat raksasa, proyek ini melakukan *Bypass* penyimpanan awan menggunakan teknologi Object Storage tercanggih untuk penayangan (Streaming).

## 2. Mekanisme Proses WebODM
Lokasi modul fotogrametri berada pada `d:\PROTEL\webodm` dan beroperasi menggunakan **Docker-Compose Cluster**.
WebODM terdiri dari:
- `webapp`: Antarmuka manajemen WebODM.
- `db`: Penyimpanan metrik PostGIS internal (Hanya untuk WebODM, terpisah dari DB Drizzle).
- `node-odm`: *Worker Engine* raksasa tempat pemrosesan grafis OpenSfM bekerja (*Stitching, Point Cloud filtering, 3D Mesh generation*).

**Arus Kerja Operator Lapangan:**
1. Menerbangkan *Drone DJI* dengan perangkat lunak pemetaan otomatis (e.g. *DroneDeploy/Pix4D Capture*).
2. Memasukkan ratusan foto berektensi JPEG yang berstempel metrik GPS ke *dashboard* WebODM.
3. WebODM mengekstrak *Orthophoto*. Hasil jadinya adalah `proc_rgb.tif` (*Tagged Image File Format* dengan referensi koordinat spasial).

## 3. Infrastruktur Cloudflare R2 & Titiler
File `.tif` hasil WebODM sangat masif (bisa ratusan MB hingga GB).

### A. Konversi Tipe (COG)
Jika `.tif` biasa diunggah ke internet, FE *React* harus menunggu pengunduhan 2GB tuntas untuk menampilkannya.
Teknisi menggunakan perintah *GDAL* CLI (atau *rasterio*) untuk menerjemahkannya ke **COG (Cloud Optimized GeoTIFF)**. COG adalah format yang menyusun piramida resolusi peta dari ukuran kasat mata bumi, turun hingga zoom ke sehelai daun.

### B. Penyimpanan Bebas Egress (Cloudflare R2)
File COG diunggah (*Upload*) ke dalam layanan *Cloudflare R2 Bucket*.
Konfigurasi lingkungan `.env` pada *Backend* Node.js untuk mengatur injeksi ke bucket:
```ini
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=xxx
R2_SECRET_ACCESS_KEY=xxx
R2_BUCKET_NAME=awd-orthomosaic
```
**Mengapa bukan Amazon S3?** Peta visual diakses secara *streaming* terus menerus oleh pengguna (Ribuan *Tile Map* di-load setiap menit). Layanan S3 komersial mengenakan biaya per Gigabyte data yang ditarik (*Egress Fee*). **Cloudflare R2** menjamin pembebasan *Egress Fee* secara mutlak, menekan biaya operasional proyek hingga ratusan dolar per bulan.

### C. Live Tile Server (Titiler)
Di dalam `Model Service`, Python `Titiler` akan menembak link langsung (`https://s3.cloudflare.com/.../proc_rgb.tif`) dan melakukan konversi URL XYZ `/{z}/{x}/{y}.png`. Alamat inilah yang diberikan kepada *FrontEnd OpenLayers* untuk dilukis pada kanvas Peta.

## 4. Pekerjaan Selanjutnya (To-Do)
Developer berikutnya harus merakit API *Endpoint* khusus unggahan (`Upload API`) pada Backend Node.js yang menggunakan *stream pipe* Multipart Form Data agar Operator Sawah bisa langsung mengirim file foto drone ke WebODM, lalu dari WebODM otomatis dilontarkan (*hook*) ke Cloudflare R2 tanpa campur tangan teknisi *shell script*.
