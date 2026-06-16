# 🗃️ Diagram Relasi Database (ERD)

Kita memiliki arsitektur *Polyglot Database* yang membagi data Master (`mst`) dengan data Transaksi (`trx`). Diagram di bawah ini menjabarkan interaksi *Foreign Key* (Kunci Tamu) menggunakan standar *Crow's Foot Notation*.

## Entity Relationship Diagram (Mermaid)

```mermaid
erDiagram
    %% Master Tables
    mst_users {
        UUID id PK
        VARCHAR name
        VARCHAR role
    }
    
    mst_fields {
        UUID id PK
        UUID owner_id FK
        VARCHAR name
        GEOMETRY boundaries "Polygon"
    }

    mst_sub_blocks {
        UUID id PK
        UUID field_id FK
        VARCHAR code
        GEOMETRY boundaries "Polygon"
        GEOMETRY centroid "Point (Triggered)"
    }

    mst_devices {
        UUID id PK
        UUID sub_block_id FK
        VARCHAR mac_address
    }
    
    mst_sensor_calibrations {
        UUID id PK
        UUID device_id FK
        INT sensor_max_distance_mm
    }

    %% Transaction Tables (Timescale / Log)
    trx_readings {
        BIGINT id PK
        UUID device_id FK
        TIMESTAMP time "Hypertable Partition Key"
        FLOAT water_level_cm
        FLOAT temperature
    }

    trx_sub_block_current_states {
        UUID id PK
        UUID sub_block_id FK
        TIMESTAMP evaluated_at
        FLOAT water_level_cm
        VARCHAR state_source "observed/estimated/no_data"
        VARCHAR freshness_status
    }

    trx_irrigation_recommendations {
        UUID id PK
        UUID sub_block_id FK
        VARCHAR recommendation_type "DRAIN/IRRIGATE/MAINTAIN"
        FLOAT priority_score
        JSONB route_path_ids "Array of UUIDs (GIS Floyd-Warshall)"
    }

    %% Relationships
    mst_users ||--o{ mst_fields : "owns"
    mst_fields ||--|{ mst_sub_blocks : "contains"
    mst_sub_blocks ||--o{ mst_devices : "has"
    mst_devices ||--o{ mst_sensor_calibrations : "calibrated_with"
    
    mst_devices ||--o{ trx_readings : "generates (TimescaleDB)"
    mst_sub_blocks ||--o{ trx_sub_block_current_states : "state_of"
    mst_sub_blocks ||--o{ trx_irrigation_recommendations : "receives_action"
```

## Penjelasan Relasi Kritis
1. **Centroid Auto-Trigger:** Tabel `mst_sub_blocks` memiliki kolom `centroid`. Anda tidak boleh mengisi ini secara manual. Cukup masukkan `boundaries` (titik-titik pinggir sawah), dan *Postgres Trigger* akan otomatis menjadikannya titik tengah ber-koordinat pasti untuk keperluan graf irigasi.
2. **TimescaleDB:** `trx_readings` terikat dengan perangkat IoT, namun tidak di-*index* secara B-Tree standar. Ia di-*partition* oleh *TimescaleDB* berdasarkan kolom `time`.
3. **Route Injection:** `trx_irrigation_recommendations` menampung kolom tipe JSONB `route_path_ids`. Berisi himpunan ID (berurutan) dari `mst_sub_blocks` yang merepresentasikan pergerakan air.
