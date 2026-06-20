-- Applied at runtime by web/lib/migrate.cjs (ensureSchema, idempotent) on server
-- boot. Kept here for record-keeping / manual application.
-- First-run guided tour: 0 = hasn't seen the tour, 1 = finished or skipped it.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboarded" integer DEFAULT 0 NOT NULL;
