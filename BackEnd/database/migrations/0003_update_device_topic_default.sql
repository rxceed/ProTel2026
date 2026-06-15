-- ---------------------------------------------------------------------------
-- Migration: 0003_update_device_topic_default
-- Updates the default topic format to topic_{device_code}_{serial_number}.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mst.set_device_topic()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.topic IS NULL OR NEW.topic = '' THEN
    NEW.topic := 'topic_' || NEW.device_code || '_' || COALESCE(NEW.serial_number, '');
  END IF;
  RETURN NEW;
END;
$$;
