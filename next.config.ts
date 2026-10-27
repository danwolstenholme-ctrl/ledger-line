import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite loads its WebAssembly and data files at runtime: keep it out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
  allowedDevOrigins: ["127.0.0.1"],
  // Components memoised by the React Compiler rather than by hand, compiled by its Rust port inside Turbopack.
  reactCompiler: true,
  experimental: {
    turbopackRustReactCompiler: true,
    // Statements and scanned invoices go to actions and route handlers in one request.
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
