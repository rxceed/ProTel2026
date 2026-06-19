import {
  pgSchema,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  numeric,
  jsonb,
  primaryKey,
} from 'drizzle-orm/pg-core';
import {
  devices,
  subBlocks,
  fields,
  cropCycles,
  irrigationRuleProfiles,
  flowPaths,
  users,
  mapLayers,
} from './mst';

export const sys = pgSchema('sys');
export const trx = pgSchema('trx');

// ---------------------------------------------------------------------------
// sys.refresh_tokens
// ---------------------------------------------------------------------------
export const refreshTokens = sys.table('refresh_tokens', {
  id:         uuid('id').primaryKey().defaultRandom(),
  userId:     uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash:  text('token_hash').notNull().unique(),
  issuedAt:   timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt:  timestamp('expires_at', { withTimezone: true }).notNull(),
  revoked:    boolean('revoked').notNull().default(false),
  revokedAt:  timestamp('revoked_at', { withTimezone: true }),
  ipAddress:  text('ip_address'),
  deviceInfo: text('device_info'),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// sys.decision_jobs
// ---------------------------------------------------------------------------
export const decisionJobs = sys.table('decision_jobs', {
  id:                      uuid('id').primaryKey().defaultRandom(),
  fieldId:                 uuid('field_id').notNull().references(() => fields.id, { onDelete: 'restrict' }),
  triggeredAt:             timestamp('triggered_at', { withTimezone: true }).notNull().defaultNow(),
  triggerSource:           text('trigger_source').notNull().default('scheduler'),
  cycleMode:               text('cycle_mode').notNull().default('normal'),
  status:                  text('status').notNull().default('pending'),
  startedAt:               timestamp('started_at', { withTimezone: true }),
  completedAt:             timestamp('completed_at', { withTimezone: true }),
  durationMs:              integer('duration_ms'),
  attemptCount:            integer('attempt_count').notNull().default(0),
  subBlocksEvaluated:      integer('sub_blocks_evaluated').default(0),
  recommendationsGenerated:integer('recommendations_generated').default(0),
  errorMessage:            text('error_message'),
  engineVersion:           text('engine_version'),
  createdAt:               timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// sys.job_attempts
// ---------------------------------------------------------------------------
export const jobAttempts = sys.table('job_attempts', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  decisionJobId:       uuid('decision_job_id').notNull().references(() => decisionJobs.id, { onDelete: 'cascade' }),
  attemptNumber:       integer('attempt_number').notNull(),
  startedAt:           timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt:         timestamp('completed_at', { withTimezone: true }),
  status:              text('status').notNull().default('running'),
  engineRequestJson:   jsonb('engine_request_json'),
  engineResponseJson:  jsonb('engine_response_json'),
  errorMessage:        text('error_message'),
  httpStatusCode:      integer('http_status_code'),
  responseTimeMs:      integer('response_time_ms'),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// sys.scheduler_state
// ---------------------------------------------------------------------------
export const schedulerState = sys.table('scheduler_state', {
  id:             uuid('id').primaryKey().defaultRandom(),
  jobType:        text('job_type').notNull(),
  fieldId:        uuid('field_id').references(() => fields.id, { onDelete: 'cascade' }),
  lastRunAt:      timestamp('last_run_at', { withTimezone: true }),
  nextExpectedAt: timestamp('next_expected_at', { withTimezone: true }),
  lastRunStatus:  text('last_run_status'),
  lastError:      text('last_error'),
  runCount:       integer('run_count').notNull().default(0),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// sys.archive_jobs
// ---------------------------------------------------------------------------
export const archiveJobs = sys.table('archive_jobs', {
  id:            uuid('id').primaryKey().defaultRandom(),
  jobType:       text('job_type').notNull().default('crop_cycle_archive'),
  cropCycleId:   uuid('crop_cycle_id').references(() => cropCycles.id, { onDelete: 'set null' }),
  fieldId:       uuid('field_id').references(() => fields.id, { onDelete: 'set null' }),
  status:        text('status').notNull().default('pending'),
  triggeredAt:   timestamp('triggered_at', { withTimezone: true }).notNull().defaultNow(),
  triggeredBy:   uuid('triggered_by').references(() => users.id),
  startedAt:     timestamp('started_at', { withTimezone: true }),
  completedAt:   timestamp('completed_at', { withTimezone: true }),
  rowsArchived:  integer('rows_archived').default(0),
  errorMessage:  text('error_message'),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// sys.engine_configs
// ---------------------------------------------------------------------------
export const engineConfigs = sys.table('engine_configs', {
  id:          uuid('id').primaryKey().defaultRandom(),
  configKey:   text('config_key').notNull().unique(),
  configValue: jsonb('config_value').notNull(),
  description: text('description'),
  updatedBy:   uuid('updated_by').references(() => users.id),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// sys.integration_configs
// ---------------------------------------------------------------------------
export const integrationConfigs = sys.table('integration_configs', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  integrationName:    text('integration_name').notNull().unique(),
  isEnabled:          boolean('is_enabled').notNull().default(true),
  baseUrl:            text('base_url'),
  syncIntervalMinutes:integer('sync_interval_minutes'),
  configJson:         jsonb('config_json'),
  lastSuccessAt:      timestamp('last_success_at', { withTimezone: true }),
  lastErrorAt:        timestamp('last_error_at', { withTimezone: true }),
  lastErrorMsg:       text('last_error_msg'),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===========================================================================
// SCHEMA: trx
// ===========================================================================

// ---------------------------------------------------------------------------
// trx.telemetry_batches
// ---------------------------------------------------------------------------
export const telemetryBatches = trx.table('telemetry_batches', {
  id:               uuid('id').primaryKey().defaultRandom(),
  fieldId:          uuid('field_id').notNull().references(() => fields.id, { onDelete: 'restrict' }),
  gatewayCode:      text('gateway_code'),
  receivedAt:       timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  batchSize:        integer('batch_size').notNull().default(0),
  rawPayload:       jsonb('raw_payload'),
  processingStatus: text('processing_status').notNull().default('received'),
  processingError:  text('processing_error'),
  processedAt:      timestamp('processed_at', { withTimezone: true }),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// trx.raw_events
// ---------------------------------------------------------------------------
export const rawEvents = trx.table('raw_events', {
  id:             uuid('id').primaryKey().defaultRandom(),
  batchId:        uuid('batch_id').notNull().references(() => telemetryBatches.id, { onDelete: 'restrict' }),
  deviceId:       uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
  deviceCode:     text('device_code').notNull(),
  eventTimestamp: timestamp('event_timestamp', { withTimezone: true }).notNull(),
  receivedAt:     timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  seqNumber:      integer('seq_number'),
  rawData:        jsonb('raw_data').notNull(),
  isProcessed:    boolean('is_processed').notNull().default(false),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// trx.telemetry_records — TimescaleDB HYPERTABLE
// Composite PK (id, event_timestamp) required by TimescaleDB
// ---------------------------------------------------------------------------
export const telemetryRecords = trx.table(
  'telemetry_records',
  {
    id:               uuid('id').notNull().defaultRandom(),
    eventTimestamp:   timestamp('event_timestamp', { withTimezone: true }).notNull(),
    deviceId:         uuid('device_id').notNull().references(() => devices.id, { onDelete: 'restrict' }),
    deviceCode:       text('device_code').notNull(),
    subBlockId:       uuid('sub_block_id').references(() => subBlocks.id, { onDelete: 'set null' }),
    rawEventId:       uuid('raw_event_id'), // no FK — hypertable limitation
    // Normalized readings (calibrated)
    waterLevelCm:     numeric('water_level_cm', { precision: 7, scale: 2 }),
    temperatureC:     numeric('temperature_c', { precision: 5, scale: 2 }),
    humidityPct:      numeric('humidity_pct', { precision: 5, scale: 2 }),
    batteryPct:       numeric('battery_pct', { precision: 5, scale: 2 }),
    signalRssi:       integer('signal_rssi'),
    calibrationId:    uuid('calibration_id'),
    waterLevelRawCm:  numeric('water_level_raw_cm', { precision: 7, scale: 2 }),
    isValid:          boolean('is_valid').notNull().default(true),
    validationNotes:  text('validation_notes'),
    createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id, table.eventTimestamp] }),
  }),
);

// ---------------------------------------------------------------------------
// trx.sub_block_states   (history)
// ---------------------------------------------------------------------------
export const subBlockStates = trx.table('sub_block_states', {
  id:                          uuid('id').primaryKey().defaultRandom(),
  subBlockId:                  uuid('sub_block_id').notNull().references(() => subBlocks.id, { onDelete: 'restrict' }),
  fieldId:                     uuid('field_id').notNull().references(() => fields.id, { onDelete: 'restrict' }),
  cropCycleId:                 uuid('crop_cycle_id').references(() => cropCycles.id, { onDelete: 'set null' }),
  stateTime:                   timestamp('state_time', { withTimezone: true }).notNull(),
  waterLevelCm:                numeric('water_level_cm', { precision: 7, scale: 2 }),
  waterLevelTrend:             text('water_level_trend'),
  stateSource:                 text('state_source').notNull().default('no_data'),
  freshnessStatus:             text('freshness_status').notNull().default('no_data'),
  lastObservationAt:           timestamp('last_observation_at', { withTimezone: true }),
  sourceDeviceId:              uuid('source_device_id').references(() => devices.id, { onDelete: 'set null' }),
  // Array UUID dari sub-block tetangga yang dipakai untuk estimasi (audit trail DSS)
  estimatedFromSubBlockIds:    uuid('estimated_from_sub_block_ids').array(),
  interpolationConfidence:     numeric('interpolation_confidence', { precision: 3, scale: 2 }),
  createdAt:                   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// trx.sub_block_current_states   (CQRS — satu baris per sub-block)
// ---------------------------------------------------------------------------
export const subBlockCurrentStates = trx.table('sub_block_current_states', {
  subBlockId:                  uuid('sub_block_id').primaryKey().references(() => subBlocks.id, { onDelete: 'cascade' }),
  fieldId:                     uuid('field_id').notNull().references(() => fields.id, { onDelete: 'restrict' }),
  cropCycleId:                 uuid('crop_cycle_id').references(() => cropCycles.id, { onDelete: 'set null' }),
  stateTime:                   timestamp('state_time', { withTimezone: true }).notNull(),
  waterLevelCm:                numeric('water_level_cm', { precision: 7, scale: 2 }),
  waterLevelTrend:             text('water_level_trend'),
  stateSource:                 text('state_source').notNull().default('no_data'),
  freshnessStatus:             text('freshness_status').notNull().default('no_data'),
  lastObservationAt:           timestamp('last_observation_at', { withTimezone: true }),
  sourceDeviceId:              uuid('source_device_id').references(() => devices.id, { onDelete: 'set null' }),
  // Array UUID dari sub-block tetangga yang dipakai untuk estimasi (audit trail DSS)
  estimatedFromSubBlockIds:    uuid('estimated_from_sub_block_ids').array(),
  interpolationConfidence:     numeric('interpolation_confidence', { precision: 3, scale: 2 }),
  updatedAt:                   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// trx.weather_forecast_snapshots
// ---------------------------------------------------------------------------
export const weatherForecastSnapshots = trx.table('weather_forecast_snapshots', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  fieldId:            uuid('field_id').notNull().references(() => fields.id, { onDelete: 'restrict' }),
  adm4Code:           text('adm4_code').notNull(),
  fetchedAt:          timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  analysisDate:       timestamp('analysis_date', { withTimezone: true }),
  forecastValidFrom:  timestamp('forecast_valid_from', { withTimezone: true }).notNull(),
  forecastValidUntil: timestamp('forecast_valid_until', { withTimezone: true }).notNull(),
  temperatureC:       numeric('temperature_c', { precision: 5, scale: 2 }),
  humidityPct:        numeric('humidity_pct', { precision: 5, scale: 2 }),
  precipitationMm:    numeric('precipitation_mm', { precision: 7, scale: 2 }),
  cloudCoverPct:      numeric('cloud_cover_pct', { precision: 5, scale: 2 }),
  windSpeedKmh:       numeric('wind_speed_kmh', { precision: 6, scale: 2 }),
  windDirection:      text('wind_direction'),
  weatherCode:        integer('weather_code'),
  weatherDesc:        text('weather_desc'),
  bmkgCategory:       text('bmkg_category'),
  fullResponseJson:   jsonb('full_response_json'),
  isLatest:           boolean('is_latest').notNull().default(true),
  isStale:            boolean('is_stale').notNull().default(false),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// trx.weather_warning_snapshots
// ---------------------------------------------------------------------------
export const weatherWarningSnapshots = trx.table('weather_warning_snapshots', {
  id:               uuid('id').primaryKey().defaultRandom(),
  fieldId:          uuid('field_id').notNull().references(() => fields.id, { onDelete: 'restrict' }),
  adm4Code:         text('adm4_code').notNull(),
  fetchedAt:        timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  warningType:      text('warning_type'),
  warningLevel:     text('warning_level'),
  validFrom:        timestamp('valid_from', { withTimezone: true }),
  warningExpiresAt: timestamp('warning_expires_at', { withTimezone: true }),
  warningText:      text('warning_text'),
  dssAction:        text('dss_action').default('none'),
  fullResponseJson: jsonb('full_response_json'),
  isActive:         boolean('is_active').notNull().default(true),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// trx.management_events
// ---------------------------------------------------------------------------
export const managementEvents = trx.table('management_events', {
  id:                uuid('id').primaryKey().defaultRandom(),
  fieldId:           uuid('field_id').notNull().references(() => fields.id, { onDelete: 'restrict' }),
  subBlockId:        uuid('sub_block_id').references(() => subBlocks.id, { onDelete: 'set null' }),
  cropCycleId:       uuid('crop_cycle_id').references(() => cropCycles.id, { onDelete: 'set null' }),
  eventType:         text('event_type').notNull(),
  eventDate:         text('event_date').notNull(),
  eventTime:         text('event_time'),
  productName:       text('product_name'),
  dosageNotes:       text('dosage_notes'),
  attentionFlagText: text('attention_flag_text'),
  flagActiveHours:   integer('flag_active_hours').notNull().default(48),
  // flag_expires_at is a GENERATED column in PG — read-only
  flagExpiresAt:     timestamp('flag_expires_at', { withTimezone: true }),
  reportedBy:        uuid('reported_by').references(() => users.id),
  notes:             text('notes'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// trx.telemetry_alerts
// ---------------------------------------------------------------------------
export const telemetryAlerts = trx.table('telemetry_alerts', {
  id:              uuid('id').primaryKey().defaultRandom(),
  fieldId:         uuid('field_id').notNull().references(() => fields.id, { onDelete: 'restrict' }),
  subBlockId:      uuid('sub_block_id').references(() => subBlocks.id, { onDelete: 'set null' }),
  deviceId:        uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
  alertType:       text('alert_type').notNull(),
  severity:        text('severity').notNull(),
  triggeredAt:     timestamp('triggered_at', { withTimezone: true }).notNull().defaultNow(),
  triggeredValue:  numeric('triggered_value', { precision: 10, scale: 3 }),
  thresholdValue:  numeric('threshold_value', { precision: 10, scale: 3 }),
  alertMessage:    text('alert_message').notNull(),
  isAcknowledged:  boolean('is_acknowledged').notNull().default(false),
  acknowledgedAt:  timestamp('acknowledged_at', { withTimezone: true }),
  acknowledgedBy:  uuid('acknowledged_by').references(() => users.id),
  ackNotes:        text('ack_notes'),
  resolvedAt:      timestamp('resolved_at', { withTimezone: true }),
  isResolved:      boolean('is_resolved').notNull().default(false),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// trx.irrigation_recommendations
// ---------------------------------------------------------------------------
export const irrigationRecommendations = trx.table('irrigation_recommendations', {
  id:                        uuid('id').primaryKey().defaultRandom(),
  fieldId:                   uuid('field_id').notNull().references(() => fields.id, { onDelete: 'restrict' }),
  subBlockId:                uuid('sub_block_id').notNull().references(() => subBlocks.id, { onDelete: 'restrict' }),
  cropCycleId:               uuid('crop_cycle_id').references(() => cropCycles.id, { onDelete: 'set null' }),
  decisionJobId:             uuid('decision_job_id').references(() => decisionJobs.id, { onDelete: 'set null' }),
  generatedAt:               timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  validUntil:                timestamp('valid_until', { withTimezone: true }).notNull(),
  recommendationType:        text('recommendation_type').notNull(),
  priorityRank:              integer('priority_rank').notNull(),
  priorityScore:             numeric('priority_score', { precision: 8, scale: 4 }).notNull(),
  fromSubBlockId:            uuid('from_sub_block_id').references(() => subBlocks.id),
  toSubBlockId:              uuid('to_sub_block_id').references(() => subBlocks.id),
  viaFlowPathId:             uuid('via_flow_path_id').references(() => flowPaths.id),
  commandTemplateCode:       text('command_template_code').notNull(),
  commandText:               text('command_text').notNull(),
  reasonSummary:             text('reason_summary').notNull(),
  attentionFlagsJson:        jsonb('attention_flags_json'),
  operatorWarningText:       text('operator_warning_text'),
  confidenceLevel:           text('confidence_level').notNull().default('high'),
  waterLevelCmAtDecision:    numeric('water_level_cm_at_decision', { precision: 7, scale: 2 }),
  stateSourceAtDecision:     text('state_source_at_decision'),
  growthPhaseAtDecision:     text('growth_phase_at_decision'),
  hstAtDecision:             integer('hst_at_decision'),
  weatherContextJson:        jsonb('weather_context_json'),
  activeWarningsJson:        jsonb('active_warnings_json'),
  ruleProfileId:             uuid('rule_profile_id').references(() => irrigationRuleProfiles.id),
  feedbackStatus:            text('feedback_status').notNull().default('pending'),
  operatorNotes:             text('operator_notes'),
  feedbackBy:                uuid('feedback_by').references(() => users.id),
  feedbackAt:                timestamp('feedback_at', { withTimezone: true }),
  hasFeedback:               boolean('has_feedback').notNull().default(false),
  lastFeedbackAt:            timestamp('last_feedback_at', { withTimezone: true }),
  engineVersion:             text('engine_version'),
  // Floyd-Warshall routing enrichment
  routePathIds:              jsonb('route_path_ids'),          // UUID[] sub_block berurutan source→target
  routingScore:              numeric('routing_score', { precision: 10, scale: 4 }), // total bobot rute
  createdAt:                 timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// trx.recommendation_feedback
// ---------------------------------------------------------------------------
export const recommendationFeedback = trx.table('recommendation_feedback', {
  id:                uuid('id').primaryKey().defaultRandom(),
  recommendationId:  uuid('recommendation_id').notNull().references(() => irrigationRecommendations.id, { onDelete: 'cascade' }),
  subBlockId:        uuid('sub_block_id').notNull().references(() => subBlocks.id, { onDelete: 'restrict' }),
  fieldId:           uuid('field_id').notNull().references(() => fields.id, { onDelete: 'restrict' }),
  operatorAction:    text('operator_action').notNull(),
  actualActionTaken: text('actual_action_taken'),
  operatorNotes:     text('operator_notes'),
  actionedAt:        timestamp('actioned_at', { withTimezone: true }).notNull().defaultNow(),
  actionedBy:        uuid('actioned_by').notNull().references(() => users.id),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// trx.orthomosaic_uploads
// ---------------------------------------------------------------------------
export const orthomosaicUploads = trx.table('orthomosaic_uploads', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  fieldId:               uuid('field_id').notNull().references(() => fields.id, { onDelete: 'restrict' }),
  mapLayerId:            uuid('map_layer_id').references(() => mapLayers.id, { onDelete: 'set null' }),
  originalFilename:      text('original_filename').notNull(),
  rawStorageKey:         text('raw_storage_key'),
  cogStorageKey:         text('cog_storage_key'),
  fileSizeBytes:         integer('file_size_bytes'),
  uploadStatus:          text('upload_status').notNull().default('pending'),
  processingStartedAt:   timestamp('processing_started_at', { withTimezone: true }),
  processingCompletedAt: timestamp('processing_completed_at', { withTimezone: true }),
  processingError:       text('processing_error'),
  uploadedBy:            uuid('uploaded_by').references(() => users.id),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// trx.orthomosaic_publish_history
// ---------------------------------------------------------------------------
export const orthomosaicPublishHistory = trx.table('orthomosaic_publish_history', {
  id:            uuid('id').primaryKey().defaultRandom(),
  mapLayerId:    uuid('map_layer_id').notNull().references(() => mapLayers.id, { onDelete: 'cascade' }),
  fieldId:       uuid('field_id').notNull().references(() => fields.id, { onDelete: 'restrict' }),
  publishedAt:   timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  unpublishedAt: timestamp('unpublished_at', { withTimezone: true }),
  publishedBy:   uuid('published_by').references(() => users.id),
  unpublishedBy: uuid('unpublished_by').references(() => users.id),
  notes:         text('notes'),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// trx.dss_tasks
// ---------------------------------------------------------------------------
export const dssTasks = trx.table('dss_tasks', {
  id:             uuid('id').primaryKey().defaultRandom(),
  fieldId:        uuid('field_id').notNull().references(() => fields.id, { onDelete: 'restrict' }),
  subBlockId:     uuid('sub_block_id').references(() => subBlocks.id, { onDelete: 'set null' }),
  taskType:       text('task_type').notNull(),
  commandText:    text('command_text').notNull(),
  reason:         text('reason'),
  priorityScore:  numeric('priority_score', { precision: 3, scale: 2 }), // 0.00 to 1.00
  status:         text('status').notNull().default('PENDING'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt:    timestamp('completed_at', { withTimezone: true }),
  completedBy:    uuid('completed_by').references(() => users.id, { onDelete: 'set null' }),
});
