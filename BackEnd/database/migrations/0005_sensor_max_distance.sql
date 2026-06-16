-- ---------------------------------------------------------------------------
-- Migration: 0005_sensor_max_distance
--
-- Menambahkan kolom sensor_max_distance_mm ke mst.sensor_calibrations.
-- Kolom ini menyimpan jarak maksimum sensor ultrasonik dalam mm (default: 1400mm = 140cm).
-- Rumus konversi: water_level_cm = (sensor_max_distance_mm - d) / 10
-- Dapat dikonfigurasi per sensor dari panel admin tanpa mengubah kode.
-- ---------------------------------------------------------------------------

ALTER TABLE mst.sensor_calibrations
  ADD COLUMN IF NOT EXISTS sensor_max_distance_mm INTEGER NOT NULL DEFAULT 1400;

COMMENT ON COLUMN mst.sensor_calibrations.sensor_max_distance_mm
  IS 'Jarak maksimum sensor ultrasonik dalam mm. Rumus: water_level_cm = (sensor_max_distance_mm - d) / 10. Default 1400mm (140cm).';
