-- Applied at runtime by web/lib/migrate.cjs (ensureSchema, idempotent) on server
-- boot. Kept here for record-keeping / manual application. Mirrors the post-pivot
-- additions: report credits, app settings, scraper proxy pool, shared enrichment
-- cache, and the $19/$35/$49 plan-key rename.

ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "credits" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "credits_monthly" integer;
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "credits_renewed_at" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text,
	"updated_at" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proxies" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"enabled" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"last_used_at" text,
	"use_count" integer DEFAULT 0 NOT NULL,
	"fail_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "proxies_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "enrichment_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"phone" text,
	"email" text,
	"all_emails" text,
	"contact_page" text,
	"facebook" text,
	"instagram" text,
	"linkedin" text,
	"twitter" text,
	"youtube" text,
	"tiktok" text,
	"pinterest" text,
	"whatsapp" text,
	"telegram" text,
	"enrich_status" text,
	"source" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "enrichment_cache_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_enrichment_cache_phone" ON "enrichment_cache" USING btree ("phone");
