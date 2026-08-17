import { defineConfig, devices } from "@playwright/test";

/**
 * E2E configuration.
 *
 * The suite drives a real browser against a real Next.js server, a real Django
 * API and real Supabase Auth. Only the *database* is swapped for a throwaway
 * one, so a test run can never write into the production project.
 *
 * Start the stack before running (see e2e/README.md):
 *   - Postgres/PostGIS on 5440, migrated and seeded
 *   - Django on 8010 pointed at it
 *   - `npm run dev -- -p 3010` with NEXT_PUBLIC_API_URL=http://localhost:8010
 */
export default defineConfig({
  testDir: "./e2e",
  // The journey is one ordered story; running its steps in parallel would be
  // meaningless and the steps share a signed-in session.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // Supabase auth, Nominatim geocoding and a cold Next.js dev compile are all
  // real network work; the default 5s expect timeout is far too tight.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3010",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
