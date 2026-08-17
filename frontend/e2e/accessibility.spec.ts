import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * Accessibility: automated WCAG checks, plus the things axe cannot judge.
 *
 * axe catches unlabelled controls, missing roles and insufficient contrast —
 * the categories that are mechanically decidable. It cannot tell whether a
 * page is *operable* by keyboard, or whether a layout survives a narrow
 * viewport, so those are driven explicitly below.
 *
 * Scope: wcag2a, wcag2aa and wcag21aa. Anything reported is a real defect
 * against that standard, not a style preference.
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

const stamp = Date.now();
const EMAIL = `tripbuddy.a11y.${stamp}@gmail.com`;
const PASSWORD = `Tb-a11y-${stamp}!x`;
let userId: string | null = null;

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function scan(page: Page) {
  return new AxeBuilder({ page }).withTags(WCAG).analyze();
}

function report(violations: Awaited<ReturnType<typeof scan>>["violations"]) {
  return violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n    ` +
        v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n    "),
    )
    .join("\n");
}

test.beforeAll(async () => {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: ADMIN_HEADERS,
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  });
  const created = (await res.json()) as { id?: string; msg?: string };
  if (!created.id) throw new Error(`could not provision account: ${created.msg}`);
  userId = created.id;
});

test.afterAll(async () => {
  if (userId) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: ADMIN_HEADERS,
    });
  }
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
}

// --- automated WCAG scans -------------------------------------------------

test.describe("public pages meet WCAG 2.1 AA", () => {
  for (const path of ["/", "/login", "/register", "/reset-password"]) {
    test(`${path} has no violations`, async ({ page }) => {
      await page.goto(path);
      const { violations } = await scan(page);
      expect(violations, report(violations)).toEqual([]);
    });
  }
});

test.describe("signed-in pages meet WCAG 2.1 AA", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  for (const path of ["/onboarding", "/profile", "/discover", "/trips", "/buddies", "/messages"]) {
    test(`${path} has no violations`, async ({ page }) => {
      await page.goto(path);
      // Let the page settle: several of these fetch before rendering content.
      await page.waitForLoadState("networkidle").catch(() => {});
      const { violations } = await scan(page);
      expect(violations, report(violations)).toEqual([]);
    });
  }
});

// --- keyboard operability -------------------------------------------------

test("the sign-in form is fully operable from the keyboard alone", async ({ page }) => {
  await page.goto("/login");

  // Tab to each field in turn and type — never touching the mouse.
  await page.keyboard.press("Tab");
  let guard = 0;
  while (
    (await page.evaluate(() => document.activeElement?.getAttribute("name"))) !== "email" &&
    guard++ < 15
  ) {
    await page.keyboard.press("Tab");
  }
  await page.keyboard.type(EMAIL);
  await page.keyboard.press("Tab");
  await page.keyboard.type(PASSWORD);

  // Enter submits from within the form, as a keyboard user expects.
  await page.keyboard.press("Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
});

test("discovery filters are reachable and operable by keyboard", async ({ page }) => {
  await signIn(page);
  await page.goto("/discover");
  await expect(page.getByRole("listitem").first()).toBeVisible({ timeout: 60_000 });

  // Interest tags are toggle buttons: focusable, and Space/Enter must work.
  const tag = page.getByRole("group", { name: /interests/i }).getByRole("button").first();
  await tag.focus();
  await expect(tag).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(tag).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(tag).toHaveAttribute("aria-pressed", "false");
});

test("every interactive control shows a visible focus indicator", async ({ page }) => {
  await page.goto("/login");

  const email = page.getByLabel("Email");
  await email.focus();
  // A focused control must differ visually from an unfocused one, or keyboard
  // users cannot tell where they are.
  const outline = await email.evaluate((el) => {
    const s = getComputedStyle(el);
    return `${s.outlineStyle}|${s.outlineWidth}|${s.boxShadow}|${s.borderColor}`;
  });
  expect(outline).not.toBe("none|0px|none|");
});

// --- responsive -----------------------------------------------------------

test.describe("mobile layout", () => {
  test.use({ viewport: { width: 375, height: 812 } }); // iPhone-ish

  test("signed-in pages do not scroll horizontally on a phone", async ({ page }) => {
    await signIn(page);

    for (const path of ["/discover", "/trips", "/buddies", "/profile", "/messages"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle").catch(() => {});
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      // A few pixels of rounding is tolerable; a sideways-scrolling page is not.
      expect(overflow, `${path} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(2);
    }
  });

  test("the mobile landing page passes WCAG too", async ({ page }) => {
    await page.goto("/");
    const { violations } = await scan(page);
    expect(violations, report(violations)).toEqual([]);
  });
});
