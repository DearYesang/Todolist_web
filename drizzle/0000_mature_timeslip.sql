CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"default_view" text DEFAULT 'kanban' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boards_default_view_check" CHECK ("boards"."default_view" in ('kanban', 'gantt'))
);
--> statement-breakpoint
CREATE TABLE "calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text,
	"encrypted_access_token" text,
	"encrypted_refresh_token" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_connections_provider_check" CHECK ("calendar_connections"."provider" in ('google', 'microsoft', 'caldav'))
);
--> statement-breakpoint
CREATE TABLE "calendar_event_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_calendar_id" text NOT NULL,
	"external_event_id" text NOT NULL,
	"etag" text,
	"last_synced_at" timestamp with time zone,
	"sync_status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "calendar_event_links_sync_status_check" CHECK ("calendar_event_links"."sync_status" in ('active', 'deleted', 'error'))
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"text" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"position" numeric(20, 10) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"resource" text NOT NULL,
	"cursor" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"parent_task_id" uuid,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"priority" text NOT NULL,
	"urgency" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"position" numeric(20, 10) DEFAULT '0' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tasks_status_check" CHECK ("tasks"."status" in ('todo', 'doing', 'done')),
	CONSTRAINT "tasks_priority_check" CHECK ("tasks"."priority" in ('high', 'medium', 'low')),
	CONSTRAINT "tasks_urgency_check" CHECK ("tasks"."urgency" in ('urgent', 'normal')),
	CONSTRAINT "tasks_date_range_check" CHECK ("tasks"."end_date" >= "tasks"."start_date"),
	CONSTRAINT "tasks_no_self_parent_check" CHECK ("tasks"."parent_task_id" is null or "tasks"."parent_task_id" <> "tasks"."id")
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "workspace_members_role_check" CHECK ("workspace_members"."role" in ('owner', 'admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_connection_id_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boards_workspace_id_idx" ON "boards" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "calendar_connections_workspace_provider_idx" ON "calendar_connections" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE INDEX "calendar_event_links_task_id_idx" ON "calendar_event_links" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_event_links_external_event_uidx" ON "calendar_event_links" USING btree ("connection_id","external_calendar_id","external_event_id");--> statement-breakpoint
CREATE INDEX "checklist_items_task_position_idx" ON "checklist_items" USING btree ("task_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_cursors_connection_resource_uidx" ON "sync_cursors" USING btree ("connection_id","resource");--> statement-breakpoint
CREATE INDEX "tasks_board_status_position_idx" ON "tasks" USING btree ("board_id","status","position");--> statement-breakpoint
CREATE INDEX "tasks_board_date_range_idx" ON "tasks" USING btree ("board_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "tasks_parent_task_id_idx" ON "tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE INDEX "tasks_board_category_idx" ON "tasks" USING btree ("board_id","category");--> statement-breakpoint
CREATE INDEX "tasks_board_deleted_at_idx" ON "tasks" USING btree ("board_id","deleted_at");--> statement-breakpoint
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspaces_owner_user_id_idx" ON "workspaces" USING btree ("owner_user_id");