// The dev user's id, in CJS so both the ESM auth stub (web/lib/dev-auth.js) and
// the CJS data-layer stub (web/lib/dev-leads.cjs) read the same value. It is also
// the folder name under tenants/, so changing it orphans any seeded projects.
const DEV_USER_ID = "dev-local-user";

module.exports = { DEV_USER_ID };
