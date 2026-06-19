-- ---------------------------------------------------------------------------
-- Migration: 0006_routing_enrichment
--
-- Menambahkan 2 kolom ke trx.irrigation_recommendations untuk menyimpan
-- hasil routing air dari algoritma Floyd-Warshall (gis-processing).
--
-- route_path_ids : Array UUID sub_block berurutan dari source (DRAIN) ke
--                  target (IRRIGATE). Null jika bukan rekomendasi IRRIGATE
--                  atau jika routing tidak berhasil menemukan jalur.
--                  Contoh: ["UUID-C", "UUID-B", "UUID-A"]
--
-- routing_score  : Total bobot rute dari Floyd-Warshall. Nilai lebih kecil
--                  berarti air lebih mudah mengalir (hambatan lebih rendah).
-- ---------------------------------------------------------------------------

ALTER TABLE trx.irrigation_recommendations
  ADD COLUMN IF NOT EXISTS route_path_ids  JSONB,
  ADD COLUMN IF NOT EXISTS routing_score   NUMERIC(10, 4);

COMMENT ON COLUMN trx.irrigation_recommendations.route_path_ids
  IS 'Array UUID sub_block berurutan hasil Floyd-Warshall (source→...→target). Null jika bukan IRRIGATE atau routing gagal.';

COMMENT ON COLUMN trx.irrigation_recommendations.routing_score
  IS 'Total bobot rute dari Floyd-Warshall. Lebih kecil = hambatan air lebih rendah = jalur lebih optimal.';
