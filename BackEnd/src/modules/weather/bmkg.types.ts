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
