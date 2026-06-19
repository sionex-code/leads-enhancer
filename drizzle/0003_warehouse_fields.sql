-- Warehouse-sourced lead columns: coordinates + owner-reply counters.
-- Applied idempotently by web/lib/migrate.cjs on server boot (ensureSchema).
-- These are populated by warehouse.cjs when leads are imported from the
-- gmaps-scraper-standalone warehouse server.

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "lat" double precision;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "lng" double precision;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "owner_replied" integer;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "owner_reply_count" integer;
