import { z } from 'zod';

// ---------------------------------------------------------------------------
// GeoJSON Polygon schema (sesuai RFC 7946)
// Dipakai untuk import sub-block polygons
// ---------------------------------------------------------------------------
const PositionSchema = z.tuple([z.number(), z.number()]);  // [lng, lat]
const RingSchema = z.array(PositionSchema).min(4);           // closed ring

export const GeoJsonPolygonSchema = z.object({
  type:        z.literal('Polygon'),
  coordinates: z.array(RingSchema).min(1),
});

export const GeoJsonFeatureSchema = z.object({
  type:       z.literal('Feature'),
  geometry:   GeoJsonPolygonSchema,
  properties: z.record(z.unknown()).optional(),
});

export const GeoJsonFeatureCollectionSchema = z.object({
  type:     z.literal('FeatureCollection'),
  features: z.array(GeoJsonFeatureSchema).min(1),
});

export type GeoJsonPolygon           = z.infer<typeof GeoJsonPolygonSchema>;
export type GeoJsonFeature           = z.infer<typeof GeoJsonFeatureSchema>;
export type GeoJsonFeatureCollection = z.infer<typeof GeoJsonFeatureCollectionSchema>;

// ---------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------

export const CreateFieldSchema = z.object({
  name:                 z.string().min(1).max(200),
  description:          z.string().max(1000).optional(),
  adm4_code:            z.string().min(1).max(20),
  water_source_type:    z.enum(['irrigated', 'rainfed', 'lowland']).default('irrigated'),
  area_hectares:        z.coerce.number().positive().optional(),
  operator_count_default: z.coerce.number().int().min(1).max(50).default(1),
  decision_cycle_mode:  z.enum(['normal', 'siaga']).default('normal'),
  is_source_depleted:   z.boolean().default(false),
  notes:                z.string().max(2000).optional(),
  assigned_file_name:   z.string().max(500).optional(),
  map_headers:          z.any().optional().nullable(),
  irrigation_edges:     z.array(z.any()).optional().nullable(),
  irrigation_nodes:     z.array(z.any()).optional().nullable(),
});

export const UpdateFieldSchema = CreateFieldSchema.partial();

export const DroughtStatusSchema = z.object({
  is_source_depleted: z.boolean(),
});

export const AssignUserFieldSchema = z.object({
  user_id:    z.string().uuid('user_id harus berupa UUID'),
  field_role: z.enum(['manager', 'operator', 'viewer']).default('operator'),
});

// ---------------------------------------------------------------------------
// Sub-block schemas
// ---------------------------------------------------------------------------

export const CreateSubBlockSchema = z.object({
  name:                  z.string().min(1).max(200),
  code:                  z.string().max(20).optional(),
  polygon_geom:          GeoJsonPolygonSchema,
  elevation_m:           z.coerce.number().optional(),
  elevation_calibration: z.coerce.number().optional(),
  soil_type:             z.string().max(100).optional(),
  display_order:         z.coerce.number().int().min(0).default(0),
  notes:                 z.string().max(2000).optional(),
});

export const UpdateSubBlockSchema = CreateSubBlockSchema.partial();

export const ImportSubBlocksSchema = z.object({
  geojson:     GeoJsonFeatureCollectionSchema,
  name_field:  z.string().default('name'),   // property key dalam GeoJSON features
  code_field:  z.string().optional(),
});

// ---------------------------------------------------------------------------
// Device schemas
// ---------------------------------------------------------------------------

export const CreateDeviceSchema = z.object({
  device_code:     z.string().min(1).max(100),
  device_type:     z.enum(['sensor', 'station', 'awd_water_level', 'weather_station', 'multi_sensor']).default('sensor'),
  connection_type: z.enum(['lorawan', 'nb_iot', 'gsm', 'wifi', 'manual']).default('lorawan'),
  hardware_model:  z.string().max(100).optional(),
  serial_number:   z.string().max(100).optional(),
  firmware_version:z.string().max(50).optional(),
  notes:           z.string().max(2000).optional(),
  coordinate:      z.record(z.any()).optional().nullable(),
  parent_station:  z.string().optional().nullable(),
});

export const UpdateDeviceSchema = CreateDeviceSchema.partial();

export const AssignDeviceSchema = z.object({
  sub_block_id: z.string().uuid('sub_block_id harus berupa UUID'),
  notes:        z.string().max(500).optional(),
});

export const CalibrateDeviceSchema = z.object({
  water_level_offset_cm:  z.coerce.number().optional().default(0),
  temperature_offset_c:   z.coerce.number().optional().default(0),
  humidity_offset_pct:    z.coerce.number().optional().default(0),
  valid_from:             z.string().datetime().optional(),
  valid_until:            z.string().datetime().optional(),
  calibration_method:     z.enum(['field_measurement', 'lab_calibration', 'manufacturer']).default('field_measurement'),
  reference_reading_cm:   z.coerce.number().optional(),
  notes:                  z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Flow path schemas
// ---------------------------------------------------------------------------

export const CreateFlowPathSchema = z.object({
  flow_type:             z.enum(['natural', 'pipe', 'canal', 'pump']).default('natural'),
  floyd_warshall_matrix: z.unknown().optional(),
  notes:                 z.string().max(500).optional(),
});

export const UpdateFlowPathSchema = CreateFlowPathSchema.partial();

// ---------------------------------------------------------------------------
// Crop cycle schemas
// ---------------------------------------------------------------------------

export const CreateCropCycleSchema = z.object({
  bucket_code:           z.enum(['early', 'medium_early', 'medium', 'medium_late', 'late']),
  variety_name:          z.string().max(200).optional(),
  rule_profile_id:       z.string().uuid().optional(),
  planting_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD'),
  expected_harvest_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes:                 z.string().max(2000).optional(),
});

export const UpdateCropCyclePhaseSchema = z.object({
  current_phase_code: z.enum([
    'land_prep', 'nursery', 'transplanting',
    'vegetative_early', 'vegetative_late',
    'reproductive', 'ripening', 'harvesting', 'harvested',
  ]),
  rule_profile_id: z.string().uuid().optional(),
  notes:           z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Rule profile schemas
// ---------------------------------------------------------------------------

export const CreateRuleProfileSchema = z.object({
  name:                    z.string().min(1).max(200),
  description:             z.string().max(1000).optional(),
  bucket_code:             z.string().min(1),
  phase_code:              z.string().min(1),
  awd_upper_target_cm:     z.coerce.number(),
  drought_alert_cm:        z.coerce.number().optional(),
  min_saturation_days:     z.coerce.number().int().min(0).default(1),
  rain_delay_mm:           z.coerce.number().min(0).default(10),
  priority_weight:         z.coerce.number().min(0).max(5).default(1),
  rainfed_modifier_pct:    z.coerce.number().default(0),
  target_confidence:       z.enum(['high', 'medium', 'low']).default('high'),
  is_default:              z.boolean().default(false),
});

export const UpdateRuleProfileSchema = CreateRuleProfileSchema.partial();

// ---------------------------------------------------------------------------
// Irrigation Point schemas
// ---------------------------------------------------------------------------

export const GeoJsonPointSchema = z.object({
  type:        z.literal('Point'),
  coordinates: z.tuple([z.number(), z.number()]),
});

export type GeoJsonPoint = z.infer<typeof GeoJsonPointSchema>;

export const CreateIrrigationPointSchema = z.object({
  point_type:       z.string().min(1).max(100),
  coordinate_point: GeoJsonPointSchema.optional(),
  elevation_m:      z.coerce.number().optional(),
  callibrated_elevation: z.coerce.number().optional(),
  name:             z.string().max(200).optional(),
  assigned_sub_blocks: z.array(z.string().uuid()).default([]),
});

export const UpdateIrrigationPointSchema = CreateIrrigationPointSchema.partial();

// ---------------------------------------------------------------------------
// Embankment schemas
// ---------------------------------------------------------------------------

export const CreateEmbankmentSchema = z.object({
  name:                 z.string().min(1).max(200),
  code:                 z.string().max(20).optional(),
  polygon_geom:         GeoJsonPolygonSchema,
  elevation_m:          z.coerce.number().optional(),
  soil_type:            z.string().max(100).optional(),
  display_order:        z.coerce.number().int().min(0).default(0),
  notes:                z.string().max(2000).optional(),
  connected_sub_blocks: z.array(z.string().uuid()).default([]),
});

export const UpdateEmbankmentSchema = CreateEmbankmentSchema.partial();

export const ImportEmbankmentSchema = z.object({
  geojson:     GeoJsonFeatureCollectionSchema,
  name_field:  z.string().default('name'),
  code_field:  z.string().optional(),
});
