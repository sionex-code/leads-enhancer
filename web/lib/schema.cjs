// Drizzle (Postgres) schema for the LeadsFunda SaaS. Authored in CommonJS so it
// can be required by the CJS data layer (web/lib/db.cjs), the job queue, and the
// standalone runner, while the ESM Auth.js adapter imports it too.
//
// Migrated from the original single-tenant SQLite schema (web/lib/db.cjs):
//  - every lead/account column is preserved (text timestamps + 0/1 int flags are
//    kept as-is so existing query logic keeps working),
//  - a `user_id` FK is added to leads / projects / gmail_accounts for tenant
//    isolation, and lead dedup is now per-user: UNIQUE(user_id, dedup_key),
//  - new tables: Auth.js (users/accounts/sessions/verificationTokens), memberships,
//    jobs (queue), notifications.
const {
  pgTable,
  serial,
  text,
  integer,
  doublePrecision,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
} = require("drizzle-orm/pg-core");

// ---- Auth.js (NextAuth) adapter tables --------------------------------------
const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
});

const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [primaryKey({ columns: [account.provider, account.providerAccountId] })]
);

const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })]
);

// ---- Billing / membership (Whop) --------------------------------------------
// One membership row per user (created lazily for every signed-in user so free
// accounts can still hold credits). plan: p19 | p35 | p49 ($19/$35/$49).
// leads_quota null = unlimited ($49 tier). leads_used resets each billing period.
//
// Report credits live here too: `credits` is the spendable balance (each website
// report costs 10). `credits_monthly` is an optional per-user override of the
// monthly grant (else it falls back to the plan default / the global free grant).
// `credits_renewed_at` marks when monthly credits were last granted (lazy, on read).
const memberships = pgTable("memberships", {
  id: serial("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  whopMembershipId: text("whop_membership_id"),
  whopPlanId: text("whop_plan_id"),
  plan: text("plan"), // p19 | p35 | p49
  status: text("status").notNull().default("inactive"), // active | inactive
  leadsQuota: integer("leads_quota"), // null = unlimited
  leadsUsed: integer("leads_used").notNull().default(0),
  credits: integer("credits").notNull().default(0),
  creditsMonthly: integer("credits_monthly"), // null = use plan/global default
  creditsRenewedAt: text("credits_renewed_at"),
  currentPeriodStart: text("current_period_start"),
  currentPeriodEnd: text("current_period_end"),
  updatedAt: text("updated_at"),
});

// ---- Global app settings (admin-tunable key/value) --------------------------
// e.g. free_monthly_credits_enabled ("1"/"0"), free_monthly_credits ("100").
const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: text("updated_at"),
});

// ---- Scraper proxy pool (global, admin-managed) -----------------------------
// HTTPS proxies the scrapers rotate through (random per request) so Maps /
// website fetches don't hammer the same IP. Shared across all tenants.
const proxies = pgTable("proxies", {
  id: serial("id").primaryKey(),
  url: text("url").notNull().unique(), // http(s)://[user:pass@]host:port
  label: text("label"),
  enabled: integer("enabled").notNull().default(1),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
  useCount: integer("use_count").notNull().default(0),
  failCount: integer("fail_count").notNull().default(0),
});

// ---- Shared enrichment cache (global, cross-tenant) -------------------------
// Once a business website/phone is enriched (emails + socials) by ANY user, the
// result is cached here keyed by domain (and phone) so the same business never
// has to be re-crawled — every user immediately sees the enriched data.
const enrichmentCache = pgTable(
  "enrichment_cache",
  {
    id: serial("id").primaryKey(),
    domain: text("domain").notNull().unique(),
    phone: text("phone"),
    email: text("email"),
    allEmails: text("all_emails"),
    contactPage: text("contact_page"),
    facebook: text("facebook"),
    instagram: text("instagram"),
    linkedin: text("linkedin"),
    twitter: text("twitter"),
    youtube: text("youtube"),
    tiktok: text("tiktok"),
    pinterest: text("pinterest"),
    whatsapp: text("whatsapp"),
    telegram: text("telegram"),
    enrichStatus: text("enrich_status"),
    source: text("source"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("idx_enrichment_cache_phone").on(t.phone)]
);

// Global, cross-tenant WhatsApp-status cache. A phone number checked once by ANY
// user is reused by everyone (and by future finds) instead of re-running the
// WhatsApp lookup — keyed by the normalized international number (digits only).
const whatsappCache = pgTable("whatsapp_cache", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  status: text("status"),
  whatsappId: text("whatsapp_id"),
  checkedAt: text("checked_at").notNull(),
});

// ---- Pending Whop grants (paid before signing in, or unmatched) --------------
// When a Whop webhook arrives with no user_id metadata and no matching user yet,
// we stash the grant keyed by the buyer email and reconcile it the next time that
// email signs in with Google (auth.js events.signIn).
const pendingGrants = pgTable(
  "pending_grants",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    whopMembershipId: text("whop_membership_id"),
    whopPlanId: text("whop_plan_id"),
    currentPeriodStart: text("current_period_start"),
    currentPeriodEnd: text("current_period_end"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_pending_grants_email").on(t.email)]
);

// ---- Gmail cookie accounts — DEPRECATED ------------------------------------
// The Gmail cookie-rotation feature was removed in favour of the proxy pool
// (see `proxies`). The table is kept so existing databases don't need a
// destructive drop; nothing in the app reads or writes it any more.
const gmailAccounts = pgTable(
  "gmail_accounts",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    cookies: text("cookies").notNull(),
    enabled: integer("enabled").notNull().default(1),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at"),
    useCount: integer("use_count").notNull().default(0),
  },
  (t) => [index("idx_gmail_accounts_user").on(t.userId)]
);

// ---- Projects (ownership/listing; on-disk files still hold runner I/O) -------
const projects = pgTable(
  "projects",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    query: text("query"),
    max: integer("max"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at"),
  },
  (t) => [uniqueIndex("uniq_projects_user_slug").on(t.userId, t.slug)]
);

// ---- Jobs queue (global concurrency cap enforced by the supervisor) ----------
// status: queued | running | done | failed | canceled. type: scrape | enrich.
const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectSlug: text("project_slug"),
    type: text("type").notNull().default("scrape"),
    status: text("status").notNull().default("queued"),
    params: jsonb("params"),
    priority: integer("priority").notNull().default(0),
    pid: integer("pid"),
    error: text("error"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
    startedAt: timestamp("started_at", { mode: "date" }),
    finishedAt: timestamp("finished_at", { mode: "date" }),
  },
  (t) => [index("idx_jobs_status").on(t.status), index("idx_jobs_user").on(t.userId)]
);

// ---- In-app notifications (job done, quota, etc.) ----------------------------
const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload"),
    readAt: timestamp("read_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
  },
  (t) => [index("idx_notifications_user").on(t.userId)]
);

// ---- Leads (per-tenant; dedup is now UNIQUE(user_id, dedup_key)) -------------
const leads = pgTable(
  "leads",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dedupKey: text("dedup_key").notNull(),
    name: text("name"),
    category: text("category"),
    rating: text("rating"),
    reviews: text("reviews"),
    website: text("website"),
    domain: text("domain"),
    phone: text("phone"),
    address: text("address"),
    city: text("city"),
    country: text("country"),
    plusCode: text("plus_code"),
    hours: text("hours"),
    mapsUrl: text("maps_url"),
    imageUrls: text("image_urls"),
    email: text("email"),
    allEmails: text("all_emails"),
    contactPage: text("contact_page"),
    facebook: text("facebook"),
    instagram: text("instagram"),
    linkedin: text("linkedin"),
    twitter: text("twitter"),
    youtube: text("youtube"),
    tiktok: text("tiktok"),
    pinterest: text("pinterest"),
    whatsapp: text("whatsapp"),
    telegram: text("telegram"),
    enrichStatus: text("enrich_status"),
    whatsappStatus: text("whatsapp_status"),
    whatsappId: text("whatsapp_id"),
    desktopPerformance: integer("desktop_performance"),
    desktopSeo: integer("desktop_seo"),
    desktopAccessibility: integer("desktop_accessibility"),
    desktopBestPractices: integer("desktop_best_practices"),
    mobilePerformance: integer("mobile_performance"),
    mobileSeo: integer("mobile_seo"),
    mobileAccessibility: integer("mobile_accessibility"),
    mobileBestPractices: integer("mobile_best_practices"),
    httpStatus: integer("http_status"),
    httpStatusText: text("http_status_text"),
    httpCheckedAt: text("http_checked_at"),
    chatbot: text("chatbot"),
    chatbotVendors: text("chatbot_vendors"),
    chatbotMethod: text("chatbot_method"),
    chatbotCheckedAt: text("chatbot_checked_at"),
    project: text("project"),
    query: text("query"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    ownerReplied: integer("owner_replied"),
    ownerReplyCount: integer("owner_reply_count"),
    watchlist: integer("watchlist").notNull().default(0),
    contactList: integer("contact_list").notNull().default(0),
    emailStatus: text("email_status").notNull().default("unset"),
    outreachStatus: text("outreach_status").notNull().default("new"),
    notes: text("notes"),
    lastContactedAt: text("last_contacted_at"),
    messageSentAt: text("message_sent_at"),
    completedAt: text("completed_at"),
    firstSeen: text("first_seen").notNull(),
    lastUpdated: text("last_updated").notNull(),
  },
  (t) => [
    uniqueIndex("uniq_leads_user_dedup").on(t.userId, t.dedupKey),
    index("idx_leads_user").on(t.userId),
    index("idx_leads_domain").on(t.domain),
    index("idx_leads_project").on(t.project),
    index("idx_leads_updated").on(t.lastUpdated),
    index("idx_leads_country").on(t.country),
  ]
);

module.exports = {
  users,
  accounts,
  sessions,
  verificationTokens,
  memberships,
  pendingGrants,
  appSettings,
  proxies,
  enrichmentCache,
  whatsappCache,
  gmailAccounts,
  projects,
  jobs,
  notifications,
  leads,
};
