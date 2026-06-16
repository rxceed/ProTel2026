-- Migration: 0004_irrigation_points_flow_paths_alter
-- Creates mst.irrigation_points table and alters mst.flow_paths:
--   - remove from_sub_block_id, to_sub_block_id columns (and their FK constraints)
--   - add field_id (FK to mst.fields) and floyd_warshall_matrix (json)

BEGIN;

-- ============================================================
-- 1. ALTER mst.flow_paths
-- ============================================================

-- Drop FK constraints on from_sub_block_id and to_sub_block_id first
-- (constraint names come from the initial schema; adjust if different)
ALTER TABLE mst.flow_paths
  DROP CONSTRAINT IF EXISTS flow_paths_from_sub_block_id_sub_blocks_id_fk;

ALTER TABLE mst.flow_paths
  DROP CONSTRAINT IF EXISTS flow_paths_to_sub_block_id_sub_blocks_id_fk;

-- Drop the columns
ALTER TABLE mst.flow_paths
  DROP COLUMN IF EXISTS from_sub_block_id;

ALTER TABLE mst.flow_paths
  DROP COLUMN IF EXISTS to_sub_block_id;

-- Add field_id column with FK to mst.fields
ALTER TABLE mst.flow_paths
  ADD COLUMN IF NOT EXISTS field_id uuid NOT NULL DEFAULT gen_random_uuid()
    REFERENCES mst.fields(id) ON DELETE RESTRICT;

-- Remove the placeholder default after backfill (field_id must be set manually for existing rows if any)
ALTER TABLE mst.flow_paths
  ALTER COLUMN field_id DROP DEFAULT;

-- Add floyd_warshall_matrix column
ALTER TABLE mst.flow_paths
  ADD COLUMN IF NOT EXISTS floyd_warshall_matrix json;

-- ============================================================
-- 2. CREATE mst.irrigation_points
-- ============================================================

CREATE TABLE IF NOT EXISTS mst.irrigation_points (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id          uuid        NOT NULL REFERENCES mst.fields(id) ON DELETE RESTRICT,
  point_type        text        NOT NULL,
  coordinate_point  text,
  elevation_m       numeric(7, 2)
);

COMMIT;
