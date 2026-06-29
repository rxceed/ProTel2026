CREATE TABLE IF NOT EXISTS "trx"."agronomic_treatments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_id" uuid NOT NULL,
	"sub_block_id" uuid,
	"crop_cycle_id" uuid,
	"treatment_type" text NOT NULL,
	"product_name" text NOT NULL,
	"target_water_level_cm" numeric(7, 2) NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active_duration_hours" integer NOT NULL,
	"override_expires_at" timestamp with time zone NOT NULL,
	"reported_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trx"."agronomic_treatments" ADD CONSTRAINT "agronomic_treatments_field_id_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "mst"."fields"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trx"."agronomic_treatments" ADD CONSTRAINT "agronomic_treatments_sub_block_id_sub_blocks_id_fk" FOREIGN KEY ("sub_block_id") REFERENCES "mst"."sub_blocks"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trx"."agronomic_treatments" ADD CONSTRAINT "agronomic_treatments_crop_cycle_id_crop_cycles_id_fk" FOREIGN KEY ("crop_cycle_id") REFERENCES "mst"."crop_cycles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trx"."agronomic_treatments" ADD CONSTRAINT "agronomic_treatments_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "mst"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;