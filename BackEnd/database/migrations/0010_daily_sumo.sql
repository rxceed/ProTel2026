CREATE TABLE IF NOT EXISTS "mst"."embankments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"unique_code" text,
	"polygon_geom" text NOT NULL,
	"area_m2" numeric(12, 2),
	"centroid" text,
	"elevation_m" numeric(7, 2),
	"soil_type" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"connected_sub_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mst"."fields" ADD COLUMN "is_source_depleted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mst"."irrigation_points" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "mst"."irrigation_points" ADD COLUMN "assigned_sub_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mst"."sub_blocks" ADD COLUMN "unique_code" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mst"."embankments" ADD CONSTRAINT "embankments_field_id_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "mst"."fields"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
