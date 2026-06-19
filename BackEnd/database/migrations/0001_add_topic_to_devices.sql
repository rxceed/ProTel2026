-- ---------------------------------------------------------------------------
-- Migration: 0001_add_topic_to_devices
-- Adds topic TEXT NOT NULL column to mst.devices.
-- Default value pattern: 'topic_' || id (set via trigger on INSERT).
-- ---------------------------------------------------------------------------

-- Step 1: Add the column as nullable temporarily to allow back-fill
ALTER TABLE mst.devices
  ADD COLUMN IF NOT EXISTS topic TEXT;

-- Step 2: Back-fill existing rows with 'topic_' || id
UPDATE mst.devices
  SET topic = 'topic_' || id::TEXT;

-- Step 3: Apply NOT NULL constraint now that all rows have a value
ALTER TABLE mst.devices
  ALTER COLUMN topic SET NOT NULL;

-- Step 4: Create a trigger function to auto-set topic on INSERT if not provided
CREATE OR REPLACE FUNCTION mst.set_device_topic()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.topic IS NULL OR NEW.topic = '' THEN
    NEW.topic := 'topic_' || NEW.id::TEXT;
  END IF;
  RETURN NEW;
END;
$$;

-- Step 5: Attach the trigger to mst.devices
DROP TRIGGER IF EXISTS trg_devices_set_topic ON mst.devices;
CREATE TRIGGER trg_devices_set_topic
  BEFORE INSERT ON mst.devices
  FOR EACH ROW EXECUTE FUNCTION mst.set_device_topic();
