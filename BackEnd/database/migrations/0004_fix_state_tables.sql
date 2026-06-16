-- ---------------------------------------------------------------------------
-- Migration: 0004_fix_state_tables
--
-- Memperbaiki ketidaksesuaian antara skema Drizzle ORM dengan DB fisik
-- untuk tabel trx.sub_block_states dan trx.sub_block_current_states.
--
-- Perubahan:
--   1. sub_block_states     : Kembalikan kolom estimated_from_sub_block_ids
--                             yang terhapus, tambahkan field_id (NOT NULL via backfill)
--   2. sub_block_current_states : Tambahkan field_id (NOT NULL via backfill)
--   3. Perbarui fungsi trigger sync_sub_block_current_state agar
--      menyertakan field_id dalam INSERT dan UPDATE.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- BAGIAN 1: trx.sub_block_states
-- ===========================================================================

-- 1a. Tambahkan kembali estimated_from_sub_block_ids yang sempat terhapus
ALTER TABLE trx.sub_block_states
  ADD COLUMN IF NOT EXISTS estimated_from_sub_block_ids UUID[];

-- 1b. Pastikan field_id ada (sudah ditambahkan oleh fix-db.js sebelumnya,
--     perintah ini aman dijalankan ulang karena menggunakan IF NOT EXISTS)
ALTER TABLE trx.sub_block_states
  ADD COLUMN IF NOT EXISTS field_id UUID;

-- 1c. Backfill field_id dari mst.sub_blocks untuk baris yang sudah ada
UPDATE trx.sub_block_states s
SET field_id = b.field_id
FROM mst.sub_blocks b
WHERE s.sub_block_id = b.id
  AND s.field_id IS NULL;

-- 1d. Hapus baris yang field_id-nya masih NULL (orphan data, tidak bisa diisi)
DELETE FROM trx.sub_block_states WHERE field_id IS NULL;

-- 1e. Terapkan NOT NULL setelah backfill selesai
ALTER TABLE trx.sub_block_states
  ALTER COLUMN field_id SET NOT NULL;

-- ===========================================================================
-- BAGIAN 2: trx.sub_block_current_states
-- ===========================================================================

-- 2a. Tambahkan field_id
ALTER TABLE trx.sub_block_current_states
  ADD COLUMN IF NOT EXISTS field_id UUID;

-- 2b. Backfill field_id dari mst.sub_blocks
UPDATE trx.sub_block_current_states cs
SET field_id = b.field_id
FROM mst.sub_blocks b
WHERE cs.sub_block_id = b.id
  AND cs.field_id IS NULL;

-- 2c. Hapus baris orphan
DELETE FROM trx.sub_block_current_states WHERE field_id IS NULL;

-- 2d. Terapkan NOT NULL
ALTER TABLE trx.sub_block_current_states
  ALTER COLUMN field_id SET NOT NULL;

-- ===========================================================================
-- BAGIAN 3: Perbarui Trigger sync_sub_block_current_state
--
-- Trigger lama dibuat di migration awal (0000_initial_schema.sql) dan
-- belum mencakup kolom field_id yang baru ditambahkan.
-- ===========================================================================

CREATE OR REPLACE FUNCTION sync_sub_block_current_state()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO trx.sub_block_current_states (
    sub_block_id, field_id, crop_cycle_id, state_time,
    water_level_cm, water_level_trend,
    state_source, freshness_status, last_observation_at, source_device_id,
    estimated_from_sub_block_ids, interpolation_confidence, updated_at
  ) VALUES (
    NEW.sub_block_id, NEW.field_id, NEW.crop_cycle_id, NEW.state_time,
    NEW.water_level_cm, NEW.water_level_trend,
    NEW.state_source, NEW.freshness_status,
    NEW.last_observation_at, NEW.source_device_id,
    NEW.estimated_from_sub_block_ids, NEW.interpolation_confidence, now()
  )
  ON CONFLICT (sub_block_id) DO UPDATE SET
    field_id                     = EXCLUDED.field_id,
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
  -- Hanya update jika data lebih baru (cegah overwrite out-of-order)
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
