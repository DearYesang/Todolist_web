DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "boards"
		GROUP BY "workspace_id", "name"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'Cannot add boards_workspace_name_uidx while duplicate workspace/name board rows exist.';
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "workspaces"
		GROUP BY "owner_user_id", "name"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'Cannot add workspaces_owner_name_uidx while duplicate owner/name workspace rows exist.';
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "boards_workspace_name_uidx" ON "boards" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_owner_name_uidx" ON "workspaces" USING btree ("owner_user_id","name");
