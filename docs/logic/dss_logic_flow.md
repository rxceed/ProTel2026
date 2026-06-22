# Panduan Logika Decision Support System (DSS) AWD

Dokumen ini mendeskripsikan secara presisi alur pengambilan keputusan (*Decision Engine*) untuk irigasi hemat air (AWD - *Alternate Wetting and Drying*) berdasarkan kode sumber `engine.py` dan telah diverifikasi menggunakan *Massive Black Box Testing*.

## 1. Penilaian Awal & Validasi Data (Sanity Checks)
Sebelum mengevaluasi ketinggian air, DSS akan mengecek anomali atau instruksi prioritas dari luar (seperti tidak adanya *Rule Profile* atau *warning* bahaya dari BMKG).

```mermaid
flowchart TD
    Start([Mulai Evaluasi Sub-Block]) --> CheckData{Sensor Aktif?}
    CheckData -- Tidak/Null --> OutNoData[Rekomendasi: OBSERVE - Periksa Sensor]
    CheckData -- Ya --> CheckRule{Ada Rule Profile/Fase Tanam?}
    CheckRule -- Tidak --> OutNoRule[Rekomendasi: OBSERVE - Tidak Ada Rule]
    CheckRule -- Ya --> CheckWarning{BMKG Extreme Warning?}
    CheckWarning -- SKIP_CYCLE --> OutSkip[Rekomendasi: SKIP_AWD_EVENT]
    CheckWarning -- DELAY_IRRIGATION --> OutDelay[Rekomendasi: OBSERVE - Tunda]
    CheckWarning -- Aman --> CalcVariables[Lanjut ke Evaluasi Cuaca & Ambang Batas]
```

---

## 2. Kalkulasi Parameter Ambang Batas
Sistem mengekstrak prediksi BMKG (jika ada) terdekat dan membagi variabel ketinggian air (`wl`) menjadi beberapa zona matematis berdasarkan *Rule Profile*:

- **Kondisi Cuaca**:
  - `is_heavy`: Jika intensitas puncak $\ge 8.0$ mm.
  - `is_imminent`: Jika hujan akan datang dalam $< 3$ jam.
  - `is_sustained`: Jika durasi hujan $\ge 6$ jam.
- **Kondisi Lahan**:
  - `is_flooded`: `wl > (AWD Upper + 2.0cm)`
  - `is_high`: `wl >= AWD Upper`
  - `is_critical_dry`: `wl <= Drought Alert`
  - `is_dry`: `wl <= AWD Lower`

---

## 3. Matriks Intervensi Cuaca (Weather Veto System)
Apabila ada event hujan di masa depan, sistem mengevaluasi apakah hujan tersebut dapat dijadikan "gratisan" (menunda pompa) atau menjadi "ancaman" (butuh *drainase* cepat).

```mermaid
flowchart TD
    StartRain[Prediksi Hujan Ditemukan] --> IsFlooded{is_flooded?}
    
    %% Alur Banjir Parah
    IsFlooded -- Ya --> FloodedHeavy{is_heavy?}
    FloodedHeavy -- Ya --> DrainUrgent[DRAIN: URGENT_RAIN]
    FloodedHeavy -- Tidak --> DrainPrepare[DRAIN: PREPARE_RAIN]
    
    %% Alur Tinggi
    IsFlooded -- Tidak --> IsHigh{is_high?}
    IsHigh -- Ya --> HighHeavy{is_heavy?}
    HighHeavy -- Ya --> DrainHighHeavy[DRAIN: DRAIN_SEGERA]
    HighHeavy -- Tidak --> HighSusIm{not imminent ATAU sustained?}
    HighSusIm -- Ya --> DrainHighSus[DRAIN: PREPARE_RAIN]
    HighSusIm -- Tidak --> PassHigh[Bypass ke Threshold]

    %% Alur Kritis Kering (Fallthrough)
    IsHigh -- Tidak --> IsCritDry{is_critical_dry?}
    IsCritDry -- Ya --> PassCrit[Bypass - Abaikan Hujan, Tetap Irigasi!]

    %% Alur Kering (AWD Lower)
    IsCritDry -- Tidak --> IsDry{is_dry?}
    IsDry -- Ya --> DryImHeavy{is_imminent DAN is_heavy?}
    DryImHeavy -- Ya --> HoldRain[OBSERVE: Tahan Irigasi, Hujan Segera Tiba]
    DryImHeavy -- Tidak --> DrySus{is_sustained?}
    DrySus -- Ya --> HoldSus[OBSERVE: Tahan Irigasi, Hujan Lama]
    DrySus -- Tidak --> DrySafe{Bukan badai & belum dekat?}
    DrySafe -- Ya --> IrrigSafe[IRRIGATE: Irigasi Sebelum Hujan]
    DrySafe -- Tidak --> PassDry[Bypass ke Threshold]

    %% Alur Normal
    IsDry -- Tidak --> IsNormal{Normal Range}
    IsNormal --> NormalRain{imminent / heavy / sustained / >2mm?}
    NormalRain -- Ya --> HoldNormal[OBSERVE: HOLD_RAIN_FORECAST]
    NormalRain -- Tidak --> PassNormal[Bypass ke Threshold]

```

---

## 4. Evaluasi Ambang Batas Default (Thresholding)
Jika evaluasi intervensi cuaca (Veto) di atas lolos / *Bypass* (tidak ter-*trigger* karena tidak ada hujan, atau hujannya tidak signifikan memengaruhi air saat ini), maka **Sistem Murni Mengikuti Level Sensor** (Mode Reaktif).

```mermaid
flowchart TD
    StartThreshold[Threshold Evaluation] --> CheckCrit{wl <= drought_alert?}
    CheckCrit -- Ya --> IrrigCrit[IRRIGATE: IRRIGATE_CRITICAL - Mendesak!]
    CheckCrit -- Tidak --> CheckLower{wl <= awd_lower?}
    
    CheckLower -- Ya --> IrrigLower[IRRIGATE: IRRIGATE_THRESHOLD]
    CheckLower -- Tidak --> CheckUpper{wl >= awd_upper?}
    
    CheckUpper -- Ya --> DrainUpper[DRAIN: DRAIN_EXCESS]
    CheckUpper -- Tidak --> CheckZero{wl < 0?}
    
    CheckZero -- Ya --> MaintDry[MAINTAIN: MAINTAIN_DRY]
    CheckZero -- Tidak --> MaintWet[MAINTAIN: MAINTAIN_WET]
```

## Kesimpulan Fakta Berdasarkan Fuzzing (>3.000 Skema Ekstrem)
1. **Tidak Bisa DRAIN Air Negatif**: Sistem tidak akan pernah salah memerintahkan `DRAIN` pada sawah yang airnya berstatus minus (`wl < 0`), bahkan ketika badai super akan turun (karena secara matematis tidak ada genangan yang bisa disedot).
2. **Bypass Keputusan Kritis**: Tanaman padi tidak akan pernah dibiarkan mati konyol. Jika `is_critical_dry` tercapai, sistem **mengabaikan semua veto hujan BMKG** dan langsung mem-*bypass*-nya ke tahap `IRRIGATE_CRITICAL`. Keputusan ini mutlak.
3. **Efisiensi Energi (MAINTAIN)**: Saat level air di batas normal (antara *Lower* dan *Upper*), mesin membagi logikanya menjadi dua presisi `MAINTAIN_DRY` (saat tanah mongering parsial tapi belum tembus *threshold*) dan `MAINTAIN_WET` (masih ada air positif). Ini menghindari pompa *nyala-mati* (*short-cycling*).
