# Deploying TripBuddy

Three separately hosted units:

| Unit | Host | What it is |
| --- | --- | --- |
| Backend API | Render | Django + DRF in Docker (GeoDjango needs GDAL, so Docker rather than a native runtime) |
| Frontend | Vercel | Next.js App Router |
| Database, Auth, Realtime | Supabase | Postgres + PostGIS |

**The order matters.** Each step needs a URL the previous one produces, and
getting it wrong gives symptoms that look like unrelated bugs — a frontend that
loads but whose every request fails CORS, or auth emails that send people to
`localhost`. Work top to bottom.

---

## 0. Before you start

Take a backup. See "Backing up production before a destructive migration" in
[../README.md](../README.md) — `pg_dump` must match the server major version,
and it needs the *session* pooler (port 5432), not the transaction pooler
(6543) that `DATABASE_URL` uses.

Have `backend/.env` open. Most values below are copied from it.

---

## 1. Render — the backend

Nothing else works without this: the frontend is a shell around this API.

1. **New + → Blueprint → connect the repo → branch `main`.** Render reads
   [`render.yaml`](../render.yaml).
2. Fill the variables it prompts for:

   | Variable | Where it comes from |
   | --- | --- |
   | `DJANGO_SECRET_KEY` | **Generate a new one**, do not reuse the dev value: `python -c "from django.core.management.utils import get_random_secret_key as k; print(k())"` |
   | `DATABASE_URL` | `backend/.env` — keep the transaction pooler port **6543** |
   | `SUPABASE_URL` | Supabase → Settings → API → Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` |
   | `SUPABASE_JWT_SECRET` | Supabase → Settings → API → JWT Secret. **Not** the service-role key — that is itself a JWT, and pasting it here fails every login with 401. Leave blank on projects that sign with asymmetric keys. |
   | `GROK_API_KEY` | your xAI key. Without it the AI itinerary endpoint returns 503 and nothing else is affected. |
   | `ALLOWED_HOSTS` | `<service>.onrender.com` (see step 2) |
   | `CORS_ALLOWED_ORIGINS` | leave blank until step 3 |

   `DEBUG`, `LLM_PROVIDER`, `LLM_BASE_URL` and `LLM_MODEL` are already set in
   the blueprint.

3. **Apply.** The first build takes 5–10 minutes; it installs GDAL/GEOS/PROJ.

### What the blueprint does, and the free-tier trade-off

`plan: free`, so no card is required. Two consequences:

* **Migrations run at container start**, not in a `preDeployCommand` — that is
  a paid-instance feature. See the `CMD` in
  [`backend/Dockerfile`](../backend/Dockerfile). `migrate` is idempotent, and
  if it fails the container does not start, which is deliberate: a
  half-migrated database serving traffic is worse than a failed deploy.
* **A free service sleeps after ~15 minutes idle**, and the next request pays a
  30–60s cold start. Warn anyone demoing, or load a page a minute beforehand.

Moving to `starter` (paid) reverses both: set `plan: starter`, put
`preDeployCommand: "python manage.py migrate --noinput"` back in `render.yaml`,
and drop `migrate` from the Dockerfile `CMD`.

## 2. Check the backend before going further

```bash
curl https://<service>.onrender.com/api/health/
# {"ok":true,"db":true}
```

`db: false` means `DATABASE_URL` is wrong. A `400 Bad Request` on every route
means `ALLOWED_HOSTS` does not contain the host Render actually assigned —
correct it and redeploy.

## 3. Vercel — the frontend

**Settings → Environment Variables**, for **Production and Preview**:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | the Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → `anon` |
| `NEXT_PUBLIC_API_URL` | the Render URL from step 2, **no trailing slash** |

Then **Deployments → ⋯ → Redeploy**. `NEXT_PUBLIC_*` values are inlined at
build time, so adding them without redeploying changes nothing.

Only `NEXT_PUBLIC_*` names belong here. `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_JWT_SECRET` and `GROK_API_KEY` are server-side only — anything
prefixed `NEXT_PUBLIC_` is shipped to the browser. `e2e/performance-security.spec.ts`
asserts none of them appear in the client bundle.

> Without these variables the site returns a bare `Internal Server Error` on
> every path. The proxy builds a Supabase client on every request, and
> `createServerClient(undefined, undefined)` throws before any routing happens.

## 4. Back to Render — CORS

Set `CORS_ALLOWED_ORIGINS` to the Vercel production URL (no trailing slash) and
save; Render redeploys. Until then the site loads and every API call fails.

## 5. Supabase — auth URLs

**Authentication → URL Configuration**: set **Site URL** to the Vercel domain
and add it under **Redirect URLs**. Otherwise sign-up confirmation and
password-reset links point at `localhost:3000`.

Note the free tier's transactional email is rate-limited to a handful of sends
per hour. It is enough for a demo, not for a cohort signing up at once.

## 6. Vercel — deployment protection

If the app should be publicly reachable, **Settings → Deployment Protection →
disable** for Production. Otherwise every visitor is redirected to a Vercel
login.

---

## Smoke test

```bash
API=https://<service>.onrender.com
SITE=https://<app>.vercel.app

curl -s $API/api/health/                       # {"ok":true,"db":true}
curl -s -o /dev/null -w '%{http_code}\n' $API/api/trips/    # 401 — closed by default
curl -s -o /dev/null -w '%{http_code}\n' $SITE/             # 200
curl -s -o /dev/null -D - -X OPTIONS $API/api/destinations/ \
  -H "Origin: $SITE" -H "Access-Control-Request-Method: GET" | grep -i access-control-allow-origin
```

The last one must echo your Vercel origin. If it is missing, step 4 is wrong.

Then, in a browser: register → confirm the email → onboard with a city →
`/discover` (filter, then sort by Nearby) → create a trip → add an itinerary
item → add a budget item.

## Migrations

They run automatically at container start. To run them by hand:

```bash
# Render dashboard → your service → Shell
python manage.py migrate --noinput
python manage.py showmigrations | grep '\[ \]'   # anything unapplied
```

## Demo data

```bash
python manage.py seed_pilot          # 100 fictitious records
python manage.py seed_pilot --undo   # remove them
```

It refuses to run when `DEBUG` is off unless `--force` is passed. Think before
using `--force`: it writes fictitious users into whatever `DATABASE_URL` points
at.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Bare `Internal Server Error` on every path | Vercel env vars missing (step 3) |
| `400 Bad Request` from the API | `ALLOWED_HOSTS` missing the Render host |
| Site loads, all data fails | `CORS_ALLOWED_ORIGINS` missing the Vercel origin |
| Every login 401s | `SUPABASE_JWT_SECRET` holds the service-role key |
| First request takes ~45s | Free instance cold start — expected |
| AI itinerary returns 503 | `GROK_API_KEY` unset |
| Auth emails link to localhost | Supabase Site URL not updated (step 5) |
| Confirmation email never arrives | Free-tier email rate limit |
