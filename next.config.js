import { dirname } from "path";
import { fileURLToPath } from "url";

const root = dirname(fileURLToPath(import.meta.url));
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig = {
  reactStrictMode: true,
  basePath,
  // better-sqlite3 is a native addon — keep it external so Next doesn't try to
  // bundle the .node binary into the server build.
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    root,
  },
};

export default nextConfig;
