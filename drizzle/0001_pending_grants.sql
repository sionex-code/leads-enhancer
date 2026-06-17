CREATE TABLE IF NOT EXISTS "pending_grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"whop_membership_id" text,
	"whop_plan_id" text,
	"current_period_start" text,
	"current_period_end" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pending_grants_email" ON "pending_grants" USING btree ("email");
