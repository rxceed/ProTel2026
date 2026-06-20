CREATE OR REPLACE FUNCTION mst.set_device_topic()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.device_type = 'sensor' THEN
    NEW.topic := '';
  ELSIF NEW.topic IS NULL OR NEW.topic = '' THEN
    IF NEW.serial_number IS NULL OR NEW.serial_number = '' THEN
      NEW.topic := 'device/' || NEW.device_code;
    ELSE
      NEW.topic := 'device/' || NEW.device_code || '/' || NEW.serial_number;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Update existing sensor devices to have empty topic
UPDATE mst.devices
SET topic = ''
WHERE device_type = 'sensor';
