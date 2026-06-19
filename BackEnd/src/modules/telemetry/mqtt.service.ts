import mqtt from 'mqtt';
import { db } from '@/db/client';
import {
  devices           as devicesTable,
  sensorCalibrations as calTable,
} from '@/db/schema/mst';
import { eq, inArray, and, sql } from 'drizzle-orm';
import { processBatch } from './ingest.service';
import { config } from '@/config';
import { logger } from '@/shared/utils/logger.util';
import type { BatchPayload, Reading } from './ingest.schema';

// CATATAN: buildFieldStates TIDAK dipanggil di sini.
// State diperbarui oleh cron job setiap 10 menit (state-builder.job.ts)
// dan oleh engine-client.service.ts sesaat sebelum evaluasi DSS.

export function startMqttListener() {
  const client = mqtt.connect(config.MQTT_URL);

  client.on('connect', () => {
    logger.info(`✅ Connected to MQTT broker at ${config.MQTT_URL}`);
    client.subscribe('sensor/data', (err) => {
      if (err) {
        logger.error({ err }, 'Failed to subscribe to sensor/data');
      } else {
        logger.info('📡 Subscribed to topic: sensor/data');
      }
    });
  });

  client.on('message', async (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());

      // Expected payload: { device: [{ id: "N1", d: 120 }], temperature: 29.63, pressure: 1007.12 }
      if (!payload.device || !Array.isArray(payload.device)) {
        logger.warn('MQTT payload missing device array');
        return;
      }

      const temp     = payload.temperature;
      const pressure = payload.pressure;

      // Extract device codes
      const deviceCodes = payload.device.map((d: any) => d.id).filter(Boolean);
      if (deviceCodes.length === 0) return;

      // Lookup devices in DB (ambil id juga untuk join calibration)
      const dbDevices = await db.select({
        id:         devicesTable.id,
        deviceCode: devicesTable.deviceCode,
        fieldId:    devicesTable.fieldId,
      })
      .from(devicesTable)
      .where(inArray(devicesTable.deviceCode, deviceCodes));

      if (dbDevices.length === 0) {
        logger.warn({ deviceCodes }, 'None of the devices are registered in database');
        return;
      }

      // Pre-load kalibrasi aktif per device (untuk sensor_max_distance_mm)
      const deviceIds = dbDevices.map(d => d.id);
      const calibrations = await db.select({
        deviceId:            calTable.deviceId,
        sensorMaxDistanceMm: calTable.sensorMaxDistanceMm,
      })
      .from(calTable)
      .where(and(
        inArray(calTable.deviceId, deviceIds),
        eq(calTable.isActive, true),
        sql`${calTable.validFrom} <= NOW()`,
        sql`(${calTable.validUntil} IS NULL OR ${calTable.validUntil} > NOW())`,
      ));

      // Map deviceId → sensorMaxDistanceMm (fallback 1400mm jika tidak ada kalibrasi)
      const calMap = new Map(calibrations.map(c => [c.deviceId, c.sensorMaxDistanceMm ?? 1400]));

      // Group devices by fieldId
      const fieldGroups = new Map<string, Reading[]>();

      for (const devData of payload.device) {
        if (!devData.id) continue;

        const dbDevice = dbDevices.find(d => d.deviceCode === devData.id);
        if (!dbDevice) continue; // device tidak terdaftar

        // ── Konversi Sensor → Nilai Fisik ──────────────────────────────────
        // Water Level: (sensor_max_distance_mm - d) / 10
        // sensor_max_distance_mm dapat dikonfigurasi per-device via mst.sensor_calibrations
        let waterLevelCm: number | undefined;
        if (typeof devData.d === 'number') {
          const maxDistMm = calMap.get(dbDevice.id) ?? 1400;
          waterLevelCm = (maxDistMm - devData.d) / 10;
        }

        // Elevasi dari tekanan barometrik (untuk raw data saja)
        // Elevation (m) = 44330 × (1 − (pressure / 1013.25)^0.1903)
        let elevationM: number | undefined;
        if (typeof pressure === 'number') {
          elevationM = 44330 * (1 - Math.pow(pressure / 1013.25, 0.1903));
        }

        const reading: Reading = {
          device_code: devData.id,
          timestamp:   new Date().toISOString(),
          data: {
            water_level_cm: waterLevelCm,
            temperature_c:  temp,
            pressure_hpa:   pressure,
            elevation_m:    elevationM,
          },
        };

        const { fieldId } = dbDevice;
        const readings = fieldGroups.get(fieldId) || [];
        readings.push(reading);
        fieldGroups.set(fieldId, readings);
      }

      // Simpan raw telemetry ke DB — TIDAK memicu state builder
      for (const [fieldId, readings] of fieldGroups.entries()) {
        const batchPayload: BatchPayload = {
          field_id:     fieldId,
          gateway_code: 'mqtt-listener',
          readings,
        };

        const result = await processBatch(batchPayload);
        logger.info({ fieldId, result }, 'MQTT batch ingested — state will refresh on next cron');
      }

    } catch (err) {
      logger.error({ err, msg: message.toString() }, 'Failed to process MQTT message');
    }
  });

  client.on('error', (err) => {
    logger.error({ err }, 'MQTT Connection Error');
  });
}

