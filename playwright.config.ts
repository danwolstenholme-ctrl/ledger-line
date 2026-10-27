import { defineConfig } from "@playwright/test";

/** One smoke run of the five journeys, against a throwaway database and recorded readings of the demo files. */
export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 120_000,
  use: { baseURL: "http://127.0.0.1:3100", channel: "chrome", trace: "retain-on-failure" },
  webServer: {
    command: "rm -rf .data/test && node node_modules/next/dist/bin/next start -p 3100",
    url: "http://127.0.0.1:3100/api/health",
    // DATABASE_URL runs the same tests against a real Postgres (an empty, throwaway one: it is rebuilt with the demo data).
    env: { LEDGERLINE_DATA_DIR: ".data/test", LEDGERLINE_AI_FIXTURES: "1", LEDGERLINE_VIES_FIXTURES: "1",
      ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL, LEDGERLINE_DEMO_DATA: "1", LEDGERLINE_RESET_ON_START: "1" } : {}),
      // LEDGERLINE_AUTH_E2E=supabase: sign-in through Supabase Auth (the build must have been made with the same NEXT_PUBLIC_ values).
      ...(process.env.LEDGERLINE_AUTH_E2E === "supabase" ? { NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
        SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY ?? "" } : {}) },
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
