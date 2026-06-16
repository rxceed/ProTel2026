# 🚀 Panduan Instalasi & Deployment (Setup Guide)

Dokumen ini memandu Anda (Developer baru) untuk menjalankan seluruh ekosistem *Microservices* Protel Smart AWD di mesin lokal (*localhost*) atau Virtual Private Server (VPS) Ubuntu.

## Prasyarat Lingkungan (Prerequisites)
- **Node.js:** v20.x atau terbaru.
- **Python:** v3.10 atau terbaru (Gunakan `uv` atau `venv` bawaan).
- **Docker & Docker Compose:** Sangat krusial untuk Redis, PostGIS, TimescaleDB, dan WebODM.
- **Mosquitto MQTT Broker:** Bisa via Docker atau instalasi OS langsung.

## Langkah 1: Menghidupkan Infrastruktur Dasar
Buka terminal di root direktori proyek.
```bash
# Nyalakan Database Polyglot (Postgres/PostGIS/Timescale) dan Redis
docker-compose up -d db redis mqtt
```

## Langkah 2: Persiapan BackEnd (Node.js)
```bash
cd src/BackEnd
npm install

# Buat file .env dari template
cp .env.example .env

# Jalankan migrasi struktur Drizzle ke dalam Database Docker
npm run db:migrate

# Jalankan server BackEnd (Port 3000)
npm run dev
```

## Langkah 3: Persiapan Model Service (DSS & Titiler)
Buka terminal baru.
```bash
cd src/Model
python -m venv venv
# Windows: .\venv\Scripts\activate
# Linux/Mac: source venv/bin/activate

pip install -r requirements.txt

# Jalankan server DSS (Port 8002)
uvicorn app.main:app --port 8002 --reload
```

## Langkah 4: Persiapan GIS Processing & Worker
Buka terminal baru. Algoritma perutean butuh Redis dan Worker.
```bash
cd gis_risang/ricemesh-gis-processing/src
# Install dependency
pip install -r requirements.txt

# TERMINAL A: Jalankan Web API (Port 8003)
uvicorn main:app --port 8003 --reload

# TERMINAL B: Jalankan ARQ Worker Daemon (Menunggu Redis)
uv run arq arq_worker.settings.WorkerSettings
```

## Langkah 5: Persiapan FrontEnd (React)
Buka terminal baru.
```bash
cd src/FrontEnd
npm install
npm run dev
# Buka peramban (browser) di http://localhost:5173
```

## Troubleshooting
- Jika *BackEnd* Node.js mengalami error *"Connection Refused"*, pastikan URL `DECISION_ENGINE_URL` di `.env` menunjuk pada port Python yang benar (misal `8002`).
- Jika *Routing* gagal, periksa apakah terminal **ARQ Worker Daemon** sudah hidup. Jika mati, Redis akan menimbun pesanan dari Node.js selamanya.
