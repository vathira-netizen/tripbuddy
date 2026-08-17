# End-to-end tests

Three suites, all driving a real browser against a real stack:

| File | What it covers |
| --- | --- |
| `journey.spec.ts` | register → onboarding → discovery (filter + nearby) → trip → itinerary → budget |
| `accessibility.spec.ts` | WCAG 2.1 AA scans of 10 pages, keyboard operability, focus visibility, mobile layout |
| `performance-security.spec.ts` | the 2s budget for reads/writes/geo searches, secret leakage, input validation |

Only the **database** is a throwaway. Next.js, Django and Supabase Auth are
all real, because the things worth catching here — a Leaflet icon that breaks
the discovery page, an unlabelled select, a 48px mobile overflow — only appear
in a real browser against a real server.

## Running them

The suites need three processes. From the repository root:

```bash
# 1. A throwaway PostGIS database
docker network create tb-e2e
docker run -d --name tb-e2e-db --network tb-e2e -p 5440:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=tripbuddy postgis/postgis:16-3.4

# 2. Django against it, using the real Supabase project for JWT verification
docker build -t tripbuddy-backend:local -f backend/Dockerfile backend
docker run -d --name tb-e2e-api --network tb-e2e -p 8010:8000 \
  -e DATABASE_URL="postgresql://postgres:postgres@tb-e2e-db:5432/tripbuddy" \
  -e DJANGO_SECRET_KEY=e2e-only -e DEBUG=True \
  -e ALLOWED_HOSTS=localhost,127.0.0.1 \
  -e CORS_ALLOWED_ORIGINS=http://localhost:3010 \
  -e SUPABASE_URL="https://<project>.supabase.co" \
  tripbuddy-backend:local

docker exec tb-e2e-api python manage.py seed_destinations
docker exec tb-e2e-api python manage.py seed_pilot   # gives the geo searches something to scan

# 3. The frontend, pointed at that API
cd frontend
NEXT_PUBLIC_API_URL=http://localhost:8010 npm run dev -- -p 3010
```

Then:

```bash
npm run e2e              # all suites
npm run e2e:journey      # the user journey only
npm run e2e:a11y         # accessibility only
npm run e2e:perf         # performance and security only
npm run e2e:ui           # interactive, for debugging a failure
```

Tear down with `docker rm -f tb-e2e-api tb-e2e-db && docker network rm tb-e2e`.

## Two things to know

**Real Supabase auth users are created.** Each suite provisions accounts
(`tripbuddy.e2e.*`, `tripbuddy.a11y.*`, `tripbuddy.perf.*`) and deletes them in
`afterAll`. If a run is killed mid-way, they survive — list and remove them
through the Supabase admin API before they accumulate. Application rows live in
the throwaway database and disappear with the container.

**Registration cannot complete purely through the UI.** The project requires
email confirmation and a test has no inbox, so `journey.spec.ts` submits the
real form and then confirms the address through the admin API. That is the only
shortcut. The suite annotates which path a run actually took, because
Supabase's free-tier email quota sometimes refuses the form outright — in which
case only the form's client-side behaviour was exercised, and the annotation
says so rather than implying coverage that did not happen.
