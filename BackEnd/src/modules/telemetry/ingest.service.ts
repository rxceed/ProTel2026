import { eq, and, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '@/db/client';
import {
  devices as devicesTable,
  sensorCalibrations as sensorCalibrationsTable,
  alertConfigs as alertConfigsTable,
} from '@/db/schema/mst';
import {
  telemetryBatches as batchesTable,
  rawEvents as rawEventsTable,
  telemetryRecords as recordsTable,
  telemetryAlerts as alertsTable,
} from '@/db/schema';
import { logger } from '@/shared/utils/logger.util';
import { normalizeReading, type CalibrationOffsets } from './normalizer';
import type { BatchPayload } from './ingest.schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface BatchResult {
  batchId:   string;
  processed: number;
  failed:    number;
  skipped:   number;
}

type AlertConfig = typeof alertConfigsTable.$inferSelect;

// ---------------------------------------------------------------------------
// Main ingest function
// ---------------------------------------------------------------------------
export async function processBatch(payload: BatchPayload): Promise<BatchResult> {
  const fieldId = payload.field_id;

  // 1. Create batch record (source-of-truth entry)
  const [batch] = await db.insert(batchesTable).values({
    fieldId,
    gatewayCode:      payload.gateway_code,
    batchSize:        payload.readings.length,
    rawPayload:       payload as object,
    processingStatus: 'received',
  }).returning();
  const batchId = batch!.id;

  let processed = 0, failed = 0, skipped = 0;

  try {
    // 2. Pre-load devices for field  (avoid N queries per reading)
    const fieldDevices = await db.select().from(devicesTable)
      .where(eq(devicesTable.fieldId, fieldId));
    const deviceMap = new Map(fieldDevices.map(d => [d.deviceCode, d]));

    // 3. Pre-load calibrations for relevant devices
    const deviceIds = [...new Set(
      payload.readings
        .map(r => deviceMap.get(r.device_code)?.id)
        .filter((id): id is string => id !== undefined),
    )];

    const calMap = new Map<string, typeof sensorCalibrationsTable.$inferSelect>();
    if (deviceIds.length > 0) {
      const cals = await db.select().from(sensorCalibrationsTable)
        .where(and(
          inArray(sensorCalibrationsTable.deviceId, deviceIds),
          eq(sensorCalibrationsTable.isActive, true),
          sql`${sensorCalibrationsTable.validFrom} <= NOW()`,
          sql`(${sensorCalibrationsTable.validUntil} IS NULL OR ${sensorCalibrationsTable.validUntil} > NOW())`,
        ));
      cals.forEach(c => calMap.set(c.deviceId, c));
    }

    // 4. Pre-load alert configs for field
    const alertConfigs = await db.select().from(alertConfigsTable)
      .where(and(eq(alertConfigsTable.fieldId, fieldId), eq(alertConfigsTable.isEnabled, true)));

    // 5. Process each reading
    for (const reading of payload.readings) {
      try {
        const device = deviceMap.get(reading.device_code);
        if (!device) {
          logger.warn({ deviceCode: reading.device_code, fieldId }, 'Device tidak ditemukan');
          skipped++;
          continue;
        }

        const eventTime = reading.timestamp ? new Date(reading.timestamp) : new Date();

        // 5a. INSERT raw_event (never modified — source of truth)
        const [rawEvent] = await db.insert(rawEventsTable).values({
          batchId,
          deviceId:        device.id,
          deviceCode:      reading.device_code,
          eventTimestamp:  eventTime,
          seqNumber:       reading.seq_number,
          rawData:         reading.data as object,
          isProcessed:     false,
        }).returning({ id: rawEventsTable.id });

        // 5b. Apply calibration
        const cal = calMap.get(device.id);
        const offsets: CalibrationOffsets = {
          waterLevelOffsetCm: parseFloat(cal?.waterLevelOffsetCm ?? '0'),
          temperatureOffsetC: parseFloat(cal?.temperatureOffsetC ?? '0'),
          humidityOffsetPct:  parseFloat(cal?.humidityOffsetPct  ?? '0'),
        };
        const norm = normalizeReading(reading.data, offsets);

        // 5c. INSERT telemetry_record (TimescaleDB hypertable)
        await db.insert(recordsTable).values({
          id:              randomUUID(),
          eventTimestamp:  eventTime,
          deviceId:        device.id,
          deviceCode:      device.deviceCode,
          subBlockId:      device.subBlockId,
          rawEventId:      rawEvent!.id,
          waterLevelCm:    norm.water_level_cm?.toString(),
          temperatureC:    norm.temperature_c?.toString(),
          humidityPct:     norm.humidity_pct?.toString(),
          batteryPct:      norm.battery_pct?.toString(),
          signalRssi:      norm.signal_rssi,
          calibrationId:   cal?.id,
          waterLevelRawCm: norm.water_level_raw_cm?.toString(),
          isValid:         norm.is_valid,
          validationNotes: norm.validation_notes,
        });

        // 5d. Mark raw_event processed
        await db.update(rawEventsTable).set({ isProcessed: true })
          .where(eq(rawEventsTable.id, rawEvent!.id));

        // 5e. Update device telemetry fields
        await db.update(devicesTable).set({
          lastSeenAt: eventTime,
          ...(norm.battery_pct !== null && {
            batteryLevelPct:  norm.battery_pct.toString(),
            batteryUpdatedAt: eventTime,
          }),
          updatedAt: new Date(),
        }).where(eq(devicesTable.id, device.id));

        // 5f. Check alert thresholds (async — don't block response)
        if (norm.is_valid && device.subBlockId) {
          void checkAlerts({
            fieldId, subBlockId: device.subBlockId, deviceId: device.id,
            waterLevelCm: norm.water_level_cm, batteryPct: norm.battery_pct,
            configs: alertConfigs,
          });
        }

        processed++;
      } catch (readingError) {
        logger.error({ err: readingError, device: reading.device_code }, 'Processing reading failed');
        failed++;
      }
    }

    // 6. Update batch
    await db.update(batchesTable).set({
      processingStatus: failed === payload.readings.length ? 'failed' : 'processed',
      processedAt:      new Date(),
    }).where(eq(batchesTable.id, batchId));

    return { batchId, processed, failed, skipped };
  } catch (err) {
    await db.update(batchesTable)
      .set({ processingStatus: 'failed', processingError: String(err) })
      .where(eq(batchesTable.id, batchId));
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Alert checking (internal)
// ---------------------------------------------------------------------------
async function checkAlerts(params: {
  fieldId:      string;
  subBlockId:   string;
  deviceId:     string;
  waterLevelCm: number | null;
  batteryPct:   number | null;
  configs:      AlertConfig[];
}): Promise<void> {
  const { fieldId, subBlockId, deviceId, waterLevelCm, batteryPct, configs } = params;

  for (const cfg of configs) {
    // Skip if config scoped to different sub-block
    if (cfg.subBlockId && cfg.subBlockId !== subBlockId) continue;
    if (!cfg.isEnabled) continue;

    let triggered: number | null = null;
    const threshold = parseFloat(cfg.thresholdValue);

    switch (cfg.alertType) {
      case 'water_level_low':
        if (waterLevelCm !== null && waterLevelCm <= threshold) triggered = waterLevelCm;
        break;
      case 'water_level_high':
        if (waterLevelCm !== null && waterLevelCm >= threshold) triggered = waterLevelCm;
        break;
      case 'battery_low':
        if (batteryPct !== null && batteryPct <= threshold) triggered = batteryPct;
        break;
    }
    if (triggered === null) continue;

    // Cooldown check — don't repeat alert within cooldown window
    const cooldownSince = new Date(Date.now() - cfg.cooldownMinutes * 60_000);
    const [existing] = await db.select({ id: alertsTable.id })
      .from(alertsTable)
      .where(and(
        eq(alertsTable.subBlockId, subBlockId),
        eq(alertsTable.alertType,  cfg.alertType),
        eq(alertsTable.isResolved, false),
        sql`${alertsTable.triggeredAt} > ${cooldownSince}`,
      ))
      .limit(1);
    if (existing) continue;

    await db.insert(alertsTable).values({
      fieldId,
      subBlockId,
      deviceId,
      alertType:      cfg.alertType,
      severity:       cfg.severity,
      triggeredValue: triggered.toString(),
      thresholdValue: cfg.thresholdValue,
      alertMessage:   alertMsg(cfg.alertType, triggered, threshold, cfg.thresholdUnit),
    });
    logger.info({ fieldId, subBlockId, alertType: cfg.alertType, triggered }, 'Alert triggered');
  }
}

function alertMsg(type: string, val: number, threshold: number, unit: string): string {
  const labels: Record<string, string> = {
    water_level_low:  `Level air rendah: ${val} ${unit} (batas: ${threshold} ${unit})`,
    water_level_high: `Level air tinggi: ${val} ${unit} (batas: ${threshold} ${unit})`,
    battery_low:      `Baterai sensor rendah: ${val}% (batas: ${threshold}%)`,
  };
  return labels[type] ?? `Alert ${type}: ${val} ${unit}`;
}
