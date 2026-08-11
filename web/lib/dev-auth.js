// Dev-only fake session, so the authenticated pages can be opened locally (and
// annotated / styled) without Google OAuth and without a reachable database.
//
// This can never switch on in production. It requires BOTH of:
//   1. NODE_ENV !== "production" — `next build` and `next start` both force
//      NODE_ENV to "production", so a real deploy fails this check outright even
//      if the env var below were somehow set on the server; and
//   2. DEV_FAKE_AUTH === "1" — an explicit opt-in that lives only in .env.local,
//      which .gitignore excludes (`.env*`), so it is never committed or shipped.
// Either condition alone is enough to keep the stub off; there is no way to
// enable it from the browser, a cookie, or a query string.
import devUser from "./dev-user.cjs";

const { DEV_USER_ID } = devUser;

export const DEV_AUTH_ENABLED =
  process.env.NODE_ENV !== "production" && process.env.DEV_FAKE_AUTH === "1";

// The pretend signed-in account. The id is deliberately not a uuid so any row it
// ever reached in a real database would stand out immediately, and it doubles as
// the tenants/<id>/ folder name holding this user's seeded projects.
export const DEV_USER = {
  id: DEV_USER_ID,
  email: "dev@localhost",
  name: "Dev User",
  image: null,
};

// Same shape auth() resolves to for a real Google session.
export function devSession() {
  return {
    user: { ...DEV_USER },
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

// Canned /api/me body: mirrors billing.getEntitlement + billing.getDailyUsage so
// the app shell renders its credit and quota pills instead of empty space. Served
// without touching Postgres, which is the whole point locally.
export function devMePayload() {
  return {
    user: { ...DEV_USER },
    entitlement: {
      active: true,
      plan: "pro",
      unlimited: false,
      credits: 5000,
      monthly: 5000,
      creditsMonthly: 5000,
      quota: 5000,
      used: 0,
      remaining: 5000,
    },
    daily: {
      plan: "pro",
      tz: "UTC",
      resetAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      resetInSeconds: 12 * 60 * 60,
      searches: { limit: 100, used: 0, remaining: 100, unlimited: false },
      leads: { limit: 5000, used: 0, remaining: 5000, unlimited: false },
    },
    unread: 0,
    onboarded: true,
    admin: true,
  };
}
