# 🌐 Kontrak API Eksternal (API Reference)

Dokumen ini merangkum *End Point* vital di dalam ekosistem *Microservices* yang sering diakses oleh FrontEnd atau saling dihubungi antar-layanan (BE $\leftrightarrow$ Model).

---

## 1. BackEnd Node.js (Port 3000)
Akses utama untuk Aplikasi *React* (FrontEnd).

### A. Dapatkan Status Keseluruhan Petak Lahan
- **GET** `/api/fields/:fieldId/sub-blocks/status`
- **Tujuan:** Digunakan *FrontEnd* untuk mewarnai peta.
- **Respons (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "sub_block_id": "uuid-1234",
      "code": "A1",
      "water_level_cm": 8.5,
      "state": "FRESH",
      "source": "OBSERVED",
      "boundaries": { "type": "Polygon", "coordinates": [...] },
      "active_recommendation": {
         "type": "DRAIN_EXCESS",
         "route_path_ids": ["uuid-1234", "uuid-5678"]
      }
    }
  ]
}
```

---

## 2. Model Decision Service (Port 8002)
Ini adalah API tertutup (*Internal network*) yang dipanggil oleh Cron Job Node.js.

### A. Evaluasi Aturan AWD (*Evaluate*)
- **POST** `/evaluate`
- **Payload Request:**
```json
{
  "job_id": "cron-xyz",
  "field_id": "field-123",
  "weather": { "precipitation_mm": 0, "is_stale": false },
  "active_warnings": [],
  "sub_blocks": [
    {
      "id": "uuid-1234",
      "state": { "water_level_cm": -1.0, "state_source": "observed" },
      "rule_profile": { "awd_lower_threshold_cm": 2.0, "awd_upper_target_cm": 5.0 }
    }
  ]
}
```
- **Respons (200 OK):**
```json
{
  "recommendations": [
    {
      "sub_block_id": "uuid-1234",
      "recommendation_type": "irrigate",
      "command_template_code": "IRRIGATE_CRITICAL",
      "priority_score": 1.1,
      "priority_rank": 1
    }
  ]
}
```

---

## 3. Ricemesh GIS Processing (Port 8003)
API asinkron untuk perhitungan Floyd-Warshall.

### A. Picu Kalkulasi Graf Spasial
- **POST** `/run`
- **Respons (202 Accepted):**
```json
{
  "status": "enqueued",
  "job_id": "arq_task_987654321"
}
```

### B. Minta Matriks Rute Spesifik
- **POST** `/matrix`
- **Tujuan:** Karena Node.js tidak menyimpan matriks pointer rute raksasa di memorinya, ia menembak `/matrix` dengan ID dari Sawah Sumber ke Sawah Tujuan untuk diekstrak menjadi satu baris rute (Array).
- **Respons (200 OK):**
```json
{
  "source_idx": 0,
  "target_idx": 3,
  "route_indices": [0, 5, 2, 3]
}
```
