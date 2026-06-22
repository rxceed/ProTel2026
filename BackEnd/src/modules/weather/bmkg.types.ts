// ---------------------------------------------------------------------------
// BMKG API TypeScript interfaces
// Ref: https://api.bmkg.go.id
// ---------------------------------------------------------------------------

/** Satu slot waktu dalam forecast BMKG */
export interface BmkgTimeSlot {
  local_datetime:   string;     // "2024-06-01 18:00:00"
  t?:               number;     // temperature °C
  hu?:              number;     // humidity %
  tp?:              number;     // precipitation mm (undocumented field)
  ws?:              number;     // wind speed km/h
  wd_to?:           string;     // wind direction (e.g. "NE")
  wd_from?:         string;
  weather?:         number;     // weather code
  weather_desc?:    string;     // "Cerah Berawan"
  weather_desc_en?: string;
  image?:           string;
}

/** Lokasi metadata dari BMKG */
export interface BmkgLokasi {
  adm4:       string;
  desa:       string;
  kecamatan:  string;
  kotkab:     string;
  provinsi:   string;
  lon:        number;
  lat:        number;
  timezone:   string;
}

/** Satu entri data forecast dari BMKG */
export interface BmkgDataEntry {
  lokasi: BmkgLokasi;
  cuaca:  BmkgTimeSlot[][];  // [day][timeslot]
}

/** Full response pradikaan cuaca dari BMKG */
export interface BmkgForecastResponse {
  data:   BmkgDataEntry[];
  lokasi: unknown;
}

/** Parsed/normalized slot yang akan disimpan ke DB */
export interface ParsedForecastSlot {
  forecastValidFrom:  Date;
  forecastValidUntil: Date;
  temperatureC:       number | null;
  humidityPct:        number | null;
  precipitationMm:    number | null;
  windSpeedKmh:       number | null;
  windDirection:      string | null;
  weatherCode:        number | null;
  weatherDesc:        string | null;
  bmkgCategory:       string | null;
}

// ---------------------------------------------------------------------------
// Structured weather analysis types (for DSS payload)
// ---------------------------------------------------------------------------

/** Satu slot waktu 3-jaman yang telah di-normalisasi dari raw BMKG (12 jam ke depan) */
export interface WeatherSlot {
  valid_from:   string;   // ISO 8601 WIB (+07:00)
  valid_until:  string;   // ISO 8601 WIB (+07:00)
  tp_mm:        number;   // Total Precipitation mm (field `tp` dari BMKG)
  weather_desc: string;   // e.g. "Hujan Ringan"
  weather_code: number | null;
  is_wet:       boolean;  // true jika tp_mm >= RAIN_THRESHOLD (2 mm)
}

/**
 * Satu "Kejadian Hujan" (Rain Event) — kumpulan slot berurutan yang semuanya wet.
 * Menjawab: kapan? seberapa lama? seberapa lebat?
 */
export interface RainEvent {
  starts_at:         string;  // ISO 8601 WIB, kapan event mulai
  ends_at:           string;  // ISO 8601 WIB, kapan event selesai (akhir slot terakhir)
  hours_until_rain:  number;  // jam dari sekarang sampai event mulai (0 jika sedang berlangsung)
  duration_hours:    number;  // total durasi event dalam jam
  total_mm:          number;  // akumulasi tp dalam event ini saja (bukan 12 jam)
  peak_intensity_mm: number;  // nilai tp tertinggi dalam event
  intensity_label:   'light' | 'moderate' | 'heavy'; // < 2mm, 2–8mm, ≥ 8mm (based on peak)
}

/**
 * Hasil lengkap analisa cuaca untuk 12 jam ke depan.
 * Disimpan di kolom `full_response_json` di tabel weather_forecast_snapshots
 * dan dikirimkan ke DSS Python sebagai payload `weather`.
 */
export interface WeatherAnalysis {
  fetched_at:           string;      // Waktu fetch dari BMKG
  adm4_code:            string;      // Kode wilayah adm4 BMKG
  window_hours:         number;      // Selalu 12
  slots:                WeatherSlot[]; // Array slot (max 4 slot × 3 jam = 12 jam)
  rain_events:          RainEvent[];   // Kejadian hujan terdeteksi (bisa kosong)
  next_clear_window_at: string | null; // Kapan slot kering berikutnya (null jika semua basah)
}

// ---------------------------------------------------------------------------
// Weather code → BMKG category mapping
// ---------------------------------------------------------------------------
const WEATHER_CATEGORIES: Record<number, string> = {
  0: 'cerah',
  1: 'cerah_berawan',
  2: 'cerah_berawan',
  3: 'berawan',
  4: 'berawan_tebal',
  10: 'asap',
  45: 'kabut',
  60: 'hujan_ringan',
  61: 'hujan_ringan',
  63: 'hujan_sedang',
  65: 'hujan_lebat',
  80: 'hujan_lokal',
  95: 'hujan_petir',
  97: 'hujan_petir_lebat',
};

export function getBmkgCategory(weatherCode: number | undefined): string | null {
  if (weatherCode === undefined) return null;
  return WEATHER_CATEGORIES[weatherCode] ?? null;
}

/** Parse satu time slot dari BMKG ke format normalized */
export function parseTimeSlot(slot: BmkgTimeSlot): ParsedForecastSlot | null {
  if (!slot.local_datetime) return null;

  // Parse "2024-06-01 18:00:00" → Date
  const validFrom = new Date(slot.local_datetime.replace(' ', 'T') + '+07:00');
  if (isNaN(validFrom.getTime())) return null;

  // Forecast valid window: 3 hours per slot
  const validUntil = new Date(validFrom.getTime() + 3 * 60 * 60 * 1000);

  return {
    forecastValidFrom:  validFrom,
    forecastValidUntil: validUntil,
    temperatureC:       slot.t   ?? null,
    humidityPct:        slot.hu  ?? null,
    precipitationMm:    slot.tp  ?? null,  // undocumented field
    windSpeedKmh:       slot.ws  ?? null,
    windDirection:      slot.wd_to ?? null,
    weatherCode:        slot.weather ?? null,
    weatherDesc:        slot.weather_desc ?? null,
    bmkgCategory:       getBmkgCategory(slot.weather),
  };
}
