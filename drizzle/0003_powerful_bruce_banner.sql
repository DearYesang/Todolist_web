CREATE TABLE "calendar_subscription_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"name" text DEFAULT 'Calendar feed' NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "calendar_subscription_tokens" ADD CONSTRAINT "calendar_subscription_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_subscription_tokens" ADD CONSTRAINT "calendar_subscription_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_subscription_tokens" ADD CONSTRAINT "calendar_subscription_tokens_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_subscription_tokens_user_id_idx" ON "calendar_subscription_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "calendar_subscription_tokens_board_id_idx" ON "calendar_subscription_tokens" USING btree ("board_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_subscription_tokens_token_hash_uidx" ON "calendar_subscription_tokens" USING btree ("token_hash");