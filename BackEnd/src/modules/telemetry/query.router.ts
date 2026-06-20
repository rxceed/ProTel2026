import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '@/middleware/auth.middleware';
import { validate } from '@/middleware/validate.middleware';
import { successResponse } from '@/shared/utils/response.util';
import { db } from '@/db/client';
import { telemetryRecords, subBlockStates, subBlockCurrentStates } from '@/db/schema/trx';
import { devices } from '@/db/schema/mst';
import { AppError } from '@/middleware/error.middleware';
import { eq, desc, inArray } from 'drizzle-orm';

export const telemetryQueryRouter = Router();

const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

// ---------------------------------------------------------------------------
// Schema validasi untuk POST /sub-blocks/:subBlockId/states
// ---------------------------------------------------------------------------
const SubBlockStateSchema = z.object({
  fieldId:                 z.string().uuid(),
  cropCycleId:             z.string().uuid().optional(),
  stateTime:               z.string().datetime({ offset: true }),
  waterLevelCm:            z.number().optional(),
  waterLevelTrend:         z.enum(['rising', 'falling', 'stable']).optional(),
  stateSource:             z.enum(['observed', 'estimated', 'no_data']).default('observed'),
  freshnessStatus:         z.enum(['fresh', 'stale', 'no_data']).default('fresh'),
  lastObservationAt:       z.string().datetime({ offset: true }).optional(),
  sourceDeviceId:          z.string().uuid().optional(),
  interpolationConfidence: z.number().min(0).max(1).optional(),
});

// ---------------------------------------------------------------------------
// GET /telemetry/sub-blocks/:subBlockId/history
//
// Mengembalikan riwayat pembacaan sensor pada sub-block tertentu
// ---------------------------------------------------------------------------
telemetryQueryRouter.get(
  '/sub-blocks/:subBlockId/history',
  requireAuth,
  h(async (req, res) => {
    const { subBlockId } = req.params;
    
    const records = await db
      .select()
      .from(telemetryRecords)
      .where(eq(telemetryRecords.subBlockId, subBlockId))
      .orderBy(desc(telemetryRecords.eventTimestamp))
      .limit(30);

    // Balik urutan agar ascending (untuk timeline grafik dari kiri ke kanan)
    res.json(successResponse(records.reverse()));
  }),
);

// ---------------------------------------------------------------------------
// GET /telemetry/fields/:fieldId/history
//
// Mengembalikan riwayat seluruh sub-block dalam satu field
// ---------------------------------------------------------------------------
telemetryQueryRouter.get(
  '/fields/:fieldId/history',
  requireAuth,
  h(async (req, res) => {
    const { fieldId } = req.params;

    // Ambil data bergabung dengan mst.sub_blocks
    const records = await db.execute(`
      SELECT r.*, sb.name as sub_block_name 
      FROM trx.telemetry_records r
      JOIN mst.sub_blocks sb ON r.sub_block_id = sb.id
      WHERE sb.field_id = '${fieldId}'
      ORDER BY r.event_timestamp DESC
      LIMIT 100
    `);

    // Balik urutan agar kronologis dari masa lampau ke sekarang
    res.json(successResponse(records.rows.reverse()));
  }),
);

// ---------------------------------------------------------------------------
// GET /telemetry/sub-blocks/:subBlockId/states/latest
//
// Mengembalikan state terkini (trx.sub_block_current_states) dari sub-block.
// Digunakan untuk mengambil waterLevelCm terbaru per petak.
// ---------------------------------------------------------------------------
telemetryQueryRouter.get(
  '/sub-blocks/:subBlockId/states/latest',
  requireAuth,
  h(async (req, res) => {
    const { subBlockId } = req.params;

    const [latestRecord] = await db
      .select()
      .from(telemetryRecords)
      .where(eq(telemetryRecords.subBlockId, subBlockId))
      .orderBy(desc(telemetryRecords.eventTimestamp))
      .limit(1);

    res.json(successResponse(latestRecord ?? null));
  }),
);

// ---------------------------------------------------------------------------
// POST /telemetry/sub-blocks/:subBlockId/states
//
// Insert manual entry ke trx.sub_block_states.
// Digunakan untuk pencatatan status irigasi petak dari luar state-builder.
// ---------------------------------------------------------------------------
telemetryQueryRouter.post(
  '/sub-blocks/:subBlockId/states',
  requireAuth,
  validate(SubBlockStateSchema),
  h(async (req, res) => {
    const { subBlockId } = req.params;
    const body = req.body as z.infer<typeof SubBlockStateSchema>;

    const [inserted] = await db
      .insert(subBlockStates)
      .values({
        subBlockId,
        fieldId:                 body.fieldId,
        cropCycleId:             body.cropCycleId,
        stateTime:               new Date(body.stateTime),
        waterLevelCm:            body.waterLevelCm?.toFixed(2),
        waterLevelTrend:         body.waterLevelTrend,
        stateSource:             body.stateSource,
        freshnessStatus:         body.freshnessStatus,
        lastObservationAt:       body.lastObservationAt ? new Date(body.lastObservationAt) : undefined,
        sourceDeviceId:          body.sourceDeviceId,
        interpolationConfidence: body.interpolationConfidence?.toFixed(2),
      })
      .returning();

    res.status(201).json(successResponse(inserted));
  }),
);

// ---------------------------------------------------------------------------
// Schema validasi untuk POST /telemetry/records
// ---------------------------------------------------------------------------
const InsertTelemetryRecordSchema = z.object({
  device_code: z.string().min(1),
  device: z.array(
    z.object({
      distance: z.number().optional().nullable(),
      temperature: z.number().optional().nullable(),
      pressure: z.number().optional().nullable(),
    })
  ),
});

// ---------------------------------------------------------------------------
// POST /telemetry/records
//
// Memasukkan data pembacaan telemetry baru secara manual/langsung
// ---------------------------------------------------------------------------
telemetryQueryRouter.post(
  '/records',
  requireAuth,
  validate(InsertTelemetryRecordSchema),
  h(async (req, res) => {
    const body = req.body as z.infer<typeof InsertTelemetryRecordSchema>;

    if (body.device.length === 0) {
      res.status(201).json(successResponse([]));
      return;
    }

    // Generate computed device codes: `${device_code}_${index}`
    const computedCodes = body.device.map((_, index) => `${body.device_code}_${index}`);

    // Query all matching devices
    const foundDevices = await db
      .select({
        id: devices.id,
        deviceCode: devices.deviceCode,
        subBlockId: devices.subBlockId,
      })
      .from(devices)
      .where(inArray(devices.deviceCode, computedCodes));

    const deviceMap = new Map(foundDevices.map((d) => [d.deviceCode, d]));

    // Construct the database records to insert
    const recordsToInsert = body.device.map((item, index) => {
      const computedDeviceCode = `${body.device_code}_${index}`;
      const device = deviceMap.get(computedDeviceCode);

      if (!device) {
        throw new AppError(404, 'DEVICE_NOT_FOUND', `Device dengan kode ${computedDeviceCode} tidak ditemukan`);
      }

      return {
        eventTimestamp:  new Date(),
        deviceId:        device.id,
        deviceCode:      device.deviceCode,
        subBlockId:      device.subBlockId,
        waterLevelCm:    item.distance !== undefined && item.distance !== null ? item.distance.toString() : undefined,
        temperatureC:     item.temperature !== undefined && item.temperature !== null ? item.temperature.toString() : undefined,
        pressure:        item.pressure !== undefined && item.pressure !== null ? item.pressure.toString() : undefined,
        isValid:         true,
      };
    });

    const inserted = await db
      .insert(telemetryRecords)
      .values(recordsToInsert)
      .returning();

    res.status(201).json(successResponse(inserted));
  })
);
