-- Whop account id (stable per-Whop-account, immune to buyer email changes).
-- Stamp it on the FIRST successful Whop grant. After that, all future renewals
-- link by this id rather than by email, so a buyer changing their Whop or
-- Google email won't lose access.
--
-- Applied idempotently by web/lib/migrate.cjs on server boot (ensureSchema).

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "whop_user_id" text UNIQUE;
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "whop_user_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_memberships_whop_user_id" ON "memberships" ("whop_user_id");
--> statement-breakpoint
ALTER TABLE "pending_grants" ADD COLUMN IF NOT EXISTS "whop_user_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pending_grants_whop_user_id" ON "pending_grants" ("whop_user_id");
