import {
  pgSchema,
  bigserial,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
} from 'drizzle-orm/pg-core';

export const logs = pgSchema('logs');

// ---------------------------------------------------------------------------
// logs.api_requests
// ---------------------------------------------------------------------------
export const apiRequests = logs.table('api_requests', {
  id:            bigserial('id', { mode: 'number' }).primaryKey(),
  requestId:     text('request_id'),
  userId:        uuid('user_id'),
  method:        text('method').notNull(),
  path:          text('path').notNull(),
  queryParams:   jsonb('query_params'),
  statusCode:    integer('status_code'),
  responseTimeMs:integer('response_time_ms'),
  ipAddress:     text('ip_address'),
  userAgent:     text('user_agent'),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// logs.api_errors
// ---------------------------------------------------------------------------
export const apiErrors = logs.table('api_errors', {
  id:           bigserial('id', { mode: 'number' }).primaryKey(),
  requestId:    text('request_id'),
  userId:       uuid('user_id'),
  path:         text('path'),
  errorCode:    text('error_code'),
  errorMessage: text('error_message'),
  stackTrace:   text('stack_trace'),
  contextJson:  jsonb('context_json'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// logs.engine_logs
// ---------------------------------------------------------------------------
export const engineLogs = logs.table('engine_logs', {
  id:            bigserial('id', { mode: 'number' }).primaryKey(),
  decisionJobId: uuid('decision_job_id'),
  fieldId:       uuid('field_id'),
  logLevel:      text('log_level').notNull().default('info'),
  message:       text('message').notNull(),
  contextJson:   jsonb('context_json'),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// logs.integration_logs
// ---------------------------------------------------------------------------
export const integrationLogs = logs.table('integration_logs', {
  id:              bigserial('id', { mode: 'number' }).primaryKey(),
  integrationName: text('integration_name').notNull(),
  action:          text('action').notNull(),
  status:          text('status').notNull(),
  requestUrl:      text('request_url'),
  responseStatus:  integer('response_status'),
  responseTimeMs:  integer('response_time_ms'),
  errorMessage:    text('error_message'),
  contextJson:     jsonb('context_json'),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// logs.auth_logs
// ---------------------------------------------------------------------------
export const authLogs = logs.table('auth_logs', {
  id:        bigserial('id', { mode: 'number' }).primaryKey(),
  userId:    uuid('user_id'),
  eventType: text('event_type').notNull(),
  success:   boolean('success').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  notes:     text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// logs.user_activity_logs
// ---------------------------------------------------------------------------
export const userActivityLogs = logs.table('user_activity_logs', {
  id:           bigserial('id', { mode: 'number' }).primaryKey(),
  userId:       uuid('user_id').notNull(),
  fieldId:      uuid('field_id'),
  actionType:   text('action_type').notNull(),
  resourceType: text('resource_type'),
  resourceId:   text('resource_id'),
  detailsJson:  jsonb('details_json'),
  ipAddress:    text('ip_address'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// logs.data_change_audit
// ---------------------------------------------------------------------------
export const dataChangeAudit = logs.table('data_change_audit', {
  id:          bigserial('id', { mode: 'number' }).primaryKey(),
  tableSchema: text('table_schema').notNull(),
  tableName:   text('table_name').notNull(),
  recordId:    text('record_id').notNull(),
  operation:   text('operation').notNull(),
  changedBy:   uuid('changed_by'),
  changedAt:   timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  oldValues:   jsonb('old_values'),
  newValues:   jsonb('new_values'),
  changeReason:text('change_reason'),
  requestId:   text('request_id'),
});
