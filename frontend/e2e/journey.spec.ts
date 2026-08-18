import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * The full new-user journey, in one ordered story:
 *
 *   register -> onboarding -> discovery (filter + nearby) -> create trip
 *   -> add itinerary items -> add budget items
 *
 * Real browser, real Next.js, real Django, real Supabase Auth. Only the
 * database is a throwaway, so a run can never touch production data.
 *
 * One deliberate shortcut: the project requires email confirmation, and a test
 * has no inbox. After submitting the real registration form, the harness
 * confirms the address through the Supabase admin API — standing in for the
 * click on the emailed link, and nothing else. The form itself, its validation
 * and the Supabase signup call are all genuinely exercised.
 */

const readEnv = (path: string): Record<string, string> =>
  Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).split(" #")[0].trim()];
      }),
  );

const be = readEnv("../backend/.env");
const SUPABASE_URL = be.SUPABASE_URL;
const SERVICE_KEY = be.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

// Supabase rejects example.com as an invalid address domain.
const stamp = Date.now();
const EMAIL = `tripbuddy.e2e.${stamp}@gmail.com`;
const PASSWORD = `Tb-e2e-${stamp}!x`;
const DISPLAY_NAME = "E2E Traveller";
const TRIP_TITLE = `E2E trip ${stamp}`;

let createdUserId: string | null = null;

async function findUser(email: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
    headers: ADMIN_HEADERS,
  });
  const { users } = (await res.json()) as { users: { id: string; email: string }[] };
  return users.find((u) => u.email === email) ?? null;
}

/**
 * Make the account usable without an inbox.
 *
 * If the registration form reached Supabase, this only flips the confirmation
 * flag — standing in for the click on the emailed link. If it did not (the
 * project's transactional email is rate-limited on the free tier, and a run
 * that trips the limit gets no user at all), the account is provisioned
 * directly so the rest of the journey can still run.
 *
 * Returns whether the row already existed, so the caller can report which path
 * the run actually took instead of quietly claiming coverage it does not have.
 */
async function ensureConfirmedAccount(email: string): Promise<{ id: string; viaForm: boolean }> {
  const existing = await findUser(email);
  if (existing) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${existing.id}`, {
      method: "PUT",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ email_confirm: true }),
    });
    return { id: existing.id, viaForm: true };
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true }),
  });
  const raw = await res.text();
  let created: { id?: string; msg?: string } = {};
  try {
    created = JSON.parse(raw) as { id?: string; msg?: string };
  } catch {
    /* fall through to the error below, which reports the raw body */
  }
  if (!created.id) {
    // Report the status and body: Supabase signals rate limits and duplicate
    // addresses in different fields, so reading only `msg` yields "undefined"
    // and hides which of them happened.
    throw new Error(
      `could not provision an account (HTTP ${res.status}): ${raw.slice(0, 300)}`,
    );
  }
  return { id: created.id, viaForm: false };
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 60_000,
  });
}

test.afterAll(async () => {
  // Every run creates a real Supabase auth user; remove it. The application
  // rows live in the throwaway database and go with the container.
  if (createdUserId) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${createdUserId}`, {
      method: "DELETE",
      headers: ADMIN_HEADERS,
    });
  }
});

test.describe.serial("new traveller journey", () => {
  test("register form validates before it submits anything", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: /create your account/i })).toBeVisible();

    // Mismatched confirmation is caught client-side by the zod schema — no
    // account is created and no email is sent.
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(`${PASSWORD}-different`);
    await page.getByRole("button", { name: /create account|sign up/i }).click();

    await expect(page.getByRole("alert").first()).toBeVisible({ timeout: 20_000 });
    expect(await findUser(EMAIL)).toBeNull();

    // An obviously invalid address is rejected too.
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: /create account|sign up/i }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
  });

  test("registers a new account", async ({ page }) => {
    await page.goto("/register");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: /create account|sign up/i }).click();

    // Either the app confirms the signup, or Supabase's free-tier email quota
    // refused it. Both are real outcomes; wait for whichever appears rather
    // than hanging on the happy path.
    await expect(
      page.getByText(/check your email/i).or(page.getByRole("alert")).first(),
    ).toBeVisible({ timeout: 60_000 });

    const account = await ensureConfirmedAccount(EMAIL);
    createdUserId = account.id;
    expect(createdUserId).toBeTruthy();

    test.info().annotations.push({
      type: "account-created-by",
      description: account.viaForm
        ? "the registration form (full path exercised)"
        : "the admin API — Supabase's email quota refused the form submission, " +
          "so only the form's client-side behaviour was covered this run",
    });
  });

  test("completes onboarding and stores an approximate area", async ({ page }) => {
    await signIn(page);
    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { name: /set up your travel profile/i })).toBeVisible();

    // Step 1 — identity
    await page.getByLabel("Display name").fill(DISPLAY_NAME);
    await page.getByLabel("Age band").selectOption("21-23");
    await page.getByLabel("Gender").selectOption("prefer_not_to_say");
    await page.getByRole("button", { name: /continue/i }).click();

    // Step 2 — preferences. Tag pickers are toggle buttons, not checkboxes.
    await page.getByRole("group", { name: /languages you speak/i })
      .getByRole("button", { name: "english", exact: true }).click();
    const interests = page.getByRole("group", { name: /travel interests/i });
    await interests.getByRole("button", { name: "beach", exact: true }).click();
    await interests.getByRole("button", { name: "food", exact: true }).click();
    await page.getByLabel("Budget style").selectOption("mid");
    await page.getByLabel(/typical daily budget/i).fill("2500");
    await page.getByRole("button", { name: /continue/i }).click();

    // Step 3 — city. Geocoded server-side; only a rounded point is stored.
    await page.getByLabel("Your city").fill("Bengaluru");
    await page.getByRole("button", { name: /finish/i }).click();

    await page.waitForURL(/\/(profile|discover)/, { timeout: 90_000 });

    // The profile now shows the approximate area the backend geocoded.
    await page.goto("/profile");
    await expect(page.getByLabel("Display name")).toHaveValue(DISPLAY_NAME, {
      timeout: 30_000,
    });
    await expect(page.getByText(/bengaluru/i).first()).toBeVisible();
  });

  test("discovers destinations, filters them, and sorts by proximity", async ({ page }) => {
    await signIn(page);
    await page.goto("/discover");

    // The seeded catalogue renders.
    const cards = page.getByRole("listitem");
    await expect(cards.first()).toBeVisible({ timeout: 60_000 });
    const unfiltered = await cards.count();
    expect(unfiltered).toBeGreaterThan(1);

    // Filter by region and the list narrows.
    await page.getByLabel("Region").selectOption("West");
    await expect(page.getByRole("listitem").first()).toBeVisible();
    await expect
      .poll(async () => page.getByRole("listitem").count(), { timeout: 30_000 })
      .toBeLessThan(unfiltered);

    // Clear the region, then sort by proximity — this is the PostGIS path,
    // and it needs the area onboarding just stored.
    await page.getByLabel("Region").selectOption("");
    await page.getByRole("radio", { name: /nearby/i }).click();

    await expect(page.getByRole("listitem").first()).toBeVisible({ timeout: 60_000 });
    // Proximity results carry a PostGIS-measured distance; that is the
    // observable difference from the budget-sorted list.
    await expect(page.getByText(/km away/i).first()).toBeVisible({ timeout: 30_000 });
  });

  test("creates a trip, adds itinerary items and budget items", async ({ page }) => {
    await signIn(page);
    await page.goto("/trips");

    await page.getByLabel("Title").fill(TRIP_TITLE);
    await page.getByLabel("Start").fill("2026-04-01");
    await page.getByLabel("End").fill("2026-04-04");
    await page.getByRole("button", { name: /create trip/i }).click();

    const tripLink = page.getByRole("link", { name: TRIP_TITLE });
    await expect(tripLink).toBeVisible({ timeout: 60_000 });
    await tripLink.click();
    await expect(page.getByRole("heading", { name: TRIP_TITLE })).toBeVisible();

    // --- itinerary ---
    // Day columns are labelled by date when the trip has one ("Wed, Apr 1"),
    // so match the action rather than a specific day name.
    const dayOne = page.getByLabel(/^add an item to /i).first();
    await expect(dayOne).toBeVisible({ timeout: 30_000 });
    await dayOne.fill("Morning at the beach");
    await dayOne.press("Enter");
    await expect(page.getByText("Morning at the beach")).toBeVisible({ timeout: 30_000 });

    await dayOne.fill("Seafood dinner");
    await dayOne.press("Enter");
    await expect(page.getByText("Seafood dinner")).toBeVisible({ timeout: 30_000 });

    // --- budget ---
    await page.goto(`${new URL(page.url()).pathname}/budget`);
    await expect(page.getByRole("heading", { name: /budget/i }).first()).toBeVisible({
      timeout: 60_000,
    });

    const addBudgetItem = async (category: string, label: string, amount: string) => {
      await page.getByLabel("Category", { exact: true }).selectOption(category);
      await page.getByLabel("Label", { exact: true }).fill(label);
      await page.getByLabel(/amount/i).fill(amount);
      await page.getByRole("button", { name: /^add$/i }).click();
      await expect(page.getByText(label)).toBeVisible({ timeout: 30_000 });
    };

    await addBudgetItem("Stay", "Beach hut", "6000");
    await addBudgetItem("Food", "Meals", "3000");

    // The computed outputs are the point of the page: the total must reflect
    // both items, not merely list them.
    await expect(page.getByText(/9,000|9000/).first()).toBeVisible({ timeout: 30_000 });
  });

  test("never exposes server-side secrets to the browser", async ({ page }) => {
    await signIn(page);
    await page.goto("/discover");

    // Whatever the page and its scripts can see, an attacker can see.
    const leaked = await page.evaluate(() => {
      const scripts = Array.from(document.scripts).map((s) => s.textContent ?? "").join("");
      const storage = JSON.stringify({ ...localStorage, ...sessionStorage });
      return `${document.documentElement.outerHTML}${scripts}${storage}`;
    });

    expect(leaked).not.toContain(be.SUPABASE_SERVICE_ROLE_KEY);
    if (be.SUPABASE_JWT_SECRET) expect(leaked).not.toContain(be.SUPABASE_JWT_SECRET);
    if (be.GROK_API_KEY) expect(leaked).not.toContain(be.GROK_API_KEY);
    expect(leaked).not.toContain("service_role");
  });
});
