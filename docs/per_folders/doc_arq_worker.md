# 🛠️ Dokumentasi Teknis Lanjut: ARQ Worker (Redis Queue)

## 1. Ikhtisar (Overview)
Di dalam *GIS Processing Service*, kita menerapkan pola arsitektur **Asynchronous Task Queue** menggunakan Pustaka Python `ARQ` yang berdiri di atas pangkalan data dalam-memori `Redis`.

## 2. Mengapa ARQ? (Masalah Pemblokiran Server)
Web server ASGI Uvicorn/FastAPI berjalan secara berurutan pada satu *Event Loop* (Node.js pun sama).
Jika algoritma `Floyd-Warshall` menghitung rute untuk 200 petak sawah secara *real-time*, komputasi iterasi $N^3$ (200 x 200 x 200) akan menyita 100% CPU. Selama proses (sekitar 3-5 detik) tersebut berlangsung, API FastAPI akan lumpuh dan **menolak** *request* HTTP lain yang masuk (menyebabkan *Gateway Timeout / Connection Refused*).

Dengan **ARQ Worker**:
1. Server Web FastAPI hanya menyisipkan payload GIS ke memori **Redis**, mencetak *Job ID*, lalu memutus koneksi API seketika. FastApi langsung melayani pengunjung lain.
2. Proses berat tersebut diserahkan ke *Process / Daemon* yang terpisah (*Worker*).

## 3. Eksekusi Teknis
### A. Inisialisasi *Worker Settings*
File `arq_worker/settings.py` berisi daftar semua fungsi beban berat (*Tasks*) yang boleh dieksekusi oleh *worker* ini.
- `redis_settings`: Terhubung ke layanan Redis lokal (Biasanya pada port standard `6379`).
- `max_jobs`: Dibatasi secara *thread* untuk menghindari meledaknya CPU bila ada ratusan perhitungan serentak.

### B. Menjalankan *Daemon* Worker (`2-arq-worker.bash`)
Skrip memanggil *Command Line* ARQ:
```bash
uv run arq arq_worker.settings.WorkerSettings
```
Kunci stabilitas server GIS Anda berada di sini. Ini harus dijalankan secara terus menerus (dijadikan Servis via *systemd* atau *Supervisor* di Linux, atau via *PM2/Docker* daemon) sehingga ia siap kapan saja menunggu antrean Redis baru.

## 4. Pengembangan Selanjutnya
- Di lingkungan *Production* (seperti VPS Ubuntu), gunakan kontainer **Docker Redis** (`docker-compose up -d redis`) yang berjalan tanpa beban.
- *Backend Node.js* perlu diintegrasikan agar mendukung penarikan *Polling* terhadap *Job ID* ARQ (Kueri status: *In Progress, Completed, Failed*) ketimbang menunggu HTTP tertahan saat komputasi berlangsung lama.
