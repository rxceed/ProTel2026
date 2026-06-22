-- Custom SQL migration for adding missing BMKG flags
ALTER TABLE "trx"."weather_forecast_snapshots" ADD COLUMN IF NOT EXISTS "is_latest" boolean DEFAULT true NOT NULL;
ALTER TABLE "trx"."weather_forecast_snapshots" ADD COLUMN IF NOT EXISTS "is_stale" boolean DEFAULT false NOT NULL;