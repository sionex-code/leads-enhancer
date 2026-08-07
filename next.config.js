import { dirname } from "path";
import { fileURLToPath } from "url";
import seo from "./web/lib/seo.cjs";

const root = dirname(fileURLToPath(import.meta.url));
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig = {
  reactStrictMode: true,
  basePath,
  // Site-wide noindex, when SEO_NOINDEX=1. The header is the belt to the meta
  // tag's braces: it covers every response, including the ones that have no
  // <head> to put a tag in — sitemap.xml, JSON from /api, PDFs, the extension
  // zip — and it cannot be missed by a page that sets its own metadata.
  ...(seo.NOINDEX
    ? {
        async headers() {
          return [
            {
              source: "/:path*",
              headers: [{ key: "X-Robots-Tag", value: seo.ROBOTS_HEADER }],
            },
          ];
        },
      }
    : {}),
  // Standalone output is only needed for the Electron desktop build (it bundles
  // a self-contained server.js + traced node_modules). Gated behind an env flag
  // so the normal VPS `next build` (next start via pm2) is unchanged.
  ...(process.env.BUILD_STANDALONE ? { output: "standalone" } : {}),
  // better-sqlite3 is a native addon — keep it external so Next doesn't try to
  // bundle the .node binary into the server build. patchright drives a real
  // Chrome (used by the in-process website audit in site-report.cjs) and pulls
  // optional deps like chromium-bidi that must not be webpacked into a route.
  serverExternalPackages: ["better-sqlite3", "patchright", "patchright-core"],
  // Keep the dev data dir (CSVs, leads.db, generated reports) out of the traced
  // standalone bundle — it's user data, served at runtime from GMAPS_DATA_DIR,
  // and tracing it added ~1.5GB to the build.
  outputFileTracingExcludes: {
    "*": ["output/**", "**/*.report.html"],
  },
  turbopack: {
    root,
  },
};

export default nextConfig;
