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
  },
  events: {
    // Apply any Whop grant that arrived before this email had an account
    // (paid first, signed in later). Best-effort; never blocks sign-in.
    async signIn({ user }) {
      try {
        if (user?.id && user?.email) {
          const n = await billing.reconcilePendingGrants(user.id, user.email);
          if (n) console.log(`[billing] reconciled ${n} pending grant(s) for ${user.email}`);
        }
      } catch (e) {
        console.error("[billing] pending-grant reconcile failed:", e.message);
      }
    },
  },
});
