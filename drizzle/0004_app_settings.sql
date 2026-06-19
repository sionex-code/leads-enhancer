-- Ensure the app_settings key/value table exists (already created in 0002;
-- this file is the canonical sequential migration record for the table).
-- All statements use IF NOT EXISTS so they are safe to re-run.

CREATE TABLE IF NOT EXISTS "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text,
	"updated_at" text
);
