ALTER TABLE "mst"."devices" ADD COLUMN IF NOT EXISTS "parent_station" text;--> statement-breakpoint
ALTER TABLE "mst"."sub_blocks" ADD COLUMN IF NOT EXISTS "elevation_calibration" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "trx"."telemetry_records" ADD COLUMN IF NOT EXISTS "pressure" numeric(7, 2);