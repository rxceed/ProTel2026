import { eq, and, sql, desc } from 'drizzle-orm';
import { db } from '@/db/client';
import { fields as fieldsTable } from '@/db/schema/mst';
import {
  weatherForecastSnapshots as forecastsTable,
  weatherWarningSnapshots  as warningsTable,
  integrationLogs          as integLogsTable,
} from '@/db/schema';
import { logger } from '@/shared/utils/logger.util';
import { type BmkgForecastResponse, parseTimeSlot } from './bmkg.types';

// ---------------------------------------------------------------------------
// BMKG API constants
// ---------------------------------------------------------------------------
const BMKG_FORECAST_URL = 'https://api.bmkg.go.id/publik/prakiraan/cuaca';
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

    // Parse forecast slots
    const dataEntry = json.data?.[0];
    if (!dataEntry) {
      logger.warn({ adm4Code: field.adm4Code }, 'BMKG: empty data array');
      return;
    }

    const slots = dataEntry.cuaca.flat(); // flatten day-groups
    const parsed = slots.map(parseTimeSlot).filter(Boolean);

    if (parsed.length === 0) {
      logger.warn({ adm4Code: field.adm4Code }, 'BMKG: no parseable time slots');
      return;
    }

    // Determine coverage window
    const validFrom  = parsed[0]!.forecastValidFrom;
    const validUntil = parsed[parsed.length - 1]!.forecastValidUntil;

    // Find next 24-hour precipitation total
    const now     = new Date();
    const next24h = parsed.filter(
      (s): s is NonNullable<typeof s> => !!s && s.forecastValidFrom >= now && s.forecastValidFrom < new Date(Date.now() + 24 * 3_600_000),
    );
    const precipNext24h = next24h.reduce((sum, s) => sum + (s.precipitationMm ?? 0), 0);

    // Get the nearest slot
    const nearest = (parsed.find((s): s is NonNullable<typeof s> => !!s && s.forecastValidFrom >= now) ?? parsed[0])!;

    // INSERT snapshot
    await db.update(forecastsTable)
      .set({ isLatest: false })
      .where(and(
        eq(forecastsTable.fieldId, field.id),
        eq(forecastsTable.isLatest, true),
      ));

    await db.insert(forecastsTable).values({
      fieldId:           field.id,
      adm4Code:          field.adm4Code,
      forecastValidFrom: validFrom,
      forecastValidUntil: validUntil,
      precipitationMm:   precipNext24h > 0 ? precipNext24h.toFixed(2) : '0',
      temperatureC:      nearest.temperatureC?.toFixed(2) ?? null,
      humidityPct:       nearest.humidityPct?.toFixed(2) ?? null,
      weatherCode:       nearest.weatherCode ? Number(nearest.weatherCode) : null,
      weatherDesc:       nearest.weatherDesc ?? null,
      bmkgCategory:      nearest.bmkgCategory ?? null,
      isLatest:          true,
      fetchedAt:         new Date(),
    });

    logger.info(
      { fieldName: field.name, adm4Code: field.adm4Code, slots: parsed.length, precipNext24h },
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

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
