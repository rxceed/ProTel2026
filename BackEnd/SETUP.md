# Smart AWD — Backend Setup Guide

## Prerequisites

- Node.js >= 20
- Docker & Docker Compose
- PostgreSQL 16 + PostGIS + TimescaleDB (via Docker)

---

## 1. Clone & Install

```bash
git clone <repo-url>
cd src/BackEnd
npm install
```

---

## 2. Setup Environment

```bash
cp .env.example .env
```

Edit `.env` — minimal wajib diisi:

| Variable | Keterangan |
|---|---|
| `DATABASE_URL` | `postgresql://user:pass@localhost:5432/smartawd_db` |
| `JWT_SECRET` | Minimal 32 karakter random |
| `ADMIN_PASSWORD` | Password admin pertama |

Generate JWT secret:
```bash
openssl rand -hex 32
```

---

## 3. Jalankan Database (Docker)

```bash
# Di direktori yang berisi docker-compose.yml
docker-compose up -d
```

Tunggu ~10 detik sampai TimescaleDB siap.

---

## 4. Migration & Seeding

### Setup lengkap (sekali jalan):

```bash
# Production / staging — schema + reference data saja
npm run db:setup

# Development — tambah dummy data (2 field, sensor, telemetri)
npm run db:setup:dev
```

### Atau step by step:

```bash
npm run db:migrate    # Buat schema (41 tabel, extensions, triggers)
npm run db:seed       # Data referensi wajib (bucket HST, fase, rule profiles)
npm run db:seed:dev   # Dummy data dev (field, device, telemetri, rekomendasi)
```

### Buat user admin:

```bash
ADMIN_PASSWORD=RahasiaKuat123! npm run seed:admin
```

---

## 5. Jalankan Server

```bash
npm run dev
```

Server berjalan di `http://localhost:3000`

---

## Commands Reference

| Command | Keterangan |
|---|---|
| `npm run db:migrate` | Jalankan schema.sql ke database kosong |
| `npm run db:seed` | Seed data referensi wajib (idempotent) |
| `npm run db:seed:dev` | Seed dummy data untuk development |
| `npm run db:setup` | migrate + seed (untuk production) |
| `npm run db:setup:dev` | migrate + seed + seed:dev (untuk development) |
| `npm run db:reset` | **DEV ONLY** — Drop semua & recreate schema |
| `npm run db:studio` | Buka Drizzle Studio (GUI database) |
| `npm run seed:admin` | Buat user system_admin pertama |
| `npm run dev` | Jalankan server development |
| `npm run build` | Build untuk production |

---

## Troubleshooting

**Error: schema "mst" sudah ada**
→ Database sudah ada. Gunakan `npm run db:reset` (dev) atau skip migration.

**Error: relation does not exist**
→ Migration belum dijalankan. Jalankan `npm run db:migrate` terlebih dahulu.

**Error: ADMIN_PASSWORD env var wajib diisi**
→ Set environment variable sebelum menjalankan: `ADMIN_PASSWORD=xxx npm run seed:admin`

**Koneksi database gagal**
→ Pastikan Docker container berjalan: `docker ps`
→ Pastikan DATABASE_URL di `.env` sudah benar.
