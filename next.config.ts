import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite loads its WebAssembly and data files at runtime: keep it out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Read from disk while running, so a host (Vercel) must carry them: the schema and the demo data it is built
  // from, the Supabase migrations, the recorded readings of the demo files, and PGlite's own files.
  outputFileTracingIncludes: {
    "/*": ["./src/lib/db/schema.sql", "./src/lib/db/seed-files/**/*", "./supabase/migrations/**/*", "./demo-files/fixtures/**/*", "./node_modules/@electric-sql/pglite/dist/**/*"],
  },
  allowedDevOrigins: ["127.0.0.1"],
  // Components memoised by the React Compiler rather than by hand, compiled by its Rust port inside Turbopack.
  reactCompiler: true,
  experimental: {
    turbopackRustReactCompiler: true,
    // A dropped connection holds navigations and saves, and sends them when it is back (and useOffline says so).
    useOffline: true,
    // Statements and scanned invoices go to actions and route handlers in one request.
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
