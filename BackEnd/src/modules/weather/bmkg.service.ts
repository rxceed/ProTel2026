import { eq, and, sql, desc } from 'drizzle-orm';
import { db } from '@/db/client';
import { fields as fieldsTable } from '@/db/schema/mst';
import {
  weatherForecastSnapshots as forecastsTable,
  weatherWarningSnapshots  as warningsTable,
  integrationLogs          as integLogsTable,
} from '@/db/schema';
import { config } from '@/config';
import { logger } from '@/shared/utils/logger.util';
import {
  type BmkgForecastResponse,
  type WeatherSlot,
  type RainEvent,
  type WeatherAnalysis,
  parseTimeSlot,
} from './bmkg.types';

// ---------------------------------------------------------------------------
// BMKG API constants
// ---------------------------------------------------------------------------
// URL base dibaca dari env BMKG_BASE_URL (default: https://api.bmkg.go.id/publik/prakiraan-cuaca)
// adm4_code per-field diambil dari DB: mst.fields.adm4_code (kode kelurahan Kepmendagri 2022)
const BMKG_FORECAST_URL = config.BMKG_BASE_URL;
const FETCH_TIMEOUT_MS  = 15_000;
const USER_AGENT        = 'SmartAWD-Backend/1.0 (research/precision-agriculture)';

// ---------------------------------------------------------------------------
// Fetch & store forecast for one field
// ---------------------------------------------------------------------------
export async function syncFieldForecast(field: {
  id:       string;
  adm4Code: string;
  name:     string;
}): Promise<void> {
  const startedAt = Date.now();
  let responseStatus: number | undefined;

  try {
    const url = `${BMKG_FORECAST_URL}?adm4=${encodeURIComponent(field.adm4Code)}`;
    const res  = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    responseStatus = res.status;

    if (!res.ok) {
      throw new Error(`BMKG returned HTTP ${res.status} for adm4=${field.adm4Code}`);
    }

    const json = await res.json() as BmkgForecastResponse;

    // Parse semua slot dari BMKG (flatten semua hari)
    const dataEntry = json.data?.[0];
    if (!dataEntry) {
      logger.warn({ adm4Code: field.adm4Code }, 'BMKG: empty data array');
      return;
    }
    const allSlots = dataEntry.cuaca.flat();
    const parsed   = allSlots.map(parseTimeSlot).filter(Boolean);

    if (parsed.length === 0) {
      logger.warn({ adm4Code: field.adm4Code }, 'BMKG: no parseable time slots');
      return;
    }

    // ── Filter hanya 12 jam ke depan (= max 4 slot × 3 jam) ────────────────
    const now     = new Date();
    const horizon = new Date(now.getTime() + 12 * 3_600_000);
    const slots12h = parsed.filter(
      (s): s is NonNullable<typeof s> =>
        !!s && s.forecastValidFrom >= now && s.forecastValidFrom < horizon,
    );

    // ── Bangun WeatherSlot[] untuk 12 jam ke depan ──────────────────────────
    const RAIN_THRESHOLD_MM = 2.0;
    const weatherSlots: WeatherSlot[] = slots12h.map(s => ({
      valid_from:   s.forecastValidFrom.toISOString(),
      valid_until:  s.forecastValidUntil.toISOString(),
      tp_mm:        s.precipitationMm ?? 0,
      weather_desc: s.weatherDesc ?? '',
      weather_code: s.weatherCode,
      is_wet:       (s.precipitationMm ?? 0) >= RAIN_THRESHOLD_MM,
    }));

    // ── Deteksi Rain Events dari slot berurutan yang wet ────────────────────
    const rainEvents: RainEvent[] = detectRainEvents(weatherSlots, now);

    // ── Cari slot kering terdekat setelah kondisi hujan ─────────────────────
    const firstWetIdx  = weatherSlots.findIndex(s => s.is_wet);
    const nextClearAt  = firstWetIdx >= 0
      ? (weatherSlots.find((s, i) => i > firstWetIdx && !s.is_wet)?.valid_from ?? null)
      : null;

    // ── Slot terdekat untuk metadata suhu/kelembaban ─────────────────────────
    const nearest = (parsed.find(s => !!s && s.forecastValidFrom >= now) ?? parsed[0])!;

    // ── Hitung peak intensity sebagai pengganti precipitation_mm (backward compat) ──
    const peakIntensityMm = weatherSlots.length > 0
      ? Math.max(...weatherSlots.map(s => s.tp_mm))
      : 0;

    // ── Bangun WeatherAnalysis utuh untuk disimpan ke full_response_json ─────
    const weatherAnalysis: WeatherAnalysis = {
      fetched_at:           now.toISOString(),
      adm4_code:            field.adm4Code,
      window_hours:         12,
      slots:                weatherSlots,
      rain_events:          rainEvents,
      next_clear_window_at: nextClearAt,
    };

    // ── Tandai snapshot sebelumnya sebagai bukan latest ─────────────────────
    await db.update(forecastsTable)
      .set({ isLatest: false })
      .where(and(
        eq(forecastsTable.fieldId, field.id),
        eq(forecastsTable.isLatest, true),
      ));

    // ── Insert snapshot baru ──────────────────────────────────────────────────
    const validFrom  = parsed[0]!.forecastValidFrom;
    const validUntil = parsed[parsed.length - 1]!.forecastValidUntil;

    await db.insert(forecastsTable).values({
      fieldId:            field.id,
      adm4Code:           field.adm4Code,
      forecastValidFrom:  validFrom,
      forecastValidUntil: validUntil,
      // peak intensity per 3-jam (bukan sum), untuk backward compat
      precipitationMm:    peakIntensityMm > 0 ? peakIntensityMm.toFixed(2) : '0',
      temperatureC:       nearest.temperatureC?.toFixed(2) ?? null,
      humidityPct:        nearest.humidityPct?.toFixed(2) ?? null,
      weatherCode:        nearest.weatherCode ? Number(nearest.weatherCode) : null,
      weatherDesc:        nearest.weatherDesc ?? null,
      bmkgCategory:       nearest.bmkgCategory ?? null,
      fullResponseJson:   weatherAnalysis as unknown as object,
      isLatest:           true,
      fetchedAt:          now,
    });

    logger.info(
      { fieldName: field.name, adm4Code: field.adm4Code, slots: parsed.length, peakIntensityMm },
      'BMKG forecast synced',
    );

    await logIntegration({ action: 'forecast_sync', status: 'success', url: BMKG_FORECAST_URL,
      responseStatus, responseTimeMs: Date.now() - startedAt });
  } catch (err) {
    logger.error({ err, adm4Code: field.adm4Code }, 'BMKG forecast sync failed');
    await logIntegration({ action: 'forecast_sync', status: 'failed', url: BMKG_FORECAST_URL,
      responseStatus, responseTimeMs: Date.now() - startedAt, error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Sync all active fields
// ---------------------------------------------------------------------------
export async function syncAllForecasts(): Promise<void> {
  const activeFields = await db
    .select({ id: fieldsTable.id, adm4Code: fieldsTable.adm4Code, name: fieldsTable.name })
    .from(fieldsTable)
    .where(eq(fieldsTable.isActive, true));

  logger.info({ count: activeFields.length }, 'Starting BMKG forecast sync');

  for (const field of activeFields) {
    if (!field.adm4Code) continue;
    await syncFieldForecast(field);
    // Rate limit: BMKG allows 60 req/min → 1 req/sec is safe
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
}

// ---------------------------------------------------------------------------
// Get latest forecast for DSS (used by engine-client)
// ---------------------------------------------------------------------------
export async function getLatestForecast(fieldId: string) {
  const [latest] = await db
    .select()
    .from(forecastsTable)
    .where(and(eq(forecastsTable.fieldId, fieldId), eq(forecastsTable.isLatest, true)))
    .limit(1);
  return latest ?? null;
}

// ---------------------------------------------------------------------------
// Get active warnings for DSS (placeholder — BMKG warning API varies)
// ---------------------------------------------------------------------------
export async function getActiveWarnings(fieldId: string) {
  const now = new Date();
  return db
    .select()
    .from(warningsTable)
    .where(and(
      eq(warningsTable.fieldId, fieldId),
      eq(warningsTable.isActive, true),
      sql`(${warningsTable.warningExpiresAt} IS NULL OR ${warningsTable.warningExpiresAt} > ${now})`,
    ));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function logIntegration(params: {
  action:          string;
  status:          string;
  url:             string;
  responseStatus?: number;
  responseTimeMs:  number;
  error?:          string;
}): Promise<void> {
  try {
    await db.insert(integLogsTable).values({
      integrationName: 'bmkg',
      action:          params.action,
      status:          params.status,
      requestUrl:      params.url,
      responseStatus:  params.responseStatus,
      responseTimeMs:  params.responseTimeMs,
      errorMessage:    params.error,
    });
  } catch { /* non-critical */ }
}

// ---------------------------------------------------------------------------
// Rain Event Detection helpers
// ---------------------------------------------------------------------------

/**
 * Deteksi semua "kejadian hujan" dari array slot.
 * Slot wet yang berurutan digabung menjadi satu RainEvent.
 */
function detectRainEvents(slots: WeatherSlot[], now: Date): RainEvent[] {
  const HEAVY_THRESHOLD_MM = 8.0;
  const events: RainEvent[] = [];
  let i = 0;

  while (i < slots.length) {
    if (!slots[i].is_wet) { i++; continue; }

    // Kumpulkan semua slot wet berurutan sebagai satu event
    const eventSlots: WeatherSlot[] = [slots[i]];
    while (i + 1 < slots.length && slots[i + 1].is_wet) {
      i++;
      eventSlots.push(slots[i]);
    }

    const totalMm    = eventSlots.reduce((sum, s) => sum + s.tp_mm, 0);
    const peakMm     = Math.max(...eventSlots.map(s => s.tp_mm));
    const startsAt   = new Date(eventSlots[0].valid_from);
    const endsAt     = new Date(eventSlots[eventSlots.length - 1].valid_until);
    const hoursUntil = Math.max(0, (startsAt.getTime() - now.getTime()) / 3_600_000);

    events.push({
      starts_at:         eventSlots[0].valid_from,
      ends_at:           eventSlots[eventSlots.length - 1].valid_until,
      hours_until_rain:  Math.round(hoursUntil * 10) / 10,
      duration_hours:    eventSlots.length * 3,
      total_mm:          Math.round(totalMm * 10) / 10,
      peak_intensity_mm: Math.round(peakMm * 10) / 10,
      intensity_label:   peakMm >= HEAVY_THRESHOLD_MM ? 'heavy' : 'moderate',
    });

    i++;
  }

  return events;
}
