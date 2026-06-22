CREATE TABLE IF NOT EXISTS "mst"."irrigation_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"field_id" uuid NOT NULL,
	"point_type" text NOT NULL,
	"coordinate_point" text,
	"elevation_m" numeric(7, 2)
);
--> statement-breakpoint
ALTER TABLE "mst"."flow_paths" DROP CONSTRAINT "flow_paths_from_sub_block_id_sub_blocks_id_fk";
--> statement-breakpoint
ALTER TABLE "mst"."flow_paths" DROP CONSTRAINT "flow_paths_to_sub_block_id_sub_blocks_id_fk";
--> statement-breakpoint
ALTER TABLE "mst"."devices" ADD COLUMN "coordinate" json;--> statement-breakpoint
ALTER TABLE "mst"."fields" ADD COLUMN "irrigation_edges" json;--> statement-breakpoint
ALTER TABLE "mst"."fields" ADD COLUMN "irrigation_nodes" json;--> statement-breakpoint
ALTER TABLE "mst"."flow_paths" ADD COLUMN "field_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "mst"."flow_paths" ADD COLUMN "floyd_warshall_matrix" json;--> statement-breakpoint
ALTER TABLE "mst"."sensor_calibrations" ADD COLUMN "sensor_max_distance_mm" integer DEFAULT 1400 NOT NULL;--> statement-breakpoint
ALTER TABLE "trx"."irrigation_recommendations" ADD COLUMN "route_path_ids" jsonb;--> statement-breakpoint
ALTER TABLE "trx"."irrigation_recommendations" ADD COLUMN "routing_score" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "trx"."sub_block_current_states" ADD COLUMN "estimated_from_sub_block_ids" uuid[];--> statement-breakpoint
ALTER TABLE "trx"."sub_block_states" ADD COLUMN "estimated_from_sub_block_ids" uuid[];--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mst"."irrigation_points" ADD CONSTRAINT "irrigation_points_field_id_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "mst"."fields"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mst"."flow_paths" ADD CONSTRAINT "flow_paths_field_id_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "mst"."fields"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
