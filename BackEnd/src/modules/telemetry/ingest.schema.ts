import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema untuk POST /ingest/batch
// ---------------------------------------------------------------------------

export const SensorDataSchema = z.object({
  water_level_cm: z.number().optional(),
  temperature_c:  z.number().optional(),
  humidity_pct:   z.number().optional(),
  battery_pct:    z.number().min(0).max(100).optional(),
  signal_rssi:    z.number().int().optional(),
}).passthrough(); // simpan field extra di raw_data

export const ReadingSchema = z.object({
  device_code: z.string().min(1).max(100),
  timestamp:   z.string().datetime({ offset: true }).optional(), // ISO 8601 with tz
  seq_number:  z.coerce.number().int().optional(),
  data:        SensorDataSchema,
});

export const BatchPayloadSchema = z.object({
  field_id:     z.string().uuid('field_id harus berupa UUID'),
  gateway_code: z.string().max(100).optional(),
  readings:     z.array(ReadingSchema).min(1).max(100),
});

export type BatchPayload = z.infer<typeof BatchPayloadSchema>;
export type SensorData   = z.infer<typeof SensorDataSchema>;
export type Reading      = z.infer<typeof ReadingSchema>;
