-- =============================================================================
-- SMART AWD RICE MONITORING — DATABASE SCHEMA (v3 — Industry Grade)
-- PostgreSQL 16 + PostGIS + TimescaleDB
-- Docker image: timescale/timescaledb-ha:pg16-latest
-- =============================================================================
-- Schema layout:
--   mst   → master / reference data (users, devices, fields, sub_blocks, rules)
--   trx   → transactional / operational data (telemetry, states, recommendations)
--   sys   → system internals (scheduler, jobs, auth tokens, configs)
--   logs  → audit & observability (access, errors, activity, data changes)
--
-- v3 additions from v2:
--   [mst]  + sensor_calibrations   — IoT sensor calibration offsets
--   [mst]  + alert_configs         — configurable alert thresholds
--   [mst]  devices: improved IoT fields (status, connection_type, hw_model, etc.)
--   [mst]  irrigation_rule_profiles: fixed UNIQUE constraint (partial index)
--   [trx]  + sub_block_current_states — CQRS current-state table (auto-synced)
--   [trx]  + telemetry_alerts       — real-time threshold violation alerts
--   [trx]  + weather_warning_snapshots — BMKG peringatan dini (nowcast warnings)
--   [logs] + data_change_audit      — audit trail for critical master data changes
--   [sys]  triggers: current_state sync, publish history auto-record
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. EXTENSIONS
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- ---------------------------------------------------------------------------
-- 1. SCHEMAS
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS mst;
CREATE SCHEMA IF NOT EXISTS trx;
CREATE SCHEMA IF NOT EXISTS sys;
CREATE SCHEMA IF NOT EXISTS logs;

-- ---------------------------------------------------------------------------
-- 2. SHARED UTILITY FUNCTIONS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- SCHEMA: mst
-- Urutan: tabel tanpa FK lebih dulu (referensi → master → relasi)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- mst.rice_duration_buckets
-- ---------------------------------------------------------------------------
CREATE TABLE mst.rice_duration_buckets (
  bucket_code  TEXT        PRIMARY KEY,           -- 'early', 'medium_early', 'medium', 'late'
  label        TEXT        NOT NULL,              -- 'Early (70–80 HST)'
  hst_min      INTEGER     NOT NULL CHECK (hst_min > 0),
  hst_max      INTEGER     NOT NULL CHECK (hst_max > hst_min),
  description  TEXT,
  sort_order   INTEGER     NOT NULL DEFAULT 0,
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE mst.rice_duration_buckets IS
  'Referensi bucket durasi varietas padi. Label dan rentang HST saling berasosiasi (early=70-80, medium_early=90-100, dst).';

-- ---------------------------------------------------------------------------
-- mst.growth_phases
-- ---------------------------------------------------------------------------
CREATE TABLE mst.growth_phases (
  phase_code    TEXT        PRIMARY KEY,           -- 'vegetative_early', 'reproductive', dst.
  label         TEXT        NOT NULL,              -- label Indonesia
  phase_order   INTEGER     NOT NULL UNIQUE,       -- urutan kronologis
  description   TEXT,
  is_dss_active BOOLEAN     NOT NULL DEFAULT TRUE, -- apakah DSS AWD aktif di fase ini
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE mst.growth_phases IS
  'Referensi fase pertumbuhan padi (8 fase). is_dss_active=FALSE untuk land_prep, nursery, transplanting, harvested.';

-- ---------------------------------------------------------------------------
-- mst.users
-- ---------------------------------------------------------------------------
CREATE TABLE mst.users (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT        NOT NULL UNIQUE,
  password_hash   TEXT        NOT NULL,
  full_name       TEXT        NOT NULL,
  system_role     TEXT        NOT NULL DEFAULT 'operator'
                              CHECK (system_role IN ('system_admin', 'field_manager', 'operator')),
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE mst.users IS
  'Akun user sistem. system_role = role global; scope per-field di mst.user_fields.';
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON mst.users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- mst.fields
-- ---------------------------------------------------------------------------
CREATE TABLE mst.fields (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT        NOT NULL,
  description            TEXT,
  geom                   GEOMETRY(POLYGON, 4326),
  adm4_code              VARCHAR(20) NOT NULL,    -- kode kelurahan Kepmendagri 2022 → BMKG lookup
  water_source_type      TEXT        NOT NULL DEFAULT 'irrigated'
                                     CHECK (water_source_type IN ('irrigated', 'mixed', 'rainfed')),
  area_hectares          NUMERIC(8, 4),
  operator_count_default INTEGER     NOT NULL DEFAULT 1 CHECK (operator_count_default > 0),
  decision_cycle_mode    TEXT        NOT NULL DEFAULT 'normal'
                                     CHECK (decision_cycle_mode IN ('normal', 'siaga')),
                                     -- normal=60menit, siaga=30menit
  is_active              BOOLEAN     NOT NULL DEFAULT TRUE,
  notes                  TEXT,
  map_visual_url         TEXT,
  map_bounds             JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE mst.fields IS
  'Unit evaluasi DSS = satu field → satu adm4_code → satu konteks cuaca BMKG.';
COMMENT ON COLUMN mst.fields.adm4_code IS
  'Kode wilayah kelurahan/desa Kepmendagri No.100.1.1-6117/2022. Format: XX.XX.XX.XXXX';
COMMENT ON COLUMN mst.fields.decision_cycle_mode IS
  'normal=60 menit, siaga=30 menit. Dikunci per-field oleh field_manager/admin.';
CREATE TRIGGER trg_fields_updated_at BEFORE UPDATE ON mst.fields FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_fields_adm4_code ON mst.fields(adm4_code);
CREATE INDEX idx_fields_is_active  ON mst.fields(is_active) WHERE is_active = TRUE;

-- ---------------------------------------------------------------------------
-- mst.user_fields
-- ---------------------------------------------------------------------------
CREATE TABLE mst.user_fields (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES mst.users(id)  ON DELETE CASCADE,
  field_id    UUID        NOT NULL REFERENCES mst.fields(id) ON DELETE CASCADE,
  field_role  TEXT        NOT NULL DEFAULT 'operator'
              CHECK (field_role IN ('manager', 'operator', 'viewer')),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by  UUID             REFERENCES mst.users(id),
  UNIQUE (user_id, field_id)
);
COMMENT ON TABLE mst.user_fields IS
  'Mapping user ↔ field untuk RBAC. Akses ke field otomatis mencakup semua sub-block di dalamnya.';
CREATE INDEX idx_user_fields_user_id  ON mst.user_fields(user_id);
CREATE INDEX idx_user_fields_field_id ON mst.user_fields(field_id);

-- ---------------------------------------------------------------------------
-- mst.sub_blocks   ← KOTAK SAWAH
-- ---------------------------------------------------------------------------
CREATE TABLE mst.sub_blocks (
  id             UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id       UUID                    NOT NULL REFERENCES mst.fields(id) ON DELETE RESTRICT,
  name           TEXT                    NOT NULL,   -- 'Kotak A1'
  code           TEXT,                               -- kode singkat: 'A1'
  polygon_geom   GEOMETRY(POLYGON, 4326) NOT NULL,   -- polygon dari GeoJSON import
  area_m2        NUMERIC(12, 2)          GENERATED ALWAYS AS (ST_Area(polygon_geom::geography)) STORED,
  centroid       GEOMETRY(POINT, 4326)   GENERATED ALWAYS AS (ST_Centroid(polygon_geom)) STORED,
  elevation_m    NUMERIC(7, 2),                      -- elevasi rata-rata (opsional, dari DEM)
  soil_type      TEXT,                               -- jenis tanah misal 'clay', 'sandy_loam' (opsional Tahap 1)
  display_order  INTEGER                 NOT NULL DEFAULT 0,
  is_active      BOOLEAN                 NOT NULL DEFAULT TRUE,
  notes          TEXT,
  created_at     TIMESTAMPTZ             NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ             NOT NULL DEFAULT now(),
  UNIQUE (field_id, code)
);
COMMENT ON TABLE mst.sub_blocks IS
  'Unit keputusan & visualisasi (kotak sawah). Polygon dari GeoJSON import. area_m2 & centroid auto-generated dari PostGIS.';
CREATE TRIGGER trg_sub_blocks_updated_at BEFORE UPDATE ON mst.sub_blocks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_sub_blocks_field_id ON mst.sub_blocks(field_id);
CREATE INDEX idx_sub_blocks_geom     ON mst.sub_blocks USING GIST(polygon_geom);
CREATE INDEX idx_sub_blocks_centroid ON mst.sub_blocks USING GIST(centroid);

-- ---------------------------------------------------------------------------
-- mst.flow_paths
-- ---------------------------------------------------------------------------
CREATE TABLE mst.flow_paths (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  from_sub_block_id   UUID        NOT NULL REFERENCES mst.sub_blocks(id) ON DELETE RESTRICT,
  to_sub_block_id     UUID        NOT NULL REFERENCES mst.sub_blocks(id) ON DELETE RESTRICT,
  flow_type           TEXT        NOT NULL DEFAULT 'natural'
                                  CHECK (flow_type IN ('natural', 'gate_controlled', 'pump')),
  is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_sub_block_id, to_sub_block_id),
  CHECK  (from_sub_block_id <> to_sub_block_id)
);
COMMENT ON TABLE mst.flow_paths IS
  'Graf terarah aliran air antar kotak sawah. Dipakai DSS untuk command "alirkan dari A ke B".';
CREATE INDEX idx_flow_paths_from ON mst.flow_paths(from_sub_block_id);
CREATE INDEX idx_flow_paths_to   ON mst.flow_paths(to_sub_block_id);

-- ---------------------------------------------------------------------------
-- mst.devices   ← MASTER DEVICE SENSOR AWD
-- ---------------------------------------------------------------------------
CREATE TABLE mst.devices (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code       TEXT        NOT NULL UNIQUE,     -- identifier hardware unik (dari firmware)
  device_type       TEXT        NOT NULL DEFAULT 'awd_water_level'
                                CHECK (device_type IN ('awd_water_level', 'soil_moisture', 'weather_station')),
  connection_type   TEXT        NOT NULL DEFAULT 'lorawan'
                                CHECK (connection_type IN ('lorawan', 'nbiot', 'wifi', 'ethernet', 'bluetooth')),
  hardware_model    TEXT,                            -- e.g. 'ProTel AWD v2.1'
  serial_number     TEXT,                            -- serial nomor dari manufaktur
  firmware_version  TEXT,
  field_id          UUID        NOT NULL REFERENCES mst.fields(id)    ON DELETE RESTRICT,
  sub_block_id      UUID             REFERENCES mst.sub_blocks(id)    ON DELETE SET NULL,  -- assignment terkini (cache)
  status            TEXT        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'inactive', 'maintenance', 'decommissioned')),
  battery_level_pct NUMERIC(5, 2),                  -- last known battery (cache, diupdate saat telemetry masuk)
  battery_updated_at TIMESTAMPTZ,
  installed_at      TIMESTAMPTZ,
  last_seen_at      TIMESTAMPTZ,                     -- kapan terakhir kirim data (diupdate saat batch masuk)
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE mst.devices IS
  'Master device sensor AWD. status lebih granular dari boolean is_active. battery_level_pct = last known cache.';
COMMENT ON COLUMN mst.devices.status IS
  'active=beroperasi normal. inactive=nonaktif sementara. maintenance=dalam perawatan. decommissioned=tidak dipakai lagi.';
CREATE TRIGGER trg_devices_updated_at BEFORE UPDATE ON mst.devices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_devices_field_id     ON mst.devices(field_id);
CREATE INDEX idx_devices_sub_block_id ON mst.devices(sub_block_id);
CREATE INDEX idx_devices_status       ON mst.devices(status) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- mst.device_assignments
-- ---------------------------------------------------------------------------
CREATE TABLE mst.device_assignments (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id      UUID        NOT NULL REFERENCES mst.devices(id)    ON DELETE RESTRICT,
  sub_block_id   UUID        NOT NULL REFERENCES mst.sub_blocks(id) ON DELETE RESTRICT,
  field_id       UUID        NOT NULL REFERENCES mst.fields(id)     ON DELETE RESTRICT, -- denorm
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  unassigned_at  TIMESTAMPTZ,                        -- NULL = assignment masih aktif
  assigned_by    UUID             REFERENCES mst.users(id),
  unassigned_by  UUID             REFERENCES mst.users(id),
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE mst.device_assignments IS
  'Riwayat assignment device ke kotak sawah. unassigned_at IS NULL = assignment aktif.';
CREATE UNIQUE INDEX idx_device_assignments_active
  ON mst.device_assignments(device_id) WHERE unassigned_at IS NULL;
CREATE INDEX idx_device_assignments_device_id    ON mst.device_assignments(device_id);
CREATE INDEX idx_device_assignments_sub_block_id ON mst.device_assignments(sub_block_id);

CREATE OR REPLACE FUNCTION sync_device_current_assignment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.unassigned_at IS NULL THEN
    UPDATE mst.devices SET sub_block_id = NEW.sub_block_id WHERE id = NEW.device_id;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM mst.device_assignments
      WHERE device_id = NEW.device_id AND unassigned_at IS NULL AND id <> NEW.id
    ) THEN
      UPDATE mst.devices SET sub_block_id = NULL WHERE id = NEW.device_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_device_assignments_sync
  AFTER INSERT OR UPDATE ON mst.device_assignments
  FOR EACH ROW EXECUTE FUNCTION sync_device_current_assignment();

-- ---------------------------------------------------------------------------
-- mst.sensor_calibrations
-- ---------------------------------------------------------------------------
-- Koreksi offset per device. Sensor bisa drift seiring waktu.
-- Aplikasi menggunakan calibration aktif saat menormalisasi raw reading.

CREATE TABLE mst.sensor_calibrations (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id             UUID          NOT NULL REFERENCES mst.devices(id) ON DELETE RESTRICT,
  valid_from            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  valid_until           TIMESTAMPTZ,                -- NULL = masih berlaku
  -- Offset yang diterapkan ke raw reading (additive: corrected = raw + offset)
  water_level_offset_cm NUMERIC(6, 2) NOT NULL DEFAULT 0.0,
  temperature_offset_c  NUMERIC(4, 2) NOT NULL DEFAULT 0.0,
  humidity_offset_pct   NUMERIC(4, 2) NOT NULL DEFAULT 0.0,
  -- Metadata kalibrasi
  calibration_method    TEXT          NOT NULL DEFAULT 'field_measurement'
                                      CHECK (calibration_method IN (
                                        'field_measurement', 'lab_calibration',
                                        'manual_adjustment', 'factory_reset'
                                      )),
  reference_reading_cm  NUMERIC(7, 2),              -- referensi pengukuran lapangan untuk kalibrasi
  calibrated_by         UUID               REFERENCES mst.users(id),
  notes                 TEXT,
  is_active             BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);
COMMENT ON TABLE mst.sensor_calibrations IS
  'Offset kalibrasi per device per periode. corrected_value = raw_value + offset. Hanya satu active per device.';
CREATE UNIQUE INDEX idx_sensor_calibrations_active
  ON mst.sensor_calibrations(device_id) WHERE is_active = TRUE AND valid_until IS NULL;
CREATE INDEX idx_sensor_calibrations_device_id ON mst.sensor_calibrations(device_id);
CREATE INDEX idx_sensor_calibrations_valid
  ON mst.sensor_calibrations(device_id, valid_from, valid_until);

-- ---------------------------------------------------------------------------
-- mst.alert_configs
-- ---------------------------------------------------------------------------
-- Threshold konfigurasi untuk pembuatan alert otomatis.
-- Hierarki lookup: sub_block_id (paling spesifik) → field_id → NULL (global default)

CREATE TABLE mst.alert_configs (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id        UUID               REFERENCES mst.fields(id)     ON DELETE CASCADE,
  sub_block_id    UUID               REFERENCES mst.sub_blocks(id) ON DELETE CASCADE,
  alert_type      TEXT          NOT NULL
                                CHECK (alert_type IN (
                                  'water_critical_low',    -- water_level_cm di bawah threshold → segera irigasi
                                  'water_critical_high',   -- banjir / genangan berlebih
                                  'battery_low',           -- baterai device menipis
                                  'device_offline',        -- device tidak kirim data
                                  'sensor_stale'           -- data sensor sudah terlalu lama
                                )),
  threshold_value NUMERIC(10, 3) NOT NULL,           -- nilai threshold numerik
  threshold_unit  TEXT          NOT NULL,            -- 'cm', 'pct', 'hours'
  severity        TEXT          NOT NULL DEFAULT 'warning'
                                CHECK (severity IN ('info', 'warning', 'critical')),
  cooldown_minutes INTEGER      NOT NULL DEFAULT 60, -- jeda sebelum alert yang sama bisa di-generate lagi
  is_enabled      BOOLEAN       NOT NULL DEFAULT TRUE,
  created_by      UUID               REFERENCES mst.users(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);
COMMENT ON TABLE mst.alert_configs IS
  'Konfigurasi threshold alert per field atau per sub-block. Aplikasi menggunakan ini saat state builder berjalan.';
COMMENT ON COLUMN mst.alert_configs.cooldown_minutes IS
  'Jeda minimum (menit) sebelum alert dengan tipe yang sama bisa dibuat lagi untuk field/sub-block yang sama.';
CREATE TRIGGER trg_alert_configs_updated_at BEFORE UPDATE ON mst.alert_configs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_alert_configs_field_id     ON mst.alert_configs(field_id)     WHERE field_id IS NOT NULL;
CREATE INDEX idx_alert_configs_sub_block_id ON mst.alert_configs(sub_block_id) WHERE sub_block_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- mst.irrigation_rule_profiles
-- ---------------------------------------------------------------------------
CREATE TABLE mst.irrigation_rule_profiles (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT          NOT NULL,
  description            TEXT,
  bucket_code            TEXT          NOT NULL REFERENCES mst.rice_duration_buckets(bucket_code),
  phase_code             TEXT          NOT NULL REFERENCES mst.growth_phases(phase_code),
  -- Threshold AWD
  awd_lower_threshold_cm NUMERIC(6, 2) NOT NULL,  -- water level di bawah ini → perlu irigasi
  awd_upper_target_cm    NUMERIC(6, 2) NOT NULL,  -- target water level setelah irigasi
  drought_alert_cm       NUMERIC(6, 2),            -- level kritis → prioritas sangat tinggi
  -- Perilaku
  min_saturation_days    INTEGER       NOT NULL DEFAULT 1,
  rainfed_modifier_pct   NUMERIC(5, 2) NOT NULL DEFAULT 0.0,  -- penyesuaian threshold rainfed (%)
  -- DSS tuning
  priority_weight        NUMERIC(5, 3) NOT NULL DEFAULT 1.000,
  rain_delay_mm          NUMERIC(6, 2) NOT NULL DEFAULT 10.0, -- jika prakiraan hujan > N mm → tunda irigasi
  target_confidence      TEXT          NOT NULL DEFAULT 'high'
                                       CHECK (target_confidence IN ('high', 'medium', 'low')),
  is_default             BOOLEAN       NOT NULL DEFAULT FALSE,
  is_active              BOOLEAN       NOT NULL DEFAULT TRUE,
  created_by             UUID               REFERENCES mst.users(id),
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now()
  -- NOTE: tidak ada table-level UNIQUE (bucket_code, phase_code, is_default) karena salah
  -- Gunakan partial unique index di bawah untuk: hanya satu default per bucket+phase
);
COMMENT ON TABLE mst.irrigation_rule_profiles IS
  'Template rule DSS AWD. bucket_code & phase_code FK ke tabel referensi. Bisa ada banyak custom profile per bucket+phase, tapi hanya satu default.';
COMMENT ON COLUMN mst.irrigation_rule_profiles.rain_delay_mm IS
  'Jika field tp BMKG (precipitation_mm) > nilai ini, DSS menunda rekomendasi irigasi.';
CREATE TRIGGER trg_rule_profiles_updated_at BEFORE UPDATE ON mst.irrigation_rule_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- Hanya satu DEFAULT per kombinasi bucket+phase (partial unique index, bukan table constraint)
CREATE UNIQUE INDEX idx_rule_profiles_one_default
  ON mst.irrigation_rule_profiles(bucket_code, phase_code)
  WHERE is_default = TRUE AND is_active = TRUE;
CREATE INDEX idx_rule_profiles_bucket_phase ON mst.irrigation_rule_profiles(bucket_code, phase_code);

-- ---------------------------------------------------------------------------
-- mst.crop_cycles
-- ---------------------------------------------------------------------------
CREATE TABLE mst.crop_cycles (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_block_id          UUID        NOT NULL REFERENCES mst.sub_blocks(id) ON DELETE RESTRICT,
  field_id              UUID        NOT NULL REFERENCES mst.fields(id)     ON DELETE RESTRICT, -- denorm
  bucket_code           TEXT        NOT NULL REFERENCES mst.rice_duration_buckets(bucket_code),
  variety_name          TEXT,                -- nama varietas (info saja, bukan key rule engine)
  rule_profile_id       UUID             REFERENCES mst.irrigation_rule_profiles(id) ON DELETE SET NULL,
  planting_date         DATE        NOT NULL,
  expected_harvest_date DATE,
  actual_harvest_date   DATE,
  current_phase_code    TEXT        NOT NULL DEFAULT 'land_prep'
                                    REFERENCES mst.growth_phases(phase_code),
  current_hst           INTEGER     NOT NULL DEFAULT 0 CHECK (current_hst >= 0),
  status                TEXT        NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active', 'completed', 'cancelled')),
  completed_at          TIMESTAMPTZ,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE mst.crop_cycles IS
  'Siklus tanam per kotak sawah. Hanya satu active per sub-block (partial unique index).';
COMMENT ON COLUMN mst.crop_cycles.rule_profile_id IS
  'Profile yang dipakai DSS untuk fase SAAT INI. Diupdate saat fase bertambah atau admin memilih manual.';
CREATE TRIGGER trg_crop_cycles_updated_at BEFORE UPDATE ON mst.crop_cycles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE UNIQUE INDEX idx_crop_cycles_one_active
  ON mst.crop_cycles(sub_block_id) WHERE status = 'active';
CREATE INDEX idx_crop_cycles_sub_block_id ON mst.crop_cycles(sub_block_id);
CREATE INDEX idx_crop_cycles_field_id     ON mst.crop_cycles(field_id);
CREATE INDEX idx_crop_cycles_status       ON mst.crop_cycles(status);

-- ---------------------------------------------------------------------------
-- mst.map_layers
-- ---------------------------------------------------------------------------
CREATE TABLE mst.map_layers (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id             UUID        NOT NULL REFERENCES mst.fields(id) ON DELETE RESTRICT,
  name                 TEXT        NOT NULL,
  layer_type           TEXT        NOT NULL DEFAULT 'orthomosaic'
                                   CHECK (layer_type IN ('orthomosaic', 'ndvi', 'elevation')),
  version              INTEGER     NOT NULL DEFAULT 1,
  is_active            BOOLEAN     NOT NULL DEFAULT FALSE,
  raw_storage_key      TEXT,       -- R2 object key: GeoTIFF asli
  cog_storage_key      TEXT,       -- R2 object key: COG siap TiTiler
  file_size_bytes      BIGINT,
  bounds_geom          GEOMETRY(POLYGON, 4326),
  pixel_resolution_m   NUMERIC(8, 4),
  capture_date         DATE,
  upload_status        TEXT        NOT NULL DEFAULT 'uploaded'
                                   CHECK (upload_status IN ('uploaded', 'processing', 'ready', 'failed')),
  processing_error     TEXT,
  uploaded_by          UUID             REFERENCES mst.users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE mst.map_layers IS
  'Metadata layer peta. File fisik di Cloudflare R2. TiTiler serve dari cog_storage_key.';
CREATE TRIGGER trg_map_layers_updated_at BEFORE UPDATE ON mst.map_layers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE UNIQUE INDEX idx_map_layers_one_active
  ON mst.map_layers(field_id) WHERE is_active = TRUE;
CREATE INDEX idx_map_layers_field_id ON mst.map_layers(field_id);
CREATE INDEX idx_map_layers_geom     ON mst.map_layers USING GIST(bounds_geom);

-- =============================================================================
-- SCHEMA: sys — System Internals + Auth Tokens
-- =============================================================================

-- ---------------------------------------------------------------------------
-- sys.refresh_tokens
-- ---------------------------------------------------------------------------
CREATE TABLE sys.refresh_tokens (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES mst.users(id) ON DELETE CASCADE,
  token_hash   TEXT        NOT NULL UNIQUE,    -- SHA-256 dari raw token
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked      BOOLEAN     NOT NULL DEFAULT FALSE,
  revoked_at   TIMESTAMPTZ,
  ip_address   INET,
  device_info  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE sys.refresh_tokens IS
  'Hash refresh token JWT (SHA-256). Access token 15 menit stateless. Refresh token 7 hari di sini untuk revocation.';
CREATE INDEX idx_refresh_tokens_user_id    ON sys.refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON sys.refresh_tokens(expires_at) WHERE revoked = FALSE;

-- ---------------------------------------------------------------------------
-- sys.decision_jobs
-- ---------------------------------------------------------------------------
CREATE TABLE sys.decision_jobs (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id                  UUID        NOT NULL REFERENCES mst.fields(id) ON DELETE RESTRICT,
  triggered_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  trigger_source            TEXT        NOT NULL DEFAULT 'scheduler'
                                        CHECK (trigger_source IN ('scheduler', 'manual', 'alert')),
  cycle_mode                TEXT        NOT NULL DEFAULT 'normal'
                                        CHECK (cycle_mode IN ('normal', 'siaga')),
  status                    TEXT        NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  started_at                TIMESTAMPTZ,
  completed_at              TIMESTAMPTZ,
  duration_ms               INTEGER,
  attempt_count             INTEGER     NOT NULL DEFAULT 0,
  sub_blocks_evaluated      INTEGER     DEFAULT 0,
  recommendations_generated INTEGER     DEFAULT 0,
  error_message             TEXT,
  engine_version            TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE sys.decision_jobs IS
  'Log eksekusi decision cycle per field. Satu record per run, detail retry di sys.job_attempts.';
CREATE INDEX idx_decision_jobs_field_triggered ON sys.decision_jobs(field_id, triggered_at DESC);
CREATE INDEX idx_decision_jobs_status
  ON sys.decision_jobs(status) WHERE status IN ('pending', 'running');

-- ---------------------------------------------------------------------------
-- sys.job_attempts
-- ---------------------------------------------------------------------------
CREATE TABLE sys.job_attempts (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_job_id      UUID        NOT NULL REFERENCES sys.decision_jobs(id) ON DELETE CASCADE,
  attempt_number       INTEGER     NOT NULL,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at         TIMESTAMPTZ,
  status               TEXT        NOT NULL DEFAULT 'running'
                                   CHECK (status IN ('running', 'success', 'failed')),
  engine_request_json  JSONB,      -- payload yang dikirim ke FastAPI
  engine_response_json JSONB,      -- respons dari FastAPI (atau error)
  error_message        TEXT,
  http_status_code     INTEGER,
  response_time_ms     INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (decision_job_id, attempt_number)
);
COMMENT ON TABLE sys.job_attempts IS
  'Detail setiap percobaan eksekusi decision job untuk retry tracking.';
CREATE INDEX idx_job_attempts_decision_job ON sys.job_attempts(decision_job_id);

-- ---------------------------------------------------------------------------
-- sys.scheduler_state
-- ---------------------------------------------------------------------------
CREATE TABLE sys.scheduler_state (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type         TEXT        NOT NULL
                               CHECK (job_type IN (
                                 'bmkg_sync', 'bmkg_warning_sync',
                                 'decision_cycle', 'hst_updater',
                                 'stale_flag_updater', 'archive_runner'
                               )),
  field_id         UUID             REFERENCES mst.fields(id) ON DELETE CASCADE,
  last_run_at      TIMESTAMPTZ,
  next_expected_at TIMESTAMPTZ,
  last_run_status  TEXT        CHECK (last_run_status IN ('success', 'failed', 'running')),
  last_error       TEXT,
  run_count        INTEGER     NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_type, field_id)
);
COMMENT ON TABLE sys.scheduler_state IS
  'State node-cron per job type per field. Express baca ini saat startup untuk deteksi missed jobs.';
CREATE TRIGGER trg_scheduler_state_updated_at BEFORE UPDATE ON sys.scheduler_state FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- sys.archive_jobs
-- ---------------------------------------------------------------------------
CREATE TABLE sys.archive_jobs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type         TEXT        NOT NULL DEFAULT 'crop_cycle_archive'
                               CHECK (job_type IN ('crop_cycle_archive', 'telemetry_archive', 'log_archive')),
  crop_cycle_id    UUID             REFERENCES mst.crop_cycles(id) ON DELETE SET NULL,
  field_id         UUID             REFERENCES mst.fields(id)      ON DELETE SET NULL,
  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  triggered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  triggered_by     UUID             REFERENCES mst.users(id),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  rows_archived    INTEGER     DEFAULT 0,
  target_tables    TEXT[],
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE sys.archive_jobs IS
  'Tracking job arsip data. Data tidak dihapus, diarsipkan per crop cycle.';
CREATE INDEX idx_archive_jobs_status ON sys.archive_jobs(status) WHERE status IN ('pending', 'running');

-- ---------------------------------------------------------------------------
-- sys.engine_configs
-- ---------------------------------------------------------------------------
CREATE TABLE sys.engine_configs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key    TEXT        NOT NULL UNIQUE,
  config_value  JSONB       NOT NULL,
  description   TEXT,
  updated_by    UUID             REFERENCES mst.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_engine_configs_updated_at BEFORE UPDATE ON sys.engine_configs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- sys.integration_configs
-- ---------------------------------------------------------------------------
CREATE TABLE sys.integration_configs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_name      TEXT        NOT NULL UNIQUE
                                    CHECK (integration_name IN ('bmkg', 'cloudflare_r2', 'decision_engine')),
  is_enabled            BOOLEAN     NOT NULL DEFAULT TRUE,
  base_url              TEXT,
  sync_interval_minutes INTEGER,
  config_json           JSONB,
  last_success_at       TIMESTAMPTZ,
  last_error_at         TIMESTAMPTZ,
  last_error_msg        TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_integration_configs_updated_at BEFORE UPDATE ON sys.integration_configs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- SCHEMA: trx — Transactional / Operational Data
-- =============================================================================

-- ---------------------------------------------------------------------------
-- trx.telemetry_batches
-- ---------------------------------------------------------------------------
CREATE TABLE trx.telemetry_batches (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id           UUID        NOT NULL REFERENCES mst.fields(id) ON DELETE RESTRICT,
  gateway_code       TEXT,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  batch_size         INTEGER     NOT NULL DEFAULT 0,
  raw_payload        JSONB,
  processing_status  TEXT        NOT NULL DEFAULT 'received'
                                 CHECK (processing_status IN ('received', 'processing', 'processed', 'failed')),
  processing_error   TEXT,
  processed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE trx.telemetry_batches IS
  'Header mini-batch ingest dari gateway. raw_payload disimpan untuk audit.';
CREATE INDEX idx_telemetry_batches_field_id    ON trx.telemetry_batches(field_id);
CREATE INDEX idx_telemetry_batches_received_at ON trx.telemetry_batches(received_at DESC);
CREATE INDEX idx_telemetry_batches_pending
  ON trx.telemetry_batches(processing_status) WHERE processing_status IN ('received', 'processing');

-- ---------------------------------------------------------------------------
-- trx.raw_events
-- ---------------------------------------------------------------------------
CREATE TABLE trx.raw_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id         UUID        NOT NULL REFERENCES trx.telemetry_batches(id) ON DELETE RESTRICT,
  device_id        UUID             REFERENCES mst.devices(id) ON DELETE SET NULL,
  device_code      TEXT        NOT NULL,   -- denorm
  event_timestamp  TIMESTAMPTZ NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  seq_number       INTEGER,
  raw_data         JSONB       NOT NULL,
  is_processed     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE trx.raw_events IS
  'Payload mentah per device per event. Source of truth — tidak dimodifikasi setelah INSERT.';
CREATE INDEX idx_raw_events_batch_id        ON trx.raw_events(batch_id);
CREATE INDEX idx_raw_events_device_id       ON trx.raw_events(device_id);
CREATE INDEX idx_raw_events_event_timestamp ON trx.raw_events(event_timestamp DESC);
CREATE INDEX idx_raw_events_unprocessed     ON trx.raw_events(is_processed) WHERE is_processed = FALSE;

-- ---------------------------------------------------------------------------
-- trx.telemetry_records   ← DATA SENSOR TERNORMALISASI (TimescaleDB HYPERTABLE)
-- ---------------------------------------------------------------------------
CREATE TABLE trx.telemetry_records (
  id                    UUID          NOT NULL DEFAULT gen_random_uuid(),
  event_timestamp       TIMESTAMPTZ   NOT NULL,         -- kolom partisi hypertable
  device_id             UUID          NOT NULL REFERENCES mst.devices(id) ON DELETE RESTRICT,
  device_code           TEXT          NOT NULL,          -- denorm
  sub_block_id          UUID               REFERENCES mst.sub_blocks(id) ON DELETE SET NULL,
  raw_event_id          UUID,                            -- ref ke raw_events (bukan FK — limitasi hypertable)
  -- Normalized & calibrated readings
  water_level_cm        NUMERIC(7, 2),                  -- NEGATIF = di bawah permukaan (AWD mode)
  temperature_c         NUMERIC(5, 2),
  humidity_pct          NUMERIC(5, 2),
  battery_pct           NUMERIC(5, 2),
  signal_rssi           INTEGER,
  -- Kalibrasi applied
  calibration_id        UUID,                            -- ref ke mst.sensor_calibrations (bukan FK)
  water_level_raw_cm    NUMERIC(7, 2),                  -- raw sebelum kalibrasi (untuk audit)
  -- Validasi
  is_valid              BOOLEAN       NOT NULL DEFAULT TRUE,
  validation_notes      TEXT,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (id, event_timestamp)                      -- composite PK wajib TimescaleDB
);
COMMENT ON TABLE trx.telemetry_records IS
  'Data sensor ternormalisasi & terkalibrasi. TimescaleDB hypertable partisi per bulan. water_level_raw_cm = before calibration.';
COMMENT ON COLUMN trx.telemetry_records.water_level_cm IS
  'Level air terkalibrasi dalam cm. Negatif = di bawah permukaan tanah (AWD). Positif = tergenang.';

-- TimescaleDB hypertable (REMOVED FOR SUPABASE COMPATIBILITY)
-- SELECT create_hypertable('trx.telemetry_records', 'event_timestamp', ...);

CREATE INDEX idx_telemetry_records_device_time
  ON trx.telemetry_records(device_id, event_timestamp DESC);
CREATE INDEX idx_telemetry_records_sub_block_time
  ON trx.telemetry_records(sub_block_id, event_timestamp DESC) WHERE sub_block_id IS NOT NULL;
CREATE INDEX idx_telemetry_records_invalid
  ON trx.telemetry_records(device_id, event_timestamp DESC) WHERE is_valid = FALSE;

-- ---------------------------------------------------------------------------
-- trx.sub_block_states  (history — semua state yang pernah ada)
-- ---------------------------------------------------------------------------
CREATE TABLE trx.sub_block_states (
  id                            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_block_id                  UUID          NOT NULL REFERENCES mst.sub_blocks(id) ON DELETE RESTRICT,
  crop_cycle_id                 UUID               REFERENCES mst.crop_cycles(id)  ON DELETE SET NULL,
  state_time                    TIMESTAMPTZ   NOT NULL,
  water_level_cm                NUMERIC(7, 2),
  water_level_trend             TEXT          CHECK (water_level_trend IN ('rising', 'stable', 'falling')),
  state_source                  TEXT          NOT NULL DEFAULT 'no_data'
                                              CHECK (state_source IN ('observed', 'estimated', 'manual', 'no_data')),
  freshness_status              TEXT          NOT NULL DEFAULT 'no_data'
                                              CHECK (freshness_status IN ('fresh', 'stale', 'no_data')),
  last_observation_at           TIMESTAMPTZ,
  source_device_id              UUID               REFERENCES mst.devices(id) ON DELETE SET NULL,
  estimated_from_sub_block_ids  UUID[],
  interpolation_confidence      NUMERIC(3, 2) CHECK (interpolation_confidence BETWEEN 0 AND 1),
  created_at                    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
COMMENT ON TABLE trx.sub_block_states IS
  'History lengkap state per kotak sawah. Untuk current state query, gunakan trx.sub_block_current_states.';
CREATE INDEX idx_sub_block_states_sub_block_time
  ON trx.sub_block_states(sub_block_id, state_time DESC);
CREATE INDEX idx_sub_block_states_field_time
  ON trx.sub_block_states(state_time DESC);

-- ---------------------------------------------------------------------------
-- trx.sub_block_current_states  ← CQRS CURRENT-STATE TABLE
-- ---------------------------------------------------------------------------
-- Satu baris per sub-block. Auto-upserted via trigger saat trx.sub_block_states INSERT.
-- Dipakai decision engine untuk O(1) lookup current state.
-- TIDAK untuk query historis — gunakan trx.sub_block_states untuk itu.

CREATE TABLE trx.sub_block_current_states (
  sub_block_id                  UUID          PRIMARY KEY REFERENCES mst.sub_blocks(id) ON DELETE CASCADE,
  crop_cycle_id                 UUID               REFERENCES mst.crop_cycles(id) ON DELETE SET NULL,
  state_time                    TIMESTAMPTZ   NOT NULL,
  water_level_cm                NUMERIC(7, 2),
  water_level_trend             TEXT          CHECK (water_level_trend IN ('rising', 'stable', 'falling')),
  state_source                  TEXT          NOT NULL DEFAULT 'no_data'
                                              CHECK (state_source IN ('observed', 'estimated', 'manual', 'no_data')),
  freshness_status              TEXT          NOT NULL DEFAULT 'no_data'
                                              CHECK (freshness_status IN ('fresh', 'stale', 'no_data')),
  last_observation_at           TIMESTAMPTZ,
  source_device_id              UUID               REFERENCES mst.devices(id) ON DELETE SET NULL,
  estimated_from_sub_block_ids  UUID[],
  interpolation_confidence      NUMERIC(3, 2) CHECK (interpolation_confidence BETWEEN 0 AND 1),
  updated_at                    TIMESTAMPTZ   NOT NULL DEFAULT now()
);
COMMENT ON TABLE trx.sub_block_current_states IS
  'CQRS table: satu baris per kotak sawah, state terkini. Auto-sync dari trx.sub_block_states via trigger. O(1) lookup untuk decision engine.';

-- Trigger: setiap INSERT ke sub_block_states → UPSERT current state (hanya jika lebih baru)
CREATE OR REPLACE FUNCTION sync_sub_block_current_state()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO trx.sub_block_current_states (
    sub_block_id, crop_cycle_id, state_time, water_level_cm, water_level_trend,
    state_source, freshness_status, last_observation_at, source_device_id,
    estimated_from_sub_block_ids, interpolation_confidence, updated_at
  ) VALUES (
    NEW.sub_block_id, NEW.crop_cycle_id, NEW.state_time, NEW.water_level_cm,
    NEW.water_level_trend, NEW.state_source, NEW.freshness_status,
    NEW.last_observation_at, NEW.source_device_id,
    NEW.estimated_from_sub_block_ids, NEW.interpolation_confidence, now()
  )
  ON CONFLICT (sub_block_id) DO UPDATE SET
    crop_cycle_id                = EXCLUDED.crop_cycle_id,
    state_time                   = EXCLUDED.state_time,
    water_level_cm               = EXCLUDED.water_level_cm,
    water_level_trend            = EXCLUDED.water_level_trend,
    state_source                 = EXCLUDED.state_source,
    freshness_status             = EXCLUDED.freshness_status,
    last_observation_at          = EXCLUDED.last_observation_at,
    source_device_id             = EXCLUDED.source_device_id,
    estimated_from_sub_block_ids = EXCLUDED.estimated_from_sub_block_ids,
    interpolation_confidence     = EXCLUDED.interpolation_confidence,
    updated_at                   = now()
  WHERE EXCLUDED.state_time > trx.sub_block_current_states.state_time;
  -- Only update if newer — prevent out-of-order overwrite
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sub_block_states_sync_current
  AFTER INSERT ON trx.sub_block_states
  FOR EACH ROW EXECUTE FUNCTION sync_sub_block_current_state();

-- ---------------------------------------------------------------------------
-- trx.weather_forecast_snapshots   (prakiraan 3 hari dari BMKG)
-- ---------------------------------------------------------------------------
CREATE TABLE trx.weather_forecast_snapshots (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id             UUID        NOT NULL REFERENCES mst.fields(id) ON DELETE RESTRICT,
  adm4_code            VARCHAR(20) NOT NULL,
  fetched_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  analysis_date        TIMESTAMPTZ,
  forecast_valid_from  TIMESTAMPTZ NOT NULL,
  forecast_valid_until TIMESTAMPTZ NOT NULL,
  -- Ekstraksi field penting dari response BMKG
  temperature_c        NUMERIC(5, 2),
  humidity_pct         NUMERIC(5, 2),
  precipitation_mm     NUMERIC(7, 2),        -- field 'tp' BMKG (undocumented — handle null gracefully)
  cloud_cover_pct      NUMERIC(5, 2),         -- tcc
  wind_speed_kmh       NUMERIC(6, 2),         -- ws
  wind_direction       TEXT,                  -- wd
  weather_code         INTEGER,
  weather_desc         TEXT,
  bmkg_category        TEXT        CHECK (bmkg_category IN (
                                     'cerah', 'berawan', 'berawan_tebal',
                                     'hujan_ringan', 'hujan_sedang', 'hujan_lebat',
                                     'hujan_sangat_lebat', 'hujan_es', 'kabut', 'asap'
                                   )),
  full_response_json   JSONB,                 -- raw response BMKG untuk debugging
  is_stale             BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE trx.weather_forecast_snapshots IS
  'Cache prakiraan cuaca 3-hari BMKG per field. Sync tiap 3 jam. Berbeda dengan weather_warning_snapshots.';
CREATE INDEX idx_weather_snapshots_field_time ON trx.weather_forecast_snapshots(field_id, fetched_at DESC);
CREATE INDEX idx_weather_snapshots_fresh
  ON trx.weather_forecast_snapshots(field_id, fetched_at DESC) WHERE is_stale = FALSE;

-- ---------------------------------------------------------------------------
-- trx.weather_warning_snapshots   (peringatan dini / nowcast BMKG — terpisah)
-- ---------------------------------------------------------------------------
-- BMKG menyediakan dua endpoint berbeda:
--   /prakiraan → forecast 3 hari (di trx.weather_forecast_snapshots)
--   /peringatan → nowcast warning aktif (di tabel ini)
-- Warning langsung memengaruhi DSS: jika ada siaga banjir/kekeringan, decision engine harus adjust.

CREATE TABLE trx.weather_warning_snapshots (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id         UUID        NOT NULL REFERENCES mst.fields(id) ON DELETE RESTRICT,
  adm4_code        VARCHAR(20) NOT NULL,
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Detail warning
  warning_type     TEXT        CHECK (warning_type IN (
                                 'hujan_lebat', 'angin_kencang', 'banjir',
                                 'kekeringan', 'gelombang_tinggi', 'other'
                               )),
  warning_level    TEXT        CHECK (warning_level IN ('siaga', 'waspada', 'awas')),
  valid_from       TIMESTAMPTZ,
  valid_until      TIMESTAMPTZ,
  warning_text     TEXT,       -- teks peringatan dari BMKG
  -- DSS impact
  dss_action       TEXT        CHECK (dss_action IN (
                                 'none',           -- tidak ada dampak ke DSS
                                 'delay_irrigation', -- tunda irigasi (banjir)
                                 'prioritize_drainage', -- prioritaskan drainase
                                 'skip_cycle'       -- skip decision cycle
                               )) DEFAULT 'none',
  full_response_json JSONB,
  is_active        BOOLEAN     NOT NULL DEFAULT TRUE,  -- apakah warning masih berlaku
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE trx.weather_warning_snapshots IS
  'Peringatan dini BMKG (nowcast) per field. TERPISAH dari prakiraan 3-hari. dss_action menentukan dampak ke decision engine.';
COMMENT ON COLUMN trx.weather_warning_snapshots.dss_action IS
  'Dampak warning terhadap decision engine: none=tidak ada, delay_irrigation=tunda irigasi, dst.';
CREATE INDEX idx_weather_warnings_field_time  ON trx.weather_warning_snapshots(field_id, fetched_at DESC);
CREATE INDEX idx_weather_warnings_active
  ON trx.weather_warning_snapshots(field_id, valid_until) WHERE is_active = TRUE;

-- ---------------------------------------------------------------------------
-- trx.management_events
-- ---------------------------------------------------------------------------
CREATE TABLE trx.management_events (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id            UUID        NOT NULL REFERENCES mst.fields(id)     ON DELETE RESTRICT,
  sub_block_id        UUID             REFERENCES mst.sub_blocks(id)     ON DELETE SET NULL,
  crop_cycle_id       UUID             REFERENCES mst.crop_cycles(id)    ON DELETE SET NULL,
  event_type          TEXT        NOT NULL
                                  CHECK (event_type IN (
                                    'fertilizer', 'herbicide', 'insecticide', 'fungicide', 'pesticide',
                                    'manual_irrigation', 'pest_observation', 'disease_observation',
                                    'maintenance', 'other'
                                  )),
  event_date          DATE        NOT NULL,
  event_time          TIME,
  product_name        TEXT,
  dosage_notes        TEXT,
  attention_flag_text TEXT,       -- teks peringatan yang muncul di rekomendasi DSS
  flag_active_hours   INTEGER     NOT NULL DEFAULT 48,
  flag_expires_at     TIMESTAMPTZ NOT NULL,
  reported_by         UUID             REFERENCES mst.users(id),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE trx.management_events IS
  'Event budidaya dinamis. Menghasilkan attention_flag pada rekomendasi DSS. flag_expires_at auto-generated.';
CREATE TRIGGER trg_management_events_updated_at BEFORE UPDATE ON trx.management_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_mgmt_events_field_id     ON trx.management_events(field_id);
CREATE INDEX idx_mgmt_events_sub_block_id ON trx.management_events(sub_block_id);
CREATE INDEX idx_mgmt_events_active_flags
  ON trx.management_events(field_id, flag_expires_at);

-- ---------------------------------------------------------------------------
-- trx.telemetry_alerts   ← REAL-TIME THRESHOLD ALERTS
-- ---------------------------------------------------------------------------
-- Dibuat oleh state builder saat sensor reading melanggar threshold di mst.alert_configs.
-- Operator dapat acknowledge. Alert otomatis resolved saat kondisi normal kembali.

CREATE TABLE trx.telemetry_alerts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id          UUID        NOT NULL REFERENCES mst.fields(id)     ON DELETE RESTRICT,
  sub_block_id      UUID             REFERENCES mst.sub_blocks(id)     ON DELETE SET NULL,
  device_id         UUID             REFERENCES mst.devices(id)        ON DELETE SET NULL,
  alert_config_id   UUID             REFERENCES mst.alert_configs(id)  ON DELETE SET NULL,
  alert_type        TEXT        NOT NULL,   -- mirror dari alert_configs.alert_type
  severity          TEXT        NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  triggered_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  triggered_value   NUMERIC(10, 3),         -- nilai aktual yang memicu alert
  threshold_value   NUMERIC(10, 3),         -- nilai threshold yang dilanggar
  alert_message     TEXT        NOT NULL,   -- pesan singkat yang bisa langsung dibaca operator
  -- Lifecycle
  is_acknowledged   BOOLEAN     NOT NULL DEFAULT FALSE,
  acknowledged_at   TIMESTAMPTZ,
  acknowledged_by   UUID             REFERENCES mst.users(id),
  ack_notes         TEXT,
  resolved_at       TIMESTAMPTZ,            -- kapan kondisi kembali normal
  is_resolved       BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE trx.telemetry_alerts IS
  'Alert real-time dari threshold violation. Dibuat state builder, tidak harus menunggu decision cycle 60 menit.';
CREATE INDEX idx_telemetry_alerts_field_time ON trx.telemetry_alerts(field_id, triggered_at DESC);
CREATE INDEX idx_telemetry_alerts_open
  ON trx.telemetry_alerts(field_id, severity, triggered_at DESC)
  WHERE is_resolved = FALSE;               -- partial index untuk alert yang masih aktif
CREATE INDEX idx_telemetry_alerts_unacked
  ON trx.telemetry_alerts(field_id, triggered_at DESC)
  WHERE is_acknowledged = FALSE AND is_resolved = FALSE;

-- ---------------------------------------------------------------------------
-- trx.irrigation_recommendations
-- ---------------------------------------------------------------------------
CREATE TABLE trx.irrigation_recommendations (
  id                          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id                    UUID          NOT NULL REFERENCES mst.fields(id)     ON DELETE RESTRICT,
  sub_block_id                UUID          NOT NULL REFERENCES mst.sub_blocks(id) ON DELETE RESTRICT,
  crop_cycle_id               UUID               REFERENCES mst.crop_cycles(id)   ON DELETE SET NULL,
  decision_job_id             UUID               REFERENCES sys.decision_jobs(id) ON DELETE SET NULL,
  generated_at                TIMESTAMPTZ   NOT NULL DEFAULT now(),
  valid_until                 TIMESTAMPTZ   NOT NULL,
  -- Machine-readable output
  recommendation_type         TEXT          NOT NULL
                                            CHECK (recommendation_type IN (
                                              'irrigate', 'drain', 'maintain_wet',
                                              'maintain_dry', 'observe', 'skip_awd_event'
                                            )),
  priority_rank               INTEGER       NOT NULL,
  priority_score              NUMERIC(8, 4) NOT NULL,
  from_sub_block_id           UUID               REFERENCES mst.sub_blocks(id),
  to_sub_block_id             UUID               REFERENCES mst.sub_blocks(id),
  via_flow_path_id            UUID               REFERENCES mst.flow_paths(id),
  -- Human-readable output
  command_template_code       TEXT          NOT NULL,
  command_text                TEXT          NOT NULL,
  reason_summary              TEXT          NOT NULL,
  -- Warning overlay
  attention_flags_json        JSONB,
  operator_warning_text       TEXT,
  confidence_level            TEXT          NOT NULL DEFAULT 'high'
                                            CHECK (confidence_level IN ('high', 'medium', 'low')),
  -- Snapshot konteks saat keputusan (untuk audit & traceability)
  water_level_cm_at_decision  NUMERIC(7, 2),
  state_source_at_decision    TEXT,
  growth_phase_at_decision    TEXT,
  hst_at_decision             INTEGER,
  weather_context_json        JSONB,        -- snapshot BMKG yang dipakai DSS
  active_warnings_json        JSONB,        -- snapshot weather warnings yang aktif saat itu
  rule_profile_id             UUID               REFERENCES mst.irrigation_rule_profiles(id),
  -- Feedback
  feedback_status             TEXT          NOT NULL DEFAULT 'pending',
  operator_notes              TEXT,
  feedback_by                 UUID               REFERENCES mst.users(id),
  feedback_at                 TIMESTAMPTZ,
  -- Feedback summary cache (detail di trx.recommendation_feedback)
  has_feedback                BOOLEAN       NOT NULL DEFAULT FALSE,
  last_feedback_at            TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ   NOT NULL DEFAULT now()
);
COMMENT ON TABLE trx.irrigation_recommendations IS
  'Output DSS per kotak per cycle. active_warnings_json menyertakan snapshot peringatan cuaca aktif saat itu.';
CREATE INDEX idx_recommendations_field_generated    ON trx.irrigation_recommendations(field_id, generated_at DESC);
CREATE INDEX idx_recommendations_sub_block_valid    ON trx.irrigation_recommendations(sub_block_id, valid_until DESC);
CREATE INDEX idx_recommendations_active
  ON trx.irrigation_recommendations(field_id, valid_until);
CREATE INDEX idx_recommendations_decision_job
  ON trx.irrigation_recommendations(decision_job_id)        WHERE decision_job_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- trx.recommendation_feedback
-- ---------------------------------------------------------------------------
CREATE TABLE trx.recommendation_feedback (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id    UUID        NOT NULL REFERENCES trx.irrigation_recommendations(id) ON DELETE CASCADE,
  sub_block_id         UUID        NOT NULL REFERENCES mst.sub_blocks(id) ON DELETE RESTRICT,
  field_id             UUID        NOT NULL REFERENCES mst.fields(id)     ON DELETE RESTRICT,
  operator_action      TEXT        NOT NULL
                                   CHECK (operator_action IN (
                                     'executed', 'skipped', 'deferred', 'modified', 'overridden'
                                   )),
  actual_action_taken  TEXT,       -- deskripsi tindakan nyata jika berbeda dari rekomendasi
  operator_notes       TEXT,
  actioned_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actioned_by          UUID        NOT NULL REFERENCES mst.users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE trx.recommendation_feedback IS
  'Feedback operator per rekomendasi. Satu rekomendasi bisa punya beberapa feedback (revisi/update).';

CREATE OR REPLACE FUNCTION sync_recommendation_has_feedback()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE trx.irrigation_recommendations
  SET has_feedback = TRUE, last_feedback_at = now()
  WHERE id = NEW.recommendation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_recommendation_feedback_sync
  AFTER INSERT ON trx.recommendation_feedback
  FOR EACH ROW EXECUTE FUNCTION sync_recommendation_has_feedback();

CREATE INDEX idx_rec_feedback_recommendation ON trx.recommendation_feedback(recommendation_id);
CREATE INDEX idx_rec_feedback_actioned_by    ON trx.recommendation_feedback(actioned_by);

-- ---------------------------------------------------------------------------
-- trx.orthomosaic_uploads
-- ---------------------------------------------------------------------------
CREATE TABLE trx.orthomosaic_uploads (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id                UUID        NOT NULL REFERENCES mst.fields(id)    ON DELETE RESTRICT,
  map_layer_id            UUID             REFERENCES mst.map_layers(id)    ON DELETE SET NULL,
  original_filename       TEXT        NOT NULL,
  raw_storage_key         TEXT,
  cog_storage_key         TEXT,
  file_size_bytes         BIGINT,
  upload_status           TEXT        NOT NULL DEFAULT 'pending'
                                      CHECK (upload_status IN (
                                        'pending', 'uploading', 'uploaded',
                                        'processing', 'ready', 'failed'
                                      )),
  processing_started_at   TIMESTAMPTZ,
  processing_completed_at TIMESTAMPTZ,
  processing_error        TEXT,
  uploaded_by             UUID             REFERENCES mst.users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_ortho_uploads_updated_at BEFORE UPDATE ON trx.orthomosaic_uploads FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_ortho_uploads_field_id ON trx.orthomosaic_uploads(field_id);
CREATE INDEX idx_ortho_uploads_pending
  ON trx.orthomosaic_uploads(upload_status) WHERE upload_status IN ('pending', 'uploading', 'processing');

-- ---------------------------------------------------------------------------
-- trx.orthomosaic_publish_history
-- ---------------------------------------------------------------------------
CREATE TABLE trx.orthomosaic_publish_history (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  map_layer_id    UUID        NOT NULL REFERENCES mst.map_layers(id) ON DELETE CASCADE,
  field_id        UUID        NOT NULL REFERENCES mst.fields(id)     ON DELETE RESTRICT,
  published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  unpublished_at  TIMESTAMPTZ,
  published_by    UUID             REFERENCES mst.users(id),
  unpublished_by  UUID             REFERENCES mst.users(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE trx.orthomosaic_publish_history IS
  'Auto-recorded oleh trigger saat mst.map_layers.is_active berubah.';

CREATE OR REPLACE FUNCTION record_orthomosaic_publish_history()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_active = FALSE AND NEW.is_active = TRUE THEN
    INSERT INTO trx.orthomosaic_publish_history (map_layer_id, field_id, published_by)
    VALUES (NEW.id, NEW.field_id, NEW.uploaded_by);
    UPDATE trx.orthomosaic_publish_history
    SET unpublished_at = now()
    WHERE field_id = NEW.field_id AND map_layer_id <> NEW.id AND unpublished_at IS NULL;
  ELSIF OLD.is_active = TRUE AND NEW.is_active = FALSE THEN
    UPDATE trx.orthomosaic_publish_history
    SET unpublished_at = now()
    WHERE map_layer_id = NEW.id AND unpublished_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_map_layers_publish_history
  AFTER UPDATE OF is_active ON mst.map_layers
  FOR EACH ROW EXECUTE FUNCTION record_orthomosaic_publish_history();

CREATE INDEX idx_ortho_pub_field_time ON trx.orthomosaic_publish_history(field_id, published_at DESC);
CREATE INDEX idx_ortho_pub_active     ON trx.orthomosaic_publish_history(field_id) WHERE unpublished_at IS NULL;

-- =============================================================================
-- SCHEMA: logs — Audit & Observability
-- =============================================================================

CREATE TABLE logs.api_requests (
  id               BIGSERIAL   PRIMARY KEY,
  request_id       TEXT,
  user_id          UUID,
  method           TEXT        NOT NULL,
  path             TEXT        NOT NULL,
  query_params     JSONB,
  status_code      INTEGER,
  response_time_ms INTEGER,
  ip_address       INET,
  user_agent       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_api_requests_user_id    ON logs.api_requests(user_id)      WHERE user_id IS NOT NULL;
CREATE INDEX idx_api_requests_created_at ON logs.api_requests(created_at DESC);
CREATE INDEX idx_api_requests_errors     ON logs.api_requests(status_code, created_at DESC) WHERE status_code >= 400;

-- ---------------------------------------------------------------------------
CREATE TABLE logs.api_errors (
  id            BIGSERIAL   PRIMARY KEY,
  request_id    TEXT,
  user_id       UUID,
  path          TEXT,
  error_code    TEXT,
  error_message TEXT,
  stack_trace   TEXT,
  context_json  JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_api_errors_created_at ON logs.api_errors(created_at DESC);
CREATE INDEX idx_api_errors_error_code ON logs.api_errors(error_code);

-- ---------------------------------------------------------------------------
CREATE TABLE logs.engine_logs (
  id               BIGSERIAL   PRIMARY KEY,
  decision_job_id  UUID,
  field_id         UUID,
  log_level        TEXT        NOT NULL DEFAULT 'info'
                               CHECK (log_level IN ('debug', 'info', 'warning', 'error')),
  message          TEXT        NOT NULL,
  context_json     JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_engine_logs_job      ON logs.engine_logs(decision_job_id) WHERE decision_job_id IS NOT NULL;
CREATE INDEX idx_engine_logs_field    ON logs.engine_logs(field_id, log_level, created_at DESC);

-- ---------------------------------------------------------------------------
CREATE TABLE logs.integration_logs (
  id                BIGSERIAL   PRIMARY KEY,
  integration_name  TEXT        NOT NULL,
  action            TEXT        NOT NULL,
  status            TEXT        NOT NULL CHECK (status IN ('success', 'failed')),
  request_url       TEXT,
  response_status   INTEGER,
  response_time_ms  INTEGER,
  error_message     TEXT,
  context_json      JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_integration_logs_name_time ON logs.integration_logs(integration_name, created_at DESC);
CREATE INDEX idx_integration_logs_failed    ON logs.integration_logs(integration_name, created_at DESC) WHERE status = 'failed';

-- ---------------------------------------------------------------------------
CREATE TABLE logs.auth_logs (
  id          BIGSERIAL   PRIMARY KEY,
  user_id     UUID,
  event_type  TEXT        NOT NULL
              CHECK (event_type IN (
                'login', 'logout', 'refresh', 'failed_login',
                'token_revoked', 'password_change'
              )),
  success     BOOLEAN     NOT NULL,
  ip_address  INET,
  user_agent  TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auth_logs_user_id    ON logs.auth_logs(user_id)      WHERE user_id IS NOT NULL;
CREATE INDEX idx_auth_logs_created_at ON logs.auth_logs(created_at DESC);
CREATE INDEX idx_auth_logs_failed     ON logs.auth_logs(created_at DESC) WHERE success = FALSE;

-- ---------------------------------------------------------------------------
CREATE TABLE logs.user_activity_logs (
  id              BIGSERIAL   PRIMARY KEY,
  user_id         UUID        NOT NULL,
  field_id        UUID,
  action_type     TEXT        NOT NULL,
  resource_type   TEXT,
  resource_id     TEXT,
  details_json    JSONB,
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_activity_user_time  ON logs.user_activity_logs(user_id, created_at DESC);
CREATE INDEX idx_user_activity_field_time ON logs.user_activity_logs(field_id, created_at DESC) WHERE field_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- logs.data_change_audit
-- ---------------------------------------------------------------------------
-- Audit trail untuk perubahan master data yang kritis.
-- Siapa mengubah apa, kapan, dan nilai sebelum/sesudah.

CREATE TABLE logs.data_change_audit (
  id             BIGSERIAL   PRIMARY KEY,
  table_schema   TEXT        NOT NULL,             -- 'mst', 'sys'
  table_name     TEXT        NOT NULL,             -- nama tabel
  record_id      TEXT        NOT NULL,             -- UUID record sebagai TEXT
  operation      TEXT        NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  changed_by     UUID,                             -- user yang melakukan perubahan
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  old_values     JSONB,                            -- nilai sebelum (untuk UPDATE/DELETE)
  new_values     JSONB,                            -- nilai sesudah (untuk INSERT/UPDATE)
  change_reason  TEXT,                             -- alasan opsional (diisi aplikasi)
  request_id     TEXT                              -- correlation dengan logs.api_requests
);
COMMENT ON TABLE logs.data_change_audit IS
  'Audit trail perubahan master data kritis: rule profiles, crop cycles, device assignments, alert configs.';
CREATE INDEX idx_data_change_table_record ON logs.data_change_audit(table_schema, table_name, record_id);
CREATE INDEX idx_data_change_changed_by   ON logs.data_change_audit(changed_by, changed_at DESC) WHERE changed_by IS NOT NULL;
CREATE INDEX idx_data_change_changed_at   ON logs.data_change_audit(changed_at DESC);

-- =============================================================================
-- SEED DATA
-- =============================================================================

INSERT INTO mst.rice_duration_buckets (bucket_code, label, hst_min, hst_max, sort_order) VALUES
  ('early',        'Early (70–80 HST)',         70, 80,  1),
  ('medium_early', 'Medium Early (90–100 HST)', 90, 100, 2),
  ('medium',       'Medium (110–120 HST)',      110, 120, 3),
  ('late',         'Late (120–140 HST)',         120, 140, 4);

INSERT INTO mst.growth_phases (phase_code, label, phase_order, description, is_dss_active) VALUES
  ('land_prep',        'Persiapan Lahan',   1, 'Pengolahan tanah sebelum tanam. DSS belum relevan.',             FALSE),
  ('nursery',          'Persemaian',         2, 'Fase pembibitan/persemaian. DSS belum relevan.',                  FALSE),
  ('transplanting',    'Tanam / Tandur',     3, 'Transplanting bibit ke sawah. DSS belum relevan.',               FALSE),
  ('vegetative_early', 'Vegetatif Awal',     4, 'Fase awal pertumbuhan vegetatif. AWD mulai aktif.',             TRUE),
  ('vegetative_late',  'Vegetatif Lanjut',   5, 'Fase lanjut pertumbuhan vegetatif. AWD aktif penuh.',           TRUE),
  ('reproductive',     'Reproduktif',        6, 'Fase pembungaan/primordia. AWD lebih konservatif.',              TRUE),
  ('ripening',         'Pemasakan',          7, 'Fase pengisian dan pematangan gabah. AWD hati-hati.',            TRUE),
  ('harvested',        'Panen / Selesai',    8, 'Siklus tanam selesai. DSS tidak aktif.',                         FALSE);

INSERT INTO mst.irrigation_rule_profiles
  (name, bucket_code, phase_code, awd_lower_threshold_cm, awd_upper_target_cm,
   min_saturation_days, drought_alert_cm, priority_weight, rain_delay_mm, target_confidence, is_default)
VALUES
  -- EARLY (70–80 HST): 4 fase DSS aktif
  ('Early - Vegetatif Awal',          'early','vegetative_early', -15.0,  5.0, 2, -25.0, 1.00, 10.0, 'high',   TRUE),
  ('Early - Vegetatif Lanjut',        'early','vegetative_late',  -15.0,  5.0, 2, -25.0, 1.00, 10.0, 'high',   TRUE),
  ('Early - Reproduktif',             'early','reproductive',      -5.0, 10.0, 3, -12.0, 1.20,  5.0, 'high',   TRUE),
  ('Early - Pemasakan',               'early','ripening',          -5.0,  5.0, 1, -10.0, 0.80, 15.0, 'medium', TRUE),
  -- MEDIUM EARLY (90–100 HST)
  ('Medium Early - Vegetatif Awal',   'medium_early','vegetative_early', -18.0,  5.0, 2, -28.0, 1.00, 10.0, 'high',   TRUE),
  ('Medium Early - Vegetatif Lanjut', 'medium_early','vegetative_late',  -18.0,  5.0, 2, -28.0, 1.00, 10.0, 'high',   TRUE),
  ('Medium Early - Reproduktif',      'medium_early','reproductive',      -5.0, 10.0, 3, -13.0, 1.20,  5.0, 'high',   TRUE),
  ('Medium Early - Pemasakan',        'medium_early','ripening',          -5.0,  5.0, 1, -12.0, 0.80, 15.0, 'medium', TRUE),
  -- MEDIUM (110–120 HST)
  ('Medium - Vegetatif Awal',         'medium','vegetative_early', -20.0,  5.0, 2, -30.0, 1.00, 10.0, 'high',   TRUE),
  ('Medium - Vegetatif Lanjut',       'medium','vegetative_late',  -20.0,  5.0, 2, -30.0, 1.00, 10.0, 'high',   TRUE),
  ('Medium - Reproduktif',            'medium','reproductive',      -5.0, 10.0, 3, -15.0, 1.20,  5.0, 'high',   TRUE),
  ('Medium - Pemasakan',              'medium','ripening',          -5.0,  5.0, 1, -12.0, 0.80, 15.0, 'medium', TRUE),
  -- LATE (120–140 HST)
  ('Late - Vegetatif Awal',           'late','vegetative_early', -20.0,  5.0, 3, -35.0, 1.00, 10.0, 'high',   TRUE),
  ('Late - Vegetatif Lanjut',         'late','vegetative_late',  -20.0,  5.0, 3, -35.0, 1.00, 10.0, 'high',   TRUE),
  ('Late - Reproduktif',              'late','reproductive',      -5.0, 10.0, 3, -15.0, 1.20,  5.0, 'high',   TRUE),
  ('Late - Pemasakan',                'late','ripening',          -5.0,  5.0, 1, -12.0, 0.80, 15.0, 'medium', TRUE);

INSERT INTO sys.integration_configs (integration_name, is_enabled, base_url, sync_interval_minutes, config_json) VALUES
  ('bmkg',            TRUE, 'https://api.bmkg.go.id/publik', 180,  '{"rate_limit_per_minute":60,"forecast_days":3,"warning_sync_interval_minutes":60}'),
  ('cloudflare_r2',   TRUE, NULL,                             NULL, '{"max_upload_size_mb":400,"cog_bucket":"awd-orthomosaic"}'),
  ('decision_engine', TRUE, 'http://server2:8000',            NULL, '{"timeout_seconds":30,"max_retries":2,"version":"1.0"}');

INSERT INTO sys.engine_configs (config_key, config_value, description) VALUES
  ('decision_cycle_normal_minutes',   '60',        'Interval decision cycle mode normal (menit)'),
  ('decision_cycle_siaga_minutes',    '30',        'Interval decision cycle mode siaga (menit)'),
  ('telemetry_stale_threshold_hours', '2',         'Telemetry lebih dari N jam dianggap stale'),
  ('bmkg_forecast_stale_hours',       '6',         'Data prakiraan BMKG lebih dari N jam dianggap stale'),
  ('bmkg_warning_sync_minutes',       '60',        'Interval sync peringatan dini BMKG (menit)'),
  ('recommendation_valid_hours',      '2',         'Masa berlaku rekomendasi DSS (jam)'),
  ('max_estimation_hops',             '1',         'Maksimal hop estimasi state dari tetangga'),
  ('min_confidence_for_irrigate',     '"medium"',  'Minimum confidence untuk command irrigate'),
  ('alert_battery_low_pct',           '20',        'Threshold baterai device dianggap low (%)'),
  ('alert_device_offline_hours',      '2',         'Device dianggap offline jika tidak ada data N jam');

-- =============================================================================
-- RINGKASAN TABEL FINAL — v3 (41 tabel)
-- =============================================================================
-- Schema | #  | Tabel                          | Keterangan
-- -------|----|---------------------------------|--------------------------------
-- mst    | 01 | rice_duration_buckets           | Referensi bucket HST (4 bucket)
-- mst    | 02 | growth_phases                   | Referensi fase tanam (8 fase)
-- mst    | 03 | users                           | Akun user
-- mst    | 04 | user_fields                     | RBAC: user ↔ field
-- mst    | 05 | fields                          | Lahan / unit evaluasi DSS
-- mst    | 06 | sub_blocks                      | KOTAK SAWAH (unit keputusan)
-- mst    | 07 | flow_paths                      | Graf aliran air antar kotak
-- mst    | 08 | devices                         | Master sensor AWD
-- mst    | 09 | device_assignments              | Riwayat assignment device
-- mst    | 10 | sensor_calibrations             | Offset kalibrasi per device [NEW]
-- mst    | 11 | alert_configs                   | Konfigurasi threshold alert [NEW]
-- mst    | 12 | irrigation_rule_profiles        | Template rule DSS
-- mst    | 13 | crop_cycles                     | Siklus tanam per kotak
-- mst    | 14 | map_layers                      | Metadata orthomosaic
-- sys    | 15 | refresh_tokens                  | JWT refresh token hash
-- sys    | 16 | decision_jobs                   | Log eksekusi decision cycle
-- sys    | 17 | job_attempts                    | Retry tracking per job
-- sys    | 18 | scheduler_state                 | State node-cron
-- sys    | 19 | archive_jobs                    | Tracking arsip data
-- sys    | 20 | engine_configs                  | Config runtime DSS
-- sys    | 21 | integration_configs             | Config BMKG/R2/engine
-- trx    | 22 | telemetry_batches               | Header mini-batch ingest
-- trx    | 23 | raw_events                      | Payload mentah sensor
-- trx    | 24 | telemetry_records               | DATA SENSOR — hypertable
-- trx    | 25 | sub_block_states                | History state kotak sawah
-- trx    | 26 | sub_block_current_states        | CQRS current state (O(1)) [NEW]
-- trx    | 27 | weather_forecast_snapshots      | Cache prakiraan BMKG 3 hari
-- trx    | 28 | weather_warning_snapshots       | Peringatan dini BMKG [NEW]
-- trx    | 29 | management_events               | Event budidaya dinamis
-- trx    | 30 | telemetry_alerts                | Alert threshold violation [NEW]
-- trx    | 31 | irrigation_recommendations      | Output DSS
-- trx    | 32 | recommendation_feedback         | Feedback operator
-- trx    | 33 | orthomosaic_uploads             | Lifecycle upload GeoTIFF
-- trx    | 34 | orthomosaic_publish_history     | Riwayat publish/unpublish layer
-- logs   | 35 | api_requests                    | Access log API
-- logs   | 36 | api_errors                      | Error log
-- logs   | 37 | engine_logs                     | Log decision engine
-- logs   | 38 | integration_logs                | Log sync BMKG/R2
-- logs   | 39 | auth_logs                       | Login/logout/token log
-- logs   | 40 | user_activity_logs              | Aktivitas user di dashboard
-- logs   | 41 | data_change_audit               | Audit trail master data [NEW]
-- =============================================================================
-- Triggers (7 total):
--   trg_device_assignments_sync        → sync mst.devices.sub_block_id
--   trg_sub_block_states_sync_current  → upsert trx.sub_block_current_states
--   trg_recommendation_feedback_sync   → update has_feedback di recommendations
--   trg_map_layers_publish_history     → auto-record orthomosaic_publish_history
--   + set_updated_at triggers (semua tabel dengan updated_at)
-- =============================================================================
