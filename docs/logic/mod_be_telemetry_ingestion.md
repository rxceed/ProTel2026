# 📡 TIER 2 (BackEnd): Telemetry Ingestion (MQTT)

## 1. Mekanisme Kerja
Modul `mqtt.service.ts` bertanggung jawab menjadi penyaring pertama bagi aliran data bervolume tinggi yang dikirimkan oleh ratusan perangkat lapangan. Agar tidak melumpuhkan server, proses masuk (*Ingestion*) dipisahkan secara ketat dari komputasi analisis.

### Kalibrasi Dinamis (*Dynamic Calibration*)
Sistem menangkap variabel jarak mentah (*Distance*) dari sensor ultrasonik. Modul ini melakukan kueri ke dalam *Map/Cache* dari DB `mst.sensor_calibrations` untuk mengubah jarak dari bibir paralon menjadi tinggi/kedalaman air riil yang akurat, terlepas dari berapapun ketinggian pemasangan sensor di lapangan (mis. 1400mm atau 1200mm).

## 2. Diagram Aliran Data Ingesti
```mermaid
sequenceDiagram
    autonumber
    actor Sensor as 📡 IoT Node (ESP32)
    participant Broker as ✉️ Mosquitto MQTT
    participant Ingest as ⚙️ BE: mqtt.service.ts
    participant DB as 🗄️ PostgreSQL (mst)
    participant Timescale as ⏱️ TimescaleDB (trx)

    Sensor->>Broker: Publish to 'sensor/data'
    Note over Sensor,Broker: Payload: {device: [{id:"N1", d:120}], temp:29, ...}
    
    Broker->>Ingest: Trigger listener "message" event
    
    %% Proses Kalibrasi
    Ingest->>DB: Fetch sensor calibration map (Cache)
    DB-->>Ingest: N1 -> sensor_max_distance_mm = 1400
    
    Note over Ingest: Kalkulasi: <br/>Water Level = (1400 - 120) / 10 = 12.8 cm
    
    %% Injeksi Masif
    Ingest->>Timescale: Batch Insert into trx.readings
    Note over Timescale: Hypertable Chunk Partitioning (Bypass Indexing Overhead)
    Timescale-->>Ingest: Insert OK
    
    %% Asynchronous nature
    Note over Ingest: Proses berhenti di sini.<br/>Tidak ada kalkulasi rumit agar listener cepat siap.
```

## 3. Hubungan ke Modul Lain
- **Penghubung ke Scheduler:** Data mentah di `trx.readings` ini **tidak berguna bagi Frontend atau DSS** sampai diproses oleh Sub-Modul `State Builder` (yang berjalan di belakang layar) untuk diolah menjadi wujud keadaan saat ini (*Current State*).
