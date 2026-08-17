import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Performance and security budgets.
 *
 * Performance: every read, every write and the two PostGIS searches must
 * answer within 2s. Measured against a database holding the 100-record pilot
 * dataset, so the geo queries have something to scan rather than returning
 * instantly from an empty table.
 *
 * Security: the two secrets that must never reach a browser are the Supabase
 * service-role key (it bypasses RLS entirely) and the JWT secret (it would let
 * anyone mint a valid token). The checks look at what actually ships — the
 * rendered DOM, the script contents, web storage, and the built client bundle
 * on disk — rather than trusting that the code "looks server-side".
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
const fe = readEnv(".env.local");
const SUPABASE_URL = be.SUPABASE_URL;
const SERVICE_KEY = be.SUPABASE_SERVICE_ROLE_KEY;
const API = process.env.E2E_API_URL ?? "http://localhost:8010";
const ADMIN_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

const BUDGET_MS = 2000;

const stamp = Date.now();
const EMAIL = `tripbuddy.perf.${stamp}@gmail.com`;
const PASSWORD = `Tb-perf-${stamp}!x`;
let userId: string | null = null;
let token = "";

async function timed(label: string, fn: () => Promise<Response>) {
  const started = Date.now();
  const res = await fn();
  const ms = Date.now() - started;
  return { label, ms, status: res.status, body: await res.json().catch(() => null) };
}

const authed = (path: string, init: RequestInit = {}) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

test.beforeAll(async () => {
  const created = await (
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
    })
  ).json();
  userId = created.id;

  const session = await (
    await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: fe.NEXT_PUBLIC_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    })
  ).json();
  token = session.access_token;

  // Give the account an area so the proximity searches have an origin.
  await authed("/api/profile/onboarding/", {
    method: "POST",
    body: JSON.stringify({
      display_name: "Perf Tester",
      age_band: "24-26",
      gender: "prefer_not_to_say",
      languages: ["english"],
      interests: ["beach", "food"],
      budget_style: "mid",
      daily_budget: 2000,
      city: "Bengaluru",
    }),
  });
});

test.afterAll(async () => {
  if (userId) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: ADMIN_HEADERS,
    });
  }
});

// --- performance ---------------------------------------------------------

test("reads answer within the 2s budget", async () => {
  const results = [
    await timed("GET /api/destinations/", () => authed("/api/destinations/")),
    await timed("GET /api/trips/", () => authed("/api/trips/")),
    await timed("GET /api/profile/me/", () => authed("/api/profile/me/")),
    await timed("GET /api/connections/", () => authed("/api/connections/")),
    await timed("GET /api/messages/summary/", () => authed("/api/messages/summary/")),
  ];

  for (const r of results) {
    console.log(`  ${r.label.padEnd(32)} ${String(r.ms).padStart(5)}ms  (${r.status})`);
    expect(r.status, r.label).toBeLessThan(400);
    expect(r.ms, `${r.label} took ${r.ms}ms`).toBeLessThan(BUDGET_MS);
  }
});

test("the PostGIS searches answer within the 2s budget", async () => {
  const results = [
    // Nearby destinations: dwithin + Distance against the seeded catalogue.
    await timed("GET /api/destinations/nearby/", () =>
      authed("/api/destinations/nearby/?lat=12.97&lng=77.59&radius_km=500"),
    ),
    // Buddy search: dwithin, then the whole compatibility score in Python
    // over every candidate the radius admits.
    await timed("GET /api/buddies/", () => authed("/api/buddies/?radius_km=500")),
    await timed("GET /api/buddies/ (2000km)", () => authed("/api/buddies/?radius_km=2000")),
  ];

  for (const r of results) {
    const count = Array.isArray(r.body) ? r.body.length : r.body?.count ?? "n/a";
    console.log(`  ${r.label.padEnd(32)} ${String(r.ms).padStart(5)}ms  (${r.status}, ${count} rows)`);
    expect(r.status, r.label).toBeLessThan(400);
    expect(r.ms, `${r.label} took ${r.ms}ms`).toBeLessThan(BUDGET_MS);
  }
});

test("writes answer within the 2s budget", async () => {
  const create = await timed("POST /api/trips/", () =>
    authed("/api/trips/", {
      method: "POST",
      body: JSON.stringify({ title: `Perf trip ${stamp}`, start_date: "2026-05-01", end_date: "2026-05-04" }),
    }),
  );
  expect(create.status).toBe(201);
  const tripId = create.body.id;

  const results = [
    create,
    await timed("POST /api/itinerary-items/", () =>
      authed("/api/itinerary-items/", {
        method: "POST",
        body: JSON.stringify({ trip: tripId, day_index: 0, position: 0, title: "Perf item" }),
      }),
    ),
    await timed("POST /api/budget-items/", () =>
      authed("/api/budget-items/", {
        method: "POST",
        body: JSON.stringify({ trip: tripId, category: "Food", label: "Perf", amount: "100" }),
      }),
    ),
    await timed("GET budget-summary", () => authed(`/api/trips/${tripId}/budget-summary/`)),
    await timed("PATCH /api/trips/{id}/", () =>
      authed(`/api/trips/${tripId}/`, {
        method: "PATCH",
        body: JSON.stringify({ title: `Perf trip ${stamp} (edited)` }),
      }),
    ),
  ];

  for (const r of results) {
    console.log(`  ${r.label.padEnd(32)} ${String(r.ms).padStart(5)}ms  (${r.status})`);
    expect(r.status, r.label).toBeLessThan(400);
    expect(r.ms, `${r.label} took ${r.ms}ms`).toBeLessThan(BUDGET_MS);
  }
});

// --- security ------------------------------------------------------------

test("no server-side secret reaches the browser", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });

  // Collect every script the browser actually fetched, plus the DOM and storage.
  const fetched: string[] = [];
  page.on("response", async (res) => {
    if (res.url().endsWith(".js") || res.request().resourceType() === "script") {
      fetched.push(await res.text().catch(() => ""));
    }
  });

  for (const path of ["/discover", "/trips", "/buddies", "/profile"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle").catch(() => {});
  }

  const inPage = await page.evaluate(() => {
    const scripts = Array.from(document.scripts).map((s) => s.textContent ?? "").join("");
    return `${document.documentElement.outerHTML}${scripts}${JSON.stringify({
      ...localStorage,
      ...sessionStorage,
    })}`;
  });

  const everything = inPage + fetched.join("");
  const secrets: [string, string][] = [
    ["SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY],
    ["SUPABASE_JWT_SECRET", be.SUPABASE_JWT_SECRET],
    ["GROK_API_KEY", be.GROK_API_KEY],
    ["DJANGO_SECRET_KEY", be.DJANGO_SECRET_KEY],
  ];

  for (const [name, value] of secrets) {
    if (!value) continue;
    expect(everything, `${name} leaked to the browser`).not.toContain(value);
  }

  // Any privileged token would be a JWT whose payload claims the service role.
  // Decode what is actually present rather than grepping for the string
  // "service_role": @supabase/auth-js mentions that role name in its own
  // source, so a substring match reports the library and not a leak.
  const jwts = everything.match(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g) ?? [];
  const privileged = jwts.filter((jwt) => {
    try {
      const payload = JSON.parse(
        Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"),
      ) as { role?: string };
      return payload.role === "service_role";
    } catch {
      return false;
    }
  });
  expect(privileged, "a service-role token was served to the browser").toEqual([]);

  // The anon key is public by design and is expected to be here; assert it is,
  // so this test cannot pass simply because nothing was collected.
  expect(everything, "collected nothing — the test would pass vacuously").toContain(
    fe.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
});

test("the built client bundle contains no server-side secret", async () => {
  // Belt and braces: the running page might simply not have loaded the chunk
  // that leaks. Grep the whole build output instead.
  const root = join(process.cwd(), ".next");
  const found: string[] = [];
  const secrets = [SERVICE_KEY, be.SUPABASE_JWT_SECRET, be.GROK_API_KEY].filter(Boolean);

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        // server/ is never shipped to a browser; static/ is.
        if (entry !== "cache" && entry !== "server") walk(full);
      } else if (/\.(js|json|txt|map)$/.test(entry) && st.size < 20_000_000) {
        const text = readFileSync(full, "utf8");
        if (secrets.some((s) => text.includes(s))) found.push(full);
      }
    }
  };

  try {
    walk(root);
  } catch {
    test.skip(true, "no .next build output to scan");
  }
  expect(found, `secrets found in client build output: ${found.join(", ")}`).toEqual([]);
});

test("every endpoint validates its input", async () => {
  const cases: [string, string, unknown, number][] = [
    ["POST", "/api/trips/", { title: "" }, 400],
    ["POST", "/api/trips/", { title: "x".repeat(500) }, 400],
    ["POST", "/api/budget-items/", { trip: 999999, category: "Food", label: "x", amount: "1" }, 400],
    ["POST", "/api/budget-items/", { category: "NotACategory", label: "x", amount: "1" }, 400],
    ["POST", "/api/itinerary-items/", { trip: 999999, title: "x" }, 400],
    ["POST", "/api/connections/", { supabase_user_id: "not-a-uuid" }, 400],
    ["POST", "/api/profile/onboarding/", { display_name: "" }, 400],
  ];

  for (const [method, path, body, expected] of cases) {
    const res = await authed(path, { method, body: JSON.stringify(body) });
    expect(res.status, `${method} ${path} with ${JSON.stringify(body)}`).toBe(expected);
  }
});

test("query parameters are validated, not silently ignored", async () => {
  for (const path of [
    "/api/buddies/?radius_km=0",
    "/api/buddies/?radius_km=abc",
    "/api/buddies/?gender=wizard",
    "/api/buddies/?age_band=200-300",
    "/api/connections/?direction=sideways",
    "/api/connections/?status=maybe",
  ]) {
    const res = await authed(path);
    expect(res.status, `${path} should be rejected`).toBe(400);
  }
});
