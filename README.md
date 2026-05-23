<div align="center">

# 🌾 ProTel — Smart AWD Precision Agriculture Platform

**Platform Sistem Pendukung Keputusan (DSS) berbasis IoT & GIS untuk pengelolaan irigasi sawah menggunakan metode Alternate Wetting and Drying (AWD)**

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://reactjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-Database-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)](https://python.org)

</div>

---

## 📋 Daftar Isi

- [Tentang Proyek](#tentang-proyek)
- [Fitur Utama](#fitur-utama)
- [Arsitektur Sistem](#arsitektur-sistem)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Setup Detail](#setup-detail)
- [Environment Variables](#environment-variables)
- [Database Scripts](#database-scripts)
- [Struktur Proyek](#struktur-proyek)
- [Kontribusi](#kontribusi)

---

## 🎯 Tentang Proyek

**ProTel (Precision Telemetry)** adalah platform monitoring dan DSS untuk pertanian padi berbasis AWD. Sistem mengintegrasikan:

- **Sensor IoT** (AWD Water Level Sensor) yang mengukur ketinggian air secara real-time
- **Decision Support System** berbasis aturan agronomis dan data cuaca BMKG
- **Peta 2D Presisi** dari citra drone (Orthophoto/Orthomosaic)
- **Rekomendasi Otomatis** untuk tindakan irigasi/drainase per petak sawah

> **Metode AWD (Alternate Wetting and Drying)** terbukti menghemat air 15-30% sekaligus mempertahankan hasil panen setara irigasi terus-menerus.

---

## ✨ Fitur Utama

### 📊 Dashboard & Monitoring
- Ringkasan status lahan, peringatan aktif, dan kondisi sensor real-time
- Statistik siklus tanam aktif dan rata-rata ketinggian air per field

### 🗺️ Field Map 2D
- Visualisasi spasial petak sawah (sub-block) menggunakan **OpenLayers**
- Overlay citra drone (Orthomosaic / Cloud Optimized GeoTIFF)
- Klik poligon → Slide-out drawer riwayat telemetri per petak
- Grafik historis multi-parameter: Tinggi Air, Suhu, Kelembapan

### 🤖 DSS (Decision Support System)
- Rekomendasi irigasi/drainase otomatis berbasis fase pertumbuhan padi
- 8 fase pertumbuhan × 4 varietas (Early/Medium Early/Medium/Late)
- Skor prioritas dan tingkat keyakinan (High/Medium/Low)
- Riwayat rekomendasi dan log feedback operator

### ✅ Penugasan Operasional
- Daftar tugas lapangan aktif untuk operator/petani
- Filter per jenis tindakan (Pengairan/Drainase/Pantau/Waspada)
- Modal konfirmasi dengan catatan lapangan
- Riwayat tindakan lengkap dengan tabel terstruktur

### 🔧 Master Data
- Manajemen Lahan Sawah (Fields) dengan polygon GeoJSON
- Profil Aturan DSS (Rule Profiles) per bucket varietas & fase
- Siklus Tanam (Crop Cycles) dengan advance phase workflow
- Hardware Device & Assignment ke sub-block

### 👤 Profil & Pengaturan
- Edit profil pengguna & ganti password
- Pengaturan sistem: URL eksternal (BMKG, Cloudflare R2, Decision Engine)
- Manajemen API key per administrator

---

## 🏗️ Arsitektur Sistem

```
┌──────────────────────────────────────────────────────────┐
│                      CLIENT BROWSER                       │
│              React + Vite + OpenLayers                    │
│                   (FrontEnd — port 5173)                  │
└────────────────────────┬─────────────────────────────────┘
                         │ REST API (JSON)
┌────────────────────────▼─────────────────────────────────┐
│                    EXPRESS API SERVER                      │
│            Node.js + TypeScript + Drizzle ORM             │
│                   (BackEnd — port 3000)                   │
│                                                           │
│  Modules: auth · master-data · telemetry · recommendations│
│           dashboard · map-visual · orthomosaic · archive  │
│           assignments · system-settings · scheduler       │
└──────────┬─────────────────────────┬─────────────────────┘
           │                         │
┌──────────▼──────────┐   ┌──────────▼─────────────────────┐
│    Supabase Cloud   │   │   Python Model Service         │
│  (PostgreSQL 16     │   │   FastAPI + TiTiler            │
│   + PostGIS)        │   │   (Model — port 8000)          │
│                     │   │                                │
│                     │   │  Decision Engine · GDAL        │
└─────────────────────┘   └────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Layer | Teknologi |
|---|---|
| **Frontend** | React 18, Vite, TypeScript, Tailwind CSS, OpenLayers, Recharts |
| **Backend** | Node.js 20, Express, TypeScript, Drizzle ORM, Zod, Pino |
| **Database** | Supabase (PostgreSQL 16 + PostGIS) |
| **Model/AI** | Python 3.11, FastAPI, GDAL, Rasterio, TiTiler |
| **Storage** | Cloudflare R2 (S3-compatible) |
| **Auth** | JWT (Access + Refresh Token) |
| **Deployment** | Serverless DB (Supabase) + Local Node.js / React |

---

## ⚡ Quick Start

### Prasyarat

- [Node.js 20+](https://nodejs.org)
- Akun [Supabase](https://supabase.com) (Untuk Cloud Database)
- Akun Cloudflare R2 (Untuk Storage Peta)
- [Python 3.11+](https://python.org)

### 1. Clone

```bash
git clone <repository-url>
cd ProTel/src
```

### 2. Setup Supabase (Database)
Proyek ini sekarang 100% menggunakan arsitektur *Serverless DB* sehingga Anda **tidak perlu menginstal Docker Lokal**.
1. Buat project baru di [Supabase](https://supabase.com).
2. Dapatkan *Connection String* (URI) PostgreSQL dari Supabase (Cari di bagian *Project Settings -> Database*).

### 3. Setup Backend (Sekali Jalan)

```bash
cd BackEnd
npm install
cp .env.example .env
```

Buka file `.env` dan masukkan konfigurasi:
```env
# URL dari Supabase Anda
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-ID].supabase.co:5432/postgres

# Kredensial Cloudflare R2
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=YOUR_R2_KEY
R2_SECRET_ACCESS_KEY=YOUR_R2_SECRET
R2_BUCKET_NAME=awd-orthomosaic

# Bebas isi string acak
JWT_SECRET=super_secret_jwt_key_12345
```

```bash
# Setup database: Migrasi schema Drizzle + seed reference data + dummy dev data
npm run db:setup:dev

# Buat user admin pertama
ADMIN_PASSWORD=RahasiaKuat123! npm run seed:admin
```

```bash
# Jalankan server API (Port 3000)
npm run dev
```

### 4. Setup Frontend

```bash
cd ../FrontEnd
npm install
npm run dev
```

### 5. Akses Aplikasi

| Service | URL |
|---|---|
| Frontend Dashboard | http://localhost:5173 |
| Backend API | http://localhost:3000 |
| API Health Check | http://localhost:3000/health |

---

## 📦 Setup Detail

### Backend

```bash
cd BackEnd
npm install
cp .env.example .env
```

Isi minimal di `.env`:

```env
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-ID].supabase.co:5432/postgres
JWT_SECRET=<bebas_minimal_32_karakter>
```

#### Database Scripts

| Command | Fungsi |
|---|---|
| `npm run db:generate` | Drizzle-kit: Membuat file migrasi baru di `database/migrations` |
| `npm run db:migrate` | Drizzle migrator: Menjalankan file `.sql` yang belum tereksekusi |
| `npm run db:seed` | Seed data referensi wajib (idempotent) |
| `npm run db:seed:dev` | Seed dummy data development |
| `npm run db:setup` | `migrate` + `seed` (untuk production) |
| `npm run db:setup:dev` | `migrate` + `seed` + `seed:dev` (untuk development) |
| `npm run db:reset` | ⚠️ DEV ONLY: Drop semua tabel dan reset ulang migrasi dari 0 |
| `npm run seed:admin` | Buat user `system_admin` pertama |

#### Workflow Tambah Kolom/Tabel (Developer Baru)

```
1. Edit src/db/schema/*.ts
2. npm run db:generate
3. npm run db:migrate
```

### Frontend

```bash
cd FrontEnd
npm install
npm run dev       # Development server → http://localhost:5173
npm run build     # Production build
```

Buat `.env` jika backend tidak di localhost:

```env
VITE_API_URL=http://localhost:3000
```

### Model Service (Python)

```bash
cd Model
python -m venv venv
venv\Scripts\activate      # Windows
# source venv/bin/activate # Mac/Linux

pip install -r requirements.txt
cp .env.example .env
uvicorn src.main:app --reload --port 8000
```

---

## 🔑 Environment Variables

### Backend (`BackEnd/.env`)

| Variable | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL` | ✅ | `postgresql://user:pass@host:5432/dbname` |
| `JWT_SECRET` | ✅ | Minimal 32 karakter (generate: `openssl rand -hex 32`) |
| `PORT` | | Default: `3000` |
| `NODE_ENV` | | `development` / `production` |
| `CORS_ORIGIN` | | Default: `http://localhost:5173` |
| `DECISION_ENGINE_URL` | | URL Model Service, default: `http://localhost:8000` |
| `R2_ENDPOINT` | | Cloudflare R2 endpoint untuk orthomosaic |
| `R2_ACCESS_KEY_ID` | | R2 API Token ID |
| `R2_SECRET_ACCESS_KEY` | | R2 API Token Secret |
| `R2_BUCKET_NAME` | | Nama bucket R2 |

### Admin Seed (`npm run seed:admin`)

```bash
ADMIN_EMAIL=admin@smartawd.id \
ADMIN_PASSWORD=RahasiaKuat123! \
ADMIN_NAME="System Administrator" \
npm run seed:admin
```

---

## 📁 Struktur Proyek

```
src/
├── BackEnd/                    # Express API Server
│   ├── database/
│   │   ├── schema.sql          # Schema utama (41 tabel, PostGIS, TimescaleDB)
│   │   └── migrations/         # Migration files terurut
│   ├── src/
│   │   ├── db/schema/          # Drizzle ORM schema (mst.ts, trx.ts, logs.ts)
│   │   ├── modules/            # Feature modules
│   │   │   ├── auth/           # JWT authentication
│   │   │   ├── master-data/    # Fields, sub-blocks, devices, cycles, rules
│   │   │   ├── telemetry/      # IoT data ingest & query
│   │   │   ├── recommendations/# DSS output + assignments
│   │   │   ├── dashboard/      # Aggregated stats
│   │   │   ├── map-visual/     # Map layer data
│   │   │   ├── orthomosaic/    # Drone image management
│   │   │   └── system-settings/# Admin config
│   │   ├── scripts/            # Database scripts
│   │   │   ├── migrate.ts      # Schema migration runner
│   │   │   ├── reset.ts        # DEV: drop & recreate
│   │   │   ├── seed.ts         # Reference data seed
│   │   │   ├── seed-dev.ts     # Development dummy data
│   │   │   └── seed-admin.ts   # Admin user creation
│   │   └── middleware/         # Auth, RBAC, validation, error handling
│   ├── .env.example
│   ├── SETUP.md                # Panduan setup detail
│   └── package.json
│
├── FrontEnd/                   # React Dashboard
│   └── src/
│       ├── pages/
│       │   ├── dashboard.tsx
│       │   ├── monitoring/
│       │   │   ├── map.tsx     # 2D field map + telemetry charts
│       │   │   └── sub-blocks.tsx
│       │   ├── recommendations/
│       │   │   ├── dss.tsx     # DSS output & alerts
│       │   │   └── history.tsx
│       │   ├── master/         # CRUD master data
│       │   ├── tasks.tsx       # Operational assignments
│       │   ├── profile.tsx
│       │   └── settings.tsx
│       └── layout/             # Sidebar, Header, MainLayout
│
└── Model/                      # Python DSS & Ortho Service
    └── src/
        └── main.py             # FastAPI entry point
```

---

## 🗄️ Skema Database

Database menggunakan 4 schema PostgreSQL:

| Schema | Keterangan | Tabel |
|---|---|---|
| `mst` | Master / Reference data | users, fields, sub_blocks, devices, rule_profiles, crop_cycles, ... |
| `trx` | Transactional data | telemetry_records (hypertable), recommendations, alerts, ... |
| `sys` | System internals | decision_jobs, scheduler, engine_configs, integration_configs |
| `logs` | Audit & observability | api_requests, auth_logs, activity_logs, data_change_audit |

> `telemetry_records` adalah **TimescaleDB hypertable** — dipartisi otomatis per waktu untuk query time-series yang efisien.

---

## 🔐 Role & Akses

| Role | Keterangan |
|---|---|
| `system_admin` | Akses penuh semua fitur & settings |
| `field_manager` | Kelola field tertentu, lihat semua data |
| `operator` | Lihat monitoring & respons tugas lapangan |

---

## 🚨 Troubleshooting

**Error: extension "postgis" is not available**
→ Ini terjadi karena database PostgreSQL Anda tidak memiliki komponen PostGIS.
→ **Solusi**: Sangat disarankan menggunakan Docker (`docker-compose up -d`). File `docker-compose.yml` yang saya tambahkan sudah menggunakan image yang mencakup PostGIS dan TimescaleDB secara otomatis.

**Schema "mst" sudah ada saat `db:migrate`**
```bash
# Gunakan reset (DEV) atau skip jika sudah punya data
npm run db:reset   # ⚠️ HAPUS SEMUA DATA!
```

**Koneksi database gagal**
```bash
docker ps                    # Pastikan container running
docker-compose logs db       # Lihat log database
```

**`ADMIN_PASSWORD` env var wajib diisi**
```bash
ADMIN_PASSWORD=RahasiaKuat123! npm run seed:admin
```

**Frontend tidak bisa connect ke API**
```bash
# Pastikan CORS_ORIGIN di backend .env sesuai
CORS_ORIGIN=http://localhost:5173
```

---

## 🤝 Kontribusi

1. Buat branch baru: `git checkout -b feature/nama-fitur`
2. Lakukan perubahan & test lokal
3. Pastikan schema tetap sinkron jika ada perubahan DB
4. Buat Pull Request ke branch `main`

> **Penting**: Jangan commit file `.env` ke repository. Gunakan `.env.example` sebagai template.

---

<div align="center">

**Dikembangkan untuk Smart Agriculture Management**

*ProTel v1.0 — 2026*

</div>
