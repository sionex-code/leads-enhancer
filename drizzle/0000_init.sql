CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"email_verified" timestamp,
	"image" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"whop_membership_id" text,
	"whop_plan_id" text,
	"plan" text,
	"status" text DEFAULT 'inactive' NOT NULL,
	"leads_quota" integer,
	"leads_used" integer DEFAULT 0 NOT NULL,
	"current_period_start" text,
	"current_period_end" text,
	"updated_at" text,
	CONSTRAINT "memberships_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "gmail_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"cookies" text NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"last_used_at" text,
	"use_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"query" text,
	"max" integer,
	"created_at" text NOT NULL,
	"updated_at" text
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_slug" text,
	"type" text DEFAULT 'scrape' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"params" jsonb,
	"priority" integer DEFAULT 0 NOT NULL,
	"pid" integer,
	"error" text,
	"created_at" timestamp DEFAULT now(),
	"started_at" timestamp,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"dedup_key" text NOT NULL,
	"name" text,
	"category" text,
	"rating" text,
	"reviews" text,
	"website" text,
	"domain" text,
	"phone" text,
	"address" text,
	"city" text,
	"country" text,
	"plus_code" text,
	"hours" text,
	"maps_url" text,
	"image_urls" text,
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
	"whatsapp_status" text,
	"whatsapp_id" text,
	"desktop_performance" integer,
	"desktop_seo" integer,
	"desktop_accessibility" integer,
	"desktop_best_practices" integer,
	"mobile_performance" integer,
	"mobile_seo" integer,
	"mobile_accessibility" integer,
	"mobile_best_practices" integer,
	"http_status" integer,
	"http_status_text" text,
	"http_checked_at" text,
	"chatbot" text,
	"chatbot_vendors" text,
	"chatbot_method" text,
	"chatbot_checked_at" text,
	"domain_rating" double precision,
	"domain_rating_checked_at" text,
	"project" text,
	"query" text,
	"watchlist" integer DEFAULT 0 NOT NULL,
	"contact_list" integer DEFAULT 0 NOT NULL,
	"email_status" text DEFAULT 'unset' NOT NULL,
	"outreach_status" text DEFAULT 'new' NOT NULL,
	"notes" text,
	"last_contacted_at" text,
	"message_sent_at" text,
	"completed_at" text,
	"first_seen" text NOT NULL,
	"last_updated" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_accounts" ADD CONSTRAINT "gmail_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_gmail_accounts_user" ON "gmail_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_projects_user_slug" ON "projects" USING btree ("user_id","slug");--> statement-breakpoint
CREATE INDEX "idx_jobs_status" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_jobs_user" ON "jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_user" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_leads_user_dedup" ON "leads" USING btree ("user_id","dedup_key");--> statement-breakpoint
CREATE INDEX "idx_leads_user" ON "leads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_leads_domain" ON "leads" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "idx_leads_project" ON "leads" USING btree ("project");--> statement-breakpoint
CREATE INDEX "idx_leads_updated" ON "leads" USING btree ("last_updated");--> statement-breakpoint
CREATE INDEX "idx_leads_country" ON "leads" USING btree ("country");