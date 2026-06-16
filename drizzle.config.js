// Drizzle Kit config. Schema is authored in CommonJS (web/lib/schema.cjs) so it
// can be required by both the CJS data layer (web/lib/db.cjs, web-runner.cjs) and
// the ESM Auth.js adapter. drizzle-kit loads the schema file itself from this path.
import "./scripts/load-env.cjs";

/** @type {import('drizzle-kit').Config} */
export default {
  schema: "./web/lib/schema.cjs",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
    // Supabase requires TLS; its pooler cert isn't publicly chained.
    ssl: { rejectUnauthorized: false },
  },
  verbose: true,
  strict: true,
};
