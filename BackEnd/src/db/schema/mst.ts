import {
  pgSchema,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  numeric,
  jsonb,
  json,
} from 'drizzle-orm/pg-core';
import { geometryPoint, geometryPolygon } from '../geometry';

export const mst = pgSchema('mst');

// ---------------------------------------------------------------------------
// mst.rice_duration_buckets
// ---------------------------------------------------------------------------
export const riceDurationBuckets = mst.table('rice_duration_buckets', {
  bucketCode:  text('bucket_code').primaryKey(),
  label:       text('label').notNull(),
  hstMin:      integer('hst_min').notNull(),
  hstMax:      integer('hst_max').notNull(),
  description: text('description'),
  sortOrder:   integer('sort_order').notNull().default(0),
  isActive:    boolean('is_active').notNull().default(true),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// mst.growth_phases
// ---------------------------------------------------------------------------
export const growthPhases = mst.table('growth_phases', {
  phaseCode:    text('phase_code').primaryKey(),
  label:        text('label').notNull(),
  phaseOrder:   integer('phase_order').notNull(),
  description:  text('description'),
  isDssActive:  boolean('is_dss_active').notNull().default(true),
  isActive:     boolean('is_active').notNull().default(true),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// mst.users
// ---------------------------------------------------------------------------
export const users = mst.table('users', {
  id:           uuid('id').primaryKey().defaultRandom(),
  email:        text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName:     text('full_name').notNull(),
  systemRole:   text('system_role').notNull().default('operator'),
  isActive:     boolean('is_active').notNull().default(true),
  lastLoginAt:  timestamp('last_login_at', { withTimezone: true }),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// mst.fields
// ---------------------------------------------------------------------------
export const fields = mst.table('fields', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  name:                 text('name').notNull(),
  description:          text('description'),
  adm4Code:             text('adm4_code').notNull(),
  waterSourceType:      text('water_source_type').notNull().default('irrigated'),
  areaHectares:         numeric('area_hectares', { precision: 8, scale: 4 }),
  operatorCountDefault: integer('operator_count_default').notNull().default(1),
  decisionCycleMode:    text('decision_cycle_mode').notNull().default('normal'),
  isSourceDepleted:     boolean('is_source_depleted').notNull().default(false),
  isActive:             boolean('is_active').notNull().default(true),
  notes:                text('notes'),
  mapVisualUrl:         text('map_visual_url'),
  mapBounds:            jsonb('map_bounds'),
  mapHeaders:           jsonb('map_headers'),
  assignedFileName:     text('assigned_file_name'),
  irrigationEdges:      json('irrigation_edges'),
  irrigationNodes:      json('irrigation_nodes'),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// mst.user_fields
// ---------------------------------------------------------------------------
export const userFields = mst.table('user_fields', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  fieldId:   uuid('field_id').notNull().references(() => fields.id, { onDelete: 'cascade' }),
  fieldRole: text('field_role').notNull().default('operator'),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  grantedBy: uuid('granted_by').references(() => users.id),
});

// ---------------------------------------------------------------------------
// mst.sub_blocks
// ---------------------------------------------------------------------------
export const subBlocks = mst.table('sub_blocks', {
  id:           uuid('id').primaryKey().defaultRandom(),
  fieldId:      uuid('field_id').notNull().references(() => fields.id, { onDelete: 'restrict' }),
  name:         text('name').notNull(),
  code:         text('code'),
  // unique_code is GENERATED ALWAYS AS (COALESCE(code, 'nocode') || '_' || id) STORED in PostgreSQL.
  // Drizzle does not model generated columns natively; treat as read-only text.
  uniqueCode:   text('unique_code'),
  polygonGeom:  geometryPolygon('polygon_geom').notNull(),
  // Generated columns (read-only — PostgreSQL generates these dari polygonGeom)
  areaM2:       numeric('area_m2', { precision: 12, scale: 2 }),
  centroid:     geometryPoint('centroid'),
  elevationM:   numeric('elevation_m', { precision: 7, scale: 2 }),
  elevationCalibration: numeric('elevation_calibration', { precision: 7, scale: 2 }),
  soilType:     text('soil_type'),
  displayOrder: integer('display_order').notNull().default(0),
  isActive:     boolean('is_active').notNull().default(true),
  notes:        text('notes'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// mst.embankments  ← PEMATANG SAWAH (sub-block border / galengan)
// ---------------------------------------------------------------------------
export const embankments = mst.table('embankments', {
  id:           uuid('id').primaryKey().defaultRandom(),
  fieldId:      uuid('field_id').notNull().references(() => fields.id, { onDelete: 'restrict' }),
  name:         text('name').notNull(),
  // code is NOT unique — multiple embankments may share the same code across fields
  code:         text('code'),
  // unique_code is GENERATED ALWAYS AS (COALESCE(code, 'nocode') || '_' || id) STORED.
  // Drizzle does not model generated columns natively; treat as read-only text.
  uniqueCode:   text('unique_code'),
  polygonGeom:  geometryPolygon('polygon_geom').notNull(),
  areaM2:       numeric('area_m2', { precision: 12, scale: 2 }),
  centroid:     geometryPoint('centroid'),
  elevationM:   numeric('elevation_m', { precision: 7, scale: 2 }),
  soilType:     text('soil_type'),
  displayOrder: integer('display_order').notNull().default(0),
  isActive:     boolean('is_active').notNull().default(true),
  notes:        text('notes'),
  connectedSubBlocks: jsonb('connected_sub_blocks').$type<string[]>().notNull().default([]),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});


// ---------------------------------------------------------------------------
// mst.flow_paths
// ---------------------------------------------------------------------------
export const flowPaths = mst.table('flow_paths', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  fieldId:              uuid('field_id').notNull().references(() => fields.id, { onDelete: 'restrict' }),
  flowType:             text('flow_type').notNull().default('natural'),
  floydWarshallMatrix:  json('floyd_warshall_matrix'),
  isActive:             boolean('is_active').notNull().default(true),
  notes:                text('notes'),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// mst.irrigation_points
// ---------------------------------------------------------------------------
export const irrigationPoints = mst.table('irrigation_points', {
  id:               uuid('id').primaryKey().defaultRandom(),
  fieldId:          uuid('field_id').notNull().references(() => fields.id, { onDelete: 'restrict' }),
  pointType:        text('point_type').notNull(),
  coordinatePoint:  geometryPoint('coordinate_point'),
  elevationM:       numeric('elevation_m', { precision: 7, scale: 2 }),
  callibratedElevation: numeric('callibrated_elevation', { precision: 7, scale: 2 }),
  name:             text('name'),
  assignedSubBlocks: jsonb('assigned_sub_blocks').$type<string[]>().notNull().default([]),
});

// ---------------------------------------------------------------------------
// mst.devices
// ---------------------------------------------------------------------------
export const devices = mst.table('devices', {
  id:               uuid('id').primaryKey().defaultRandom(),
  deviceCode:       text('device_code').notNull().unique(),
  deviceType:       text('device_type').notNull().default('awd_water_level'),
  connectionType:   text('connection_type').notNull().default('lorawan'),
  hardwareModel:    text('hardware_model'),
  serialNumber:     text('serial_number'),
  firmwareVersion:  text('firmware_version'),
  fieldId:          uuid('field_id').notNull().references(() => fields.id, { onDelete: 'restrict' }),
  subBlockId:       uuid('sub_block_id').references(() => subBlocks.id, { onDelete: 'set null' }),
  status:           text('status').notNull().default('active'),
  batteryLevelPct:  numeric('battery_level_pct', { precision: 5, scale: 2 }),
  batteryUpdatedAt: timestamp('battery_updated_at', { withTimezone: true }),
  installedAt:      timestamp('installed_at', { withTimezone: true }),
  lastSeenAt:       timestamp('last_seen_at', { withTimezone: true }),
  notes:            text('notes'),
  topic:            text('topic').notNull().default(''),
  parentStation:    text('parent_station'),
  coordinate:       json('coordinate'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// mst.device_assignments
// ---------------------------------------------------------------------------
export const deviceAssignments = mst.table('device_assignments', {
  id:            uuid('id').primaryKey().defaultRandom(),
  deviceId:      uuid('device_id').notNull().references(() => devices.id, { onDelete: 'restrict' }),
  subBlockId:    uuid('sub_block_id').notNull().references(() => subBlocks.id, { onDelete: 'restrict' }),
  fieldId:       uuid('field_id').notNull().references(() => fields.id, { onDelete: 'restrict' }),
  assignedAt:    timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  unassignedAt:  timestamp('unassigned_at', { withTimezone: true }),
  assignedBy:    uuid('assigned_by').references(() => users.id),
  unassignedBy:  uuid('unassigned_by').references(() => users.id),
  notes:         text('notes'),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// mst.sensor_calibrations
// ---------------------------------------------------------------------------
export const sensorCalibrations = mst.table('sensor_calibrations', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  deviceId:            uuid('device_id').notNull().references(() => devices.id, { onDelete: 'restrict' }),
  validFrom:           timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
  validUntil:          timestamp('valid_until', { withTimezone: true }),
  waterLevelOffsetCm:  numeric('water_level_offset_cm', { precision: 6, scale: 2 }).notNull().default('0.00'),
  temperatureOffsetC:  numeric('temperature_offset_c', { precision: 4, scale: 2 }).notNull().default('0.00'),
  humidityOffsetPct:   numeric('humidity_offset_pct', { precision: 4, scale: 2 }).notNull().default('0.00'),
  calibrationMethod:   text('calibration_method').notNull().default('field_measurement'),
  referenceReadingCm:  numeric('reference_reading_cm', { precision: 7, scale: 2 }),
  // Jarak maksimum sensor ultrasonik (mm). Rumus: water_level_cm = (sensorMaxDistanceMm - d) / 10
  sensorMaxDistanceMm: integer('sensor_max_distance_mm').notNull().default(1400),
  calibratedBy:        uuid('calibrated_by').references(() => users.id),
  notes:               text('notes'),
  isActive:            boolean('is_active').notNull().default(true),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// mst.alert_configs
// ---------------------------------------------------------------------------
export const alertConfigs = mst.table('alert_configs', {
  id:             uuid('id').primaryKey().defaultRandom(),
  fieldId:        uuid('field_id').references(() => fields.id, { onDelete: 'cascade' }),
  subBlockId:     uuid('sub_block_id').references(() => subBlocks.id, { onDelete: 'cascade' }),
  alertType:      text('alert_type').notNull(),
  thresholdValue: numeric('threshold_value', { precision: 10, scale: 3 }).notNull(),
  thresholdUnit:  text('threshold_unit').notNull(),
  severity:       text('severity').notNull().default('warning'),
  cooldownMinutes:integer('cooldown_minutes').notNull().default(60),
  isEnabled:      boolean('is_enabled').notNull().default(true),
  createdBy:      uuid('created_by').references(() => users.id),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// mst.irrigation_rule_profiles
// ---------------------------------------------------------------------------
export const irrigationRuleProfiles = mst.table('irrigation_rule_profiles', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  name:                 text('name').notNull(),
  description:          text('description'),
  bucketCode:           text('bucket_code').notNull().references(() => riceDurationBuckets.bucketCode),
  phaseCode:            text('phase_code').notNull().references(() => growthPhases.phaseCode),
  awdUpperTargetCm:     numeric('awd_upper_target_cm', { precision: 6, scale: 2 }).notNull(),
  droughtAlertCm:       numeric('drought_alert_cm', { precision: 6, scale: 2 }),
  minSaturationDays:    integer('min_saturation_days').notNull().default(1),
  rainfedModifierPct:   numeric('rainfed_modifier_pct', { precision: 5, scale: 2 }).notNull().default('0.00'),
  priorityWeight:       numeric('priority_weight', { precision: 5, scale: 3 }).notNull().default('1.000'),
  rainDelayMm:          numeric('rain_delay_mm', { precision: 6, scale: 2 }).notNull().default('10.0'),
  targetConfidence:     text('target_confidence').notNull().default('high'),
  isDefault:            boolean('is_default').notNull().default(false),
  isActive:             boolean('is_active').notNull().default(true),
  createdBy:            uuid('created_by').references(() => users.id),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// mst.crop_cycles
// ---------------------------------------------------------------------------
export const cropCycles = mst.table('crop_cycles', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  subBlockId:          uuid('sub_block_id').notNull().references(() => subBlocks.id, { onDelete: 'restrict' }),
  fieldId:             uuid('field_id').notNull().references(() => fields.id, { onDelete: 'restrict' }),
  bucketCode:          text('bucket_code').notNull().references(() => riceDurationBuckets.bucketCode),
  varietyName:         text('variety_name'),
  ruleProfileId:       uuid('rule_profile_id').references(() => irrigationRuleProfiles.id, { onDelete: 'set null' }),
  plantingDate:        text('planting_date').notNull(), // DATE stored as text for simplicity
  expectedHarvestDate: text('expected_harvest_date'),
  actualHarvestDate:   text('actual_harvest_date'),
  currentPhaseCode:    text('current_phase_code').notNull().default('land_prep').references(() => growthPhases.phaseCode),
  currentHst:          integer('current_hst').notNull().default(0),
  status:              text('status').notNull().default('active'),
  completedAt:         timestamp('completed_at', { withTimezone: true }),
  notes:               text('notes'),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// mst.map_layers
// ---------------------------------------------------------------------------
export const mapLayers = mst.table('map_layers', {
  id:               uuid('id').primaryKey().defaultRandom(),
  fieldId:          uuid('field_id').notNull().references(() => fields.id, { onDelete: 'restrict' }),
  name:             text('name').notNull(),
  layerType:        text('layer_type').notNull().default('orthomosaic'),
  version:          integer('version').notNull().default(1),
  isActive:         boolean('is_active').notNull().default(false),
  displayOrder:     integer('display_order').notNull().default(0),
  rawStorageKey:    text('raw_storage_key'),
  cogStorageKey:    text('cog_storage_key'),
  fileSizeBytes:    integer('file_size_bytes'), // bigint → integer for drizzle simplicity
  pixelResolutionM: numeric('pixel_resolution_m', { precision: 8, scale: 4 }),
  captureDate:      text('capture_date'),
  uploadStatus:     text('upload_status').notNull().default('uploaded'),
  processingError:  text('processing_error'),
  uploadedBy:       uuid('uploaded_by').references(() => users.id),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// mst.system_settings
// ---------------------------------------------------------------------------
export const systemSettings = mst.table('system_settings', {
  id:                 text('id').primaryKey().default('global'),
  organizationName:   text('organization_name').notNull().default('Smart AWD Farm'),
  organizationLogo:   text('organization_logo'),
  measurementUnits:   text('measurement_units').notNull().default('metric'),
  cloudflareApiUrl:   text('cloudflare_api_url'),
  cloudflareApiKey:   text('cloudflare_api_key'),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
