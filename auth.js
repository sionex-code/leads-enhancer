// Auth.js (NextAuth v5) configuration — Google sign-in backed by Postgres via the
// Drizzle adapter. Identity is Google; paid access is granted separately by the
// Whop webhook (see app/api/webhooks/whop). Database session strategy so sessions
// live in the `sessions` table and survive restarts.
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import pg from "./web/lib/pg.cjs";
import billing from "./web/lib/billing.cjs";

const { orm, schema } = pg;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(orm(), {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  session: { strategy: "database" },
  trustHost: true,
  providers: [Google],
  pages: {
    signIn: "/", // landing page hosts the Google CTA
  },
  callbacks: {
    // Expose the user id on the session object for server-side scoping.
    session({ session, user }) {
      if (session.user && user) session.user.id = user.id;
      return session;
    },
    async redirect({ url, baseUrl }) {
      // Allows relative callback URLs
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      
      const marketingUrl = process.env.NEXT_PUBLIC_MARKETING_URL || "";
      try {
        const urlObj = new URL(url);
        const baseObj = new URL(baseUrl);
        // Allows callback URLs on the same origin (app host)
        if (urlObj.origin === baseObj.origin) {
          return url;
        }
        // Allows callback URLs on the marketing domain
        if (marketingUrl) {
          const marketingObj = new URL(marketingUrl);
          if (urlObj.origin === marketingObj.origin) {
            return url;
          }
        }
      } catch (e) {}
      return baseUrl;
    },
  },
  events: {
    // Apply any Whop grant that arrived before this email had an account
    // (paid first, signed in later). Also backfills users.whop_user_id from
    // the matched grant, so every subsequent Whop webhook links by the
    // stable Whop account id (not email) — immune to the buyer later
    // changing their Whop email or their Google email. Best-effort; never
    // blocks sign-in.
    async signIn({ user }) {
      try {
        if (user?.id && user?.email) {
          const n = await billing.reconcilePendingGrants(user.id, user.email);
          if (n) console.log(`[billing] reconciled ${n} pending grant(s) for ${user.email} (whop_user_id backfilled)`);
        }
      } catch (e) {
        console.error("[billing] pending-grant reconcile failed:", e.message);
      }
    },
  },
});
