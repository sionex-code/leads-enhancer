// Auth.js route handler — mounts Google sign-in / callback / session endpoints
// under /api/auth/*. Runs on the Node runtime (the Drizzle adapter uses node pg).
import { handlers } from "../../../../auth";

export const runtime = "nodejs";
export const { GET, POST } = handlers;
