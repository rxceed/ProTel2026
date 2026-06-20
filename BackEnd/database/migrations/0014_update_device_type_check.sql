ALTER TABLE mst.devices DROP CONSTRAINT IF EXISTS devices_device_type_check;
ALTER TABLE mst.devices ADD CONSTRAINT devices_device_type_check CHECK (device_type IN ('sensor', 'station', 'awd_water_level', 'weather_station', 'multi_sensor', 'soil_moisture'));
