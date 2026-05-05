DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "calendar_event_links"
		GROUP BY "connection_id", "task_id"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'Cannot add calendar_event_links_connection_task_uidx while duplicate connection/task calendar event links exist.';
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_event_links_connection_task_uidx" ON "calendar_event_links" USING btree ("connection_id","task_id");
