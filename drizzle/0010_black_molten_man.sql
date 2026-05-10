CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"hidden_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_user_id_idx" ON "categories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "categories_board_sort_order_idx" ON "categories" USING btree ("board_id","sort_order");--> statement-breakpoint
CREATE INDEX "categories_board_archived_at_idx" ON "categories" USING btree ("board_id","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_board_normalized_name_uidx" ON "categories" USING btree ("board_id","normalized_name");--> statement-breakpoint
INSERT INTO "categories" ("board_id", "user_id", "name", "normalized_name", "sort_order", "created_at", "updated_at")
SELECT
	"source"."board_id",
	"source"."user_id",
	"source"."name",
	"source"."normalized_name",
	row_number() over (partition by "source"."board_id" order by "source"."name") - 1,
	now(),
	now()
FROM (
	SELECT
		"tasks"."board_id",
		min("tasks"."created_by") AS "user_id",
		min(regexp_replace(btrim("tasks"."category"), '[[:space:]]+', ' ', 'g')) AS "name",
		lower(regexp_replace(btrim("tasks"."category"), '[[:space:]]+', ' ', 'g')) AS "normalized_name"
	FROM "tasks"
	WHERE btrim("tasks"."category") <> ''
	GROUP BY
		"tasks"."board_id",
		lower(regexp_replace(btrim("tasks"."category"), '[[:space:]]+', ' ', 'g'))
) AS "source"
ON CONFLICT ("board_id", "normalized_name") DO NOTHING;--> statement-breakpoint
UPDATE "tasks"
SET
	"category_id" = "categories"."id",
	"category" = "categories"."name"
FROM "categories"
WHERE
	"tasks"."category_id" IS NULL
	AND btrim("tasks"."category") <> ''
	AND "tasks"."board_id" = "categories"."board_id"
	AND lower(regexp_replace(btrim("tasks"."category"), '[[:space:]]+', ' ', 'g')) = "categories"."normalized_name";--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_board_category_id_idx" ON "tasks" USING btree ("board_id","category_id");
