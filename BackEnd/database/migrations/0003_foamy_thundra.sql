CREATE TABLE IF NOT EXISTS "trx"."dss_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_id" uuid NOT NULL,
	"sub_block_id" uuid,
	"task_type" text NOT NULL,
	"command_text" text NOT NULL,
	"reason" text,
	"priority_score" numeric(3, 2),
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trx"."dss_tasks" ADD CONSTRAINT "dss_tasks_field_id_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "mst"."fields"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trx"."dss_tasks" ADD CONSTRAINT "dss_tasks_sub_block_id_sub_blocks_id_fk" FOREIGN KEY ("sub_block_id") REFERENCES "mst"."sub_blocks"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trx"."dss_tasks" ADD CONSTRAINT "dss_tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "mst"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
