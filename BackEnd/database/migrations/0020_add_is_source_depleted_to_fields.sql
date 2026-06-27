ALTER TABLE "mst"."fields" ADD COLUMN IF NOT EXISTS "is_source_depleted" boolean DEFAULT false NOT NULL;
