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
    env: { LEDGERLINE_DATA_DIR: ".data/test", LEDGERLINE_AI_FIXTURES: "1", LEDGERLINE_VIES_FIXTURES: "1" },
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
