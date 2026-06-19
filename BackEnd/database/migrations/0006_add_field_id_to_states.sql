-- 1. Add field_id column to trx.sub_block_states
ALTER TABLE trx.sub_block_states ADD COLUMN field_id UUID REFERENCES mst.fields(id);

-- 2. Populate field_id from sub_blocks
UPDATE trx.sub_block_states s
SET field_id = b.field_id
FROM mst.sub_blocks b
WHERE s.sub_block_id = b.id;

-- 3. Set NOT NULL on field_id
ALTER TABLE trx.sub_block_states ALTER COLUMN field_id SET NOT NULL;


-- 4. Add field_id column to trx.sub_block_current_states
ALTER TABLE trx.sub_block_current_states ADD COLUMN field_id UUID REFERENCES mst.fields(id);

-- 5. Populate field_id from sub_blocks
UPDATE trx.sub_block_current_states s
SET field_id = b.field_id
FROM mst.sub_blocks b
WHERE s.sub_block_id = b.id;

-- 6. Set NOT NULL on field_id
ALTER TABLE trx.sub_block_current_states ALTER COLUMN field_id SET NOT NULL;


-- 7. Update sync_sub_block_current_state() trigger function to support field_id
CREATE OR REPLACE FUNCTION sync_sub_block_current_state()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO trx.sub_block_current_states (
    sub_block_id, field_id, crop_cycle_id, state_time, water_level_cm, water_level_trend,
    state_source, freshness_status, last_observation_at, source_device_id,
    estimated_from_sub_block_ids, interpolation_confidence, updated_at
  ) VALUES (
    NEW.sub_block_id, NEW.field_id, NEW.crop_cycle_id, NEW.state_time, NEW.water_level_cm,
    NEW.water_level_trend, NEW.state_source, NEW.freshness_status,
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
  -- Only update if newer — prevent out-of-order overwrite
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
