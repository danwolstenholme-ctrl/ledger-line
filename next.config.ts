import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite loads its WebAssembly and data files at runtime: keep it out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
  allowedDevOrigins: ["127.0.0.1"],
  // Statements and scanned invoices go to actions and route handlers in one request.
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
};

export default nextConfig;
