# 🖥️ Dokumentasi Teknis Lanjut: FrontEnd (FE)

## 1. Ikhtisar (Overview)
Modul **FrontEnd (FE)** adalah antarmuka visual (SPA) untuk sistem Smart AWD. Beroperasi pada port default Vite (`5173/5174`), FE dibangun dengan React 19, TypeScript, dan TailwindCSS 4.

## 2. Struktur Direktori (Tree Architecture)
Struktur direktori `d:\PROTEL\src\FrontEnd\src` diorganisasi berdasarkan domain fungsionalitas:
```text
src/
├── api/
│   ├── client.ts         (Axios instance & interceptors)
│   └── gisProc.ts        (Call API untuk rendering rute)
├── assets/
├── components/
│   ├── mapping/
│   │   ├── MapVisualManager.tsx  (Integrasi utama OpenLayers)
│   │   └── SubBlockMapEditor.tsx (UI Editor batas polygon sawah)
│   ├── ui/               (Komponen reusable ala shadcn/ui)
│   │   ├── badge.tsx, button.tsx, card.tsx
│   ├── entity-detail-modal.tsx
│   ├── mode-toggle.tsx
│   └── theme-provider.tsx
├── App.tsx
├── main.tsx
└── index.css             (Tailwind V4 CSS entrypoint)
```

## 3. Komponen Inti & Alur Kerja (Workflows)

### A. Rendering Peta Geospasial (`MapVisualManager.tsx`)
Berbeda dengan web konvensional yang memakai *Google Maps SDK*, proyek ini menggunakan `ol` (OpenLayers) untuk mengelola data vektor dan raster kustom yang berat.
- **Layer Raster (Orthomosaic):** Memuat *tiles* dari API Titiler Python (Sistem pemotong COG dari Cloudflare R2). Penggunaan OpenLayers memastikan rendering lancar walau peta hasil drone beresolusi super tinggi (cm/pixel).
- **Layer Vektor (Sub-Blocks):** Petak sawah di-render sebagai layer *Vector*. BackEnd mengirimkan representasi *GeoJSON Polygon* dari tabel PostGIS `mst.sub_blocks` ke FE. Layer ini dihias dinamis: jika `water_level` kritis, polygon dirender merah; jika normal, dirender hijau.
- **Visualisasi Routing:** Hasil komputasi jarak terpendek (Floyd-Warshall) dari BE dikirimkan ke FE berupa daftar ID petak berurutan (`route_path_ids`). FE kemudian mengolah titik-titik pusat koordinat (Centroid) dari petak-petak tersebut untuk menggambar panah terarah (*Animated Polyline* / *Arrow*) menggunakan utilitas vektor OpenLayers.

### B. Manajer HTTP Client (`client.ts`)
Menggunakan `axios` v1.15 yang telah dikonfigurasi (`axios.create`) untuk menyisipkan *JWT Token* di setiap `Authorization` header. Selain itu, terdapat fungsi *interceptor* yang akan me-refresh token jika menerima respons `401 Unauthorized` dari Backend Express.

### C. UI Library & Styling (`components/ui`)
Tampilan dirancang menggunakan konsep komponen fungsional modern (ala `shadcn/ui` dan `Radix UI`):
- `clsx` dan `tailwind-merge` selalu dipanggil dalam `className` untuk memastikan tidak ada konflik hierarki kelas TailwindCSS.
- `class-variance-authority` digunakan di komponen dasar (`button.tsx`, `badge.tsx`) untuk mendefinisikan ragam desain (*variants: outline, ghost, destructive, dll*) tanpa *logic spaghetti*.
- Dukungan *Dark Mode* (*theme-provider.tsx*) terintegrasi penuh.

## 4. State Management (Zustand)
Kita menggunakan *Zustand* karena sangat minimalis tanpa memerlukan *Boilerplate/Provider wrapper* seperti *Redux*.
*Store* yang disarankan untuk dikembangkan oleh *developer* selanjutnya meliputi:
1. `useAuthStore`: Mengelola JWT dan Profil User.
2. `useFieldStore`: Menyimpan *Sub-Block* dan data IoT waktu-nyata yang baru didapatkan dari BE.
3. `useDssStore`: Menyimpan notifikasi atau rekomendasi pengairan (*IRRIGATE/DRAIN*) dari evaluasi DSS terbaru untuk disajikan dalam bentuk *Pop-up/Card*.

## 5. Pengembangan Lanjutan (To-Do)
1. **Animasi Flow:** Rute panah alur air dari `route_path_ids` harus dianimasikan berjalan. OpenLayers mendukung `postrender` *event* yang bisa dimanfaatkan untuk menggeser *Icon* sepanjang garis koordinat.
2. **WebSocket Integration:** Saat ini data diperbarui saat pengguna memuat ulang atau dari *polling* API berkala. Sangat disarankan menambahkan WebSocket atau *Server-Sent Events (SSE)* untuk mengalirkan keadaan sensor (stale/fresh/no_data) dari DB ke Frontend secara _live_.
