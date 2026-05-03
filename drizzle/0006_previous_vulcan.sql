CREATE TABLE "calendar_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"task_count" integer DEFAULT 0 NOT NULL,
	"upserted" integer DEFAULT 0 NOT NULL,
	"deleted" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"message" text,
	CONSTRAINT "calendar_sync_runs_status_check" CHECK ("calendar_sync_runs"."status" in ('running', 'success', 'partial', 'error'))
);
--> statement-breakpoint
ALTER TABLE "calendar_sync_runs" ADD CONSTRAINT "calendar_sync_runs_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_sync_runs" ADD CONSTRAINT "calendar_sync_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_sync_runs_user_started_idx" ON "calendar_sync_runs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "calendar_sync_runs_connection_started_idx" ON "calendar_sync_runs" USING btree ("connection_id","started_at");