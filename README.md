# TripBuddy

Budget-first travel planning platform. Discover budget-fitting destinations,
find compatible travel buddies nearby, and plan a day-by-day itinerary together.

## Architecture (three free-tier units)

| Unit | Stack | Hosted on |
| --- | --- | --- |
| Backend API | Django 5.2 + DRF + GeoDjango, psycopg 3 | Render |
| Frontend | Next.js 16 (App Router) + TypeScript + Tailwind | Vercel |
| Data / platform | Supabase: Postgres + PostGIS, Auth, Realtime | Supabase |

Supabase Auth issues a JWT; Django re-verifies it on every request and maps it
to a local user. Authorization is enforced in DRF (primary) with Postgres
Row-Level Security guarding the tables the browser reads directly.

## Local development

Create the env files (never committed):

```bash
cp backend/.env.example backend/.env        # fill in DATABASE_URL + SUPABASE_* 
cp frontend/.env.local.example frontend/.env.local
```

### Backend

GeoDjango needs GDAL/GEOS/PROJ, so run it via Docker (the Dockerfile installs
them). Locally:

```bash
cd backend
python manage.py migrate
python manage.py runserver          # http://localhost:8000/api/health/
```

Tests (need a PostGIS database; CI uses `postgis/postgis`):

```bash
cd backend && pytest
```

### Frontend

```bash
cd frontend
npm install
npm run dev                          # http://localhost:3000
```

## Phase 1 — Authentication & Travel Profiles

- **Auth:** `apps/accounts/authentication.py` verifies the Supabase JWT
  (audience `authenticated`) and get-or-creates a `User` + `Profile` keyed by
  the Supabase `sub`. Set as the default DRF authentication class with
  `IsAuthenticated` as the default permission. Both Supabase signing models are
  supported, selected by the token's `alg`:
  - **ES256/RS256 (current default)** — verified against the project's public
    keys from `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`, cached and
    refetched on key rotation. No shared secret needed.
  - **HS256 (legacy)** — verified with `SUPABASE_JWT_SECRET`. That is the *JWT
    Secret*, not the service_role key; using the latter fails every request
    with 401.
- **Data model:** all eight models (`Profile`, `Destination`,
  `SavedDestination`, `Connection`, `Trip`, `TripCollaborator`,
  `ItineraryItem`, `BudgetItem`, `Message`) with GiST indexes on the point
  fields.
- **Authorization:** DRF permission classes (`apps/common/permissions.py`) plus
  per-user queryset scoping (`apps/common/querysets.py`); RLS migrations on
  `messaging_message` (participants-only) and `destinations_destination`
  (public read), and a lockdown migration that denies the browser roles direct
  access to every other table.
- **Profiles:** `ProfileViewSet` (`/api/profile/me/`) and an onboarding
  endpoint (`/api/profile/onboarding/`) that geocodes the typed city via
  Nominatim/OSM and stores **only** an approximate, rounded point. Exact
  coordinates are never exposed to other users.
- **Frontend:** register / login / password-reset / update-password pages
  (Supabase JS client), an onboarding stepper and a profile edit page, all with
  zod validation. `lib/api.ts` attaches the Supabase access token as a Bearer
  header on every API request.

Never expose exact coordinates to other users. Keep `SUPABASE_SERVICE_ROLE_KEY`
and `SUPABASE_JWT_SECRET` server-side only.
