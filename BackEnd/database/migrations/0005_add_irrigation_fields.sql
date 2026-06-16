-- Alter tables to add new columns:
-- 1. Alter mst.devices: add coordinate (json)
-- 2. Alter mst.fields: add irrigation_edges (json) and irrigation_nodes (json)

ALTER TABLE mst.devices ADD COLUMN coordinate json;
ALTER TABLE mst.fields ADD COLUMN irrigation_edges json;
ALTER TABLE mst.fields ADD COLUMN irrigation_nodes json;
