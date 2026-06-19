# 🤖 TIER 3 (Model): Decision Support System Engine

## 1. Mekanisme Kerja
Modul inti dari proyek. Berada di `app/modules/decision_engine/engine.py`. Modul ini bersifat kaku (*Strict*) dan menggunakan struktur aturan Hierarki Veto (*Veto Hierarchy*) untuk mencegah sistem melakukan tindakan yang membahayakan sawah (misalnya memompa air masuk ke sawah saat akan datang badai petir).

## 2. Diagram Logika Aliran Keputusan (*Decision Flowchart*)
```mermaid
flowchart TD
    Start([Data Petak Diterima]) --> VetoBMKG
    
    %% VETO LEVEL 1: Cuaca Ekstrem
    VetoBMKG{"Ada BMKG Storm/Warning?"}
    VetoBMKG -- Ya --> SkipWarning["[Output]: SKIP_RAINFALL_WARNING <br/> Tunda Irigasi, Bahaya Badai"]
    VetoBMKG -- Tidak --> CekSensor
    
    %% VETO LEVEL 2: Integritas Hardware
    CekSensor{"Data 'water_level' == NULL?"}
    CekSensor -- Ya --> Obs["[Output]: NO_DATA <br/> Periksa Perangkat Sensor"]
    CekSensor -- Tidak --> PrediksiHujan
    
    %% VETO LEVEL 3: Prediksi Cuaca Harian
    PrediksiHujan{"Prakiraan Hujan > rain_delay_mm?"}
    PrediksiHujan -- Ya --> SkipHujan["[Output]: SKIP_RAIN_FORECAST <br/> Tunda Irigasi, Menunggu Hujan Turun"]
    PrediksiHujan -- Tidak --> AWD_Logic
    
    %% INTI AWD LOGIC
    AWD_Logic{"Bandingkan Water Level (W)"}
    AWD_Logic --> CekKritis
    
    CekKritis{"W <= drought_alert?"}
    CekKritis -- Ya --> IrgKritis["[Output]: IRRIGATE_CRITICAL <br/> Buka Pompa Max!"]
    CekKritis -- Tidak --> CekKering
    
    CekKering{"W <= awd_lower_threshold?"}
    CekKering -- Ya --> IrgNormal["[Output]: IRRIGATE_THRESHOLD <br/> Buka Pompa Standar"]
    CekKering -- Tidak --> CekBanjir
    
    CekBanjir{"W >= awd_upper_target?"}
    CekBanjir -- Ya --> Drain["[Output]: DRAIN_EXCESS <br/> Buka Katup Pembuangan"]
    CekBanjir -- Tidak --> Normal["[Output]: MAINTAIN_AWD_DRY <br/> Zona Nyaman, Matikan Pompa"]
    
    %% SCORER
    IrgKritis --> Scorer
    IrgNormal --> Scorer
    Drain --> Scorer
    Normal --> Scorer
    SkipWarning --> End
    Obs --> End
    SkipHujan --> End
    
    Scorer["Kalkulasi _calc_priority() <br/> Jika Kritis: Score * 2.0"] --> End([Kembalikan Recommendation Array])
```

## 3. Hubungan ke Modul Lain
- Input dari modul ini 100% dipasok oleh Node.js Backend (`engine-client.service.ts`).
- Modul ini **tidak berhubungan langsung dengan Database**. Jika terjadi kesalahan logika, pemecahannya murni pada perombakan skrip `.py` dan validasi *Pydantic*, tanpa perlu mengubah skema DB.
