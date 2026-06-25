-- Ahrefs Domain Rating (free public API) cache. Populated on-demand by the
-- leads page so the table can show a 0-100 DR per lead (free, no API key).
-- Applied idempotently by web/lib/migrate.cjs on server boot (ensureSchema).

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "domain_rating" double precision;
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "domain_rating_checked_at" text;
