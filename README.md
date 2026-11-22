# TripBuddy

Budget-first travel planning platform. Discover budget-fitting destinations,
find compatible travel buddies nearby, and plan a day-by-day itinerary together.

## What you can do with it

- **Discover** destinations that fit a daily budget, filtered by region, state
  and interests, with distances from wherever you're travelling from.
- **Find travel buddies** near you, ranked by how well your travel styles,
  interests and budgets match.
- **Plan trips together**: a day-by-day itinerary board, a shared budget with
  UPI settle-up, a group chat, and an AI assistant that drafts plans.

## Getting started

You can run the whole app on your own computer in about 15 minutes. You need:

- [Git](https://git-scm.com/downloads)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (it runs
  the database, the backend and the frontend for you)
- A free [Supabase](https://supabase.com) account (it handles sign-up and
  login)

### 1. Get the code

```bash
git clone https://github.com/vathira-netizen/tripbuddy.git
cd tripbuddy
```

### 2. Create a Supabase project

1. In Supabase, click **New project** and wait for it to start.
2. Open **Project Settings → API** and keep that page open. You'll need the
   **Project URL** and the **anon / publishable key**.
3. Optional, for local testing: under **Authentication → Sign In / Providers →
   Email**, turn off **Confirm email**. You can then sign up without checking
   your inbox.

### 3. Add your settings

Copy the two example files. The copies hold your own keys and are already
listed in `.gitignore`, so Git will never upload them.

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Then edit the copies:

| File | Setting | Value |
| --- | --- | --- |
| `backend/.env` | `SUPABASE_URL` | your Supabase Project URL |
| `backend/.env` | `DJANGO_SECRET_KEY` | any long random string |
| `backend/.env` | `GROQ_API_KEY` *(optional)* | a free key from [Groq](https://console.groq.com/keys) to turn on the AI assistant; remove the `#` in front of the line |
| `frontend/.env.local` | `NEXT_PUBLIC_SUPABASE_URL` | your Supabase Project URL |
| `frontend/.env.local` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your Supabase anon / publishable key |
| `frontend/.env.local` | `NEXT_PUBLIC_API_URL` | `http://localhost:8000` |
| `frontend/.env.local` | `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` |

Leave everything else as it is. You don't need to change `DATABASE_URL`,
because step 4 starts a local database and points the backend at it.

### 4. Start the app

With Docker Desktop running:

```bash
docker compose -f docker-compose.yml -f docker-compose.localdb.yml up --build -d
```

The first run takes a few minutes to download and build everything. When it
finishes, add the destination catalogue and some sample travellers so the app
isn't empty:

```bash
docker compose -f docker-compose.yml -f docker-compose.localdb.yml exec backend python manage.py seed_destinations
docker compose -f docker-compose.yml -f docker-compose.localdb.yml exec backend python manage.py seed_pilot
```

### 5. Open it

Go to **http://localhost:3000**, create an account and complete your profile.

- To stop the app: `docker compose -f docker-compose.yml -f docker-compose.localdb.yml down`
- To start it again later: run the `up` command from step 4. Your data is kept.
- If you change `frontend/.env.local`, add `--build` to the `up` command. The
  frontend reads those settings when it's built.

### Troubleshooting

| Problem | Fix |
| --- | --- |
| Pages load but every action fails | Check that `NEXT_PUBLIC_API_URL` is `http://localhost:8000` and the backend is running: http://localhost:8000/api/health/ should say `"ok": true`. |
| Login fails or keeps sending you back to the login page | Check that `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL` are both your Project URL, then rebuild with `--build`. |
| "Assistant unavailable" | `GROQ_API_KEY` is missing or wrong in `backend/.env`. Everything else still works without it. |
| Port 3000 or 8000 is already in use | Stop the other program using it, or change the left-hand port number under `ports:` in `docker-compose.yml`. |

### Running without Docker

You'll need Python 3.13, Node.js 22, and GDAL/GEOS/PROJ installed for
GeoDjango. Set `DATABASE_URL` in `backend/.env` to a PostGIS database (for
example your Supabase project's connection string), then:

```bash
cd backend && pip install -r requirements.txt && python manage.py migrate && python manage.py runserver
cd frontend && npm install && npm run dev
```

Browsable API documentation is served at http://localhost:8000/api/docs/.
Backend tests need a PostGIS database (`cd backend && pytest`); frontend checks
are `npm run lint` and `npm run build`.

## Architecture (three free-tier units)

| Unit | Stack | Hosted on |
| --- | --- | --- |
| Backend API | Django 5.2 + DRF + GeoDjango, psycopg 3 | Render |
| Frontend | Next.js 16 (App Router) + TypeScript + Tailwind | Vercel |
| Data / platform | Supabase: Postgres + PostGIS, Auth, Realtime | Supabase |

Supabase Auth issues a JWT; Django re-verifies it on every request and maps it
to a local user. Authorization is enforced in DRF (primary) with Postgres
Row-Level Security guarding the tables the browser reads directly.

### How a request flows

```
browser ──JWT──> Django/DRF ──> Supabase Postgres        (everything except chat reads)
   │
   └──anon key + JWT──> Supabase Realtime ──> messaging_message   (chat reads only)
                                    guarded by RLS, per subscriber
```

Two paths reach the data, and they enforce the same rules independently:

* **Django** owns every write and almost every read. It connects as a
  privileged role and therefore *bypasses* RLS, so authorization lives in
  `apps/common/permissions.py` and `apps/common/querysets.py`.
* **The browser** reads new chat messages straight from Postgres over Realtime.
  Django is not involved, so Postgres itself decides: the RLS policy on
  `messaging_message` admits only conversations on the reader's own *accepted*
  connections. `apps/messaging/test_rls.py` tests that policy directly.

Two rules the code is arranged to keep:

* **Exact coordinates never leave the backend.** Profiles store a city centroid
  rounded to ~1.1 km, and other travellers see a place name plus a coarse
  distance bucket ("10–25 km"). The buddy serializer is a plain `Serializer`
  with an allow-list, not a `ModelSerializer` over a model with geometry, so
  there is no field path a coordinate could travel.
* **Secrets stay server-side.** `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_JWT_SECRET` and `GROK_API_KEY` are backend-only; the E2E suite
  greps the running page *and* the built client bundle to prove it.

### Repository layout

```
backend/         Django project (config/) + apps/
  apps/accounts       profiles, Supabase JWT auth, onboarding, seed_pilot
  apps/destinations   catalogue, proximity search, saved list
  apps/matching       buddy compatibility scoring (pure) + /api/buddies/
  apps/connections    buddy requests: send / accept / decline / block
  apps/messaging      chat API + the RLS policy behind Realtime
  apps/trips          trips, itinerary, sharing, AI itinerary generation
  apps/budgets        budget items + pure budget maths
  apps/common         permissions, queryset scoping, shared vocabularies
frontend/        Next.js App Router
  src/app            routes
  src/components     UI
  src/lib            API client, Supabase clients, domain helpers
  e2e                Playwright suites (see e2e/README.md)
docs/DEPLOY.md   deployment runbook
```

## Testing

| Command | What runs |
| --- | --- |
| `cd backend && pytest` | the backend suite (needs a PostGIS database) |
| `cd frontend && npm run lint` | ESLint |
| `cd frontend && npm run e2e` | Playwright: journey, accessibility, performance/security |

The backend suite covers the pure logic hardest — `apps/matching/compatibility.py`
and `apps/budgets/services.py` are both at 100% line coverage — plus
`apps/common/test_cross_user_access.py`, which attacks every user-scoped
endpoint from a second account, and `apps/messaging/test_rls.py`, which
exercises the RLS policy as the `authenticated` role.

The E2E suites need a running stack; see [frontend/e2e/README.md](frontend/e2e/README.md).
They enforce a 2s budget on every read, write and PostGIS search, and scan for
leaked secrets.

## Demo data

```bash
cd backend
python manage.py seed_destinations   # 36-destination catalogue
python manage.py seed_pilot          # 100 fictitious profiles/connections/trips
python manage.py seed_pilot --undo   # remove them
```

`seed_pilot` is idempotent — identity and randomness are both derived from a
stable per-record seed, so re-running updates the same rows and a given pilot
traveller keeps the same interests and city. It refuses to run when `DEBUG` is
off unless `--force` is passed.

## Deployment

See [docs/DEPLOY.md](docs/DEPLOY.md). The ordering matters: Render first,
then Vercel, then back to Render for CORS, then Supabase auth URLs.

## Backing up production before a destructive migration

Take a dump **and restore it somewhere** before running anything that drops or
rewrites data. An unverified dump is not a backup.

Two things make this fiddly, both worth knowing before you need it in a hurry:

* `pg_dump` must match the server major version (Supabase is on **17**); an
  older client refuses outright.
* `DATABASE_URL` points at the **transaction** pooler on `6543`, which
  `pg_dump` cannot use. Swap the port to `5432` — the same host's session
  pooler — for the dump only.

```bash
# URL with the port swapped to 5432 (session pooler)
SESSION_URL="postgresql://USER:PASSWORD@aws-0-<region>.pooler.supabase.com:5432/postgres"
TS=$(date -u +%Y%m%dT%H%M%SZ)

# Application data
docker run --rm -e PGURL="$SESSION_URL" -v /path/to/backups:/backup postgres:17-alpine \
  pg_dump "$PGURL" --format=custom --no-owner --no-privileges \
  --schema=public --file=/backup/tripbuddy-$TS.dump

# Supabase Auth users — a separate schema, and NOT covered by the dump above.
# Without it a restore leaves every Profile pointing at a user that no longer
# exists, since Profile.supabase_user_id references auth.users.
docker run --rm -e PGURL="$SESSION_URL" -v /path/to/backups:/backup postgres:17-alpine \
  pg_dump "$PGURL" --format=custom --no-owner --no-privileges \
  --schema=auth --file=/backup/tripbuddy-auth-$TS.dump
```

Verify by restoring into a throwaway container and comparing row counts:

```bash
docker run -d --name tb-restore -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=restored postgis/postgis:17-3.5
docker cp tripbuddy-$TS.dump tb-restore:/tmp/b.dump
docker exec tb-restore psql -U postgres -d restored -c 'CREATE EXTENSION IF NOT EXISTS postgis;'
docker exec tb-restore pg_restore -U postgres -d restored --no-owner --no-privileges /tmp/b.dump
```

`CREATE POLICY` statements fail on a plain container because the `anon` and
`authenticated` roles only exist on Supabase. That is expected — the policies
*are* in the dump and restore fine onto a real Supabase target. Every other
error is a genuine problem with the backup.

Backups contain real user data. Keep them outside the repository.

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

## Phase 4 — Travel-buddy matching & connections

- **Scoring** (`apps/matching/compatibility.py`) is a transparent weighted sum
  of six components, each normalised to 0–1. **No trained model**; the whole
  rule is one pure, database-free module you can read top to bottom:

  | | Component | Weight |
  | --- | --- | --- |
  | `G` | proximity, linear falloff to the radius | 0.20 |
  | `J` | Jaccard overlap of interests | 0.30 |
  | `B` | budget style, partial credit for adjacent tiers | 0.20 |
  | `L` | Jaccard overlap of languages | 0.15 |
  | `A` | age band: 1.0 same, 0.5 adjacent, else 0 | 0.10 |
  | `D` | shared target destination (a boost) | 0.05 |

  Weights sum to 1.0 so `combine()` returns a plain 0–100 — enforced at startup
  by `MatchingConfig.ready()`. Missing data scores 0 rather than raising, since
  half-finished profiles are normal. `explain()` returns the top reasons as
  chips; `D` is pinned because its weight is smallest but it is the most
  informative signal when present.
- **Retrieval** (`apps/matching/services.py`): PostGIS does the narrowing and
  the measuring (`area_point__dwithin` on the GiST index + a `Distance`
  annotation) — there is no Python distance math. Excludes yourself, anyone not
  onboarded, anyone with no area, and everyone already connected in any state.
- **API:** `GET /api/buddies/?radius_km=&gender=&age_band=&destination=` returns
  ranked candidates. Default radius 150 km, tunable per environment with
  `MATCH_DEFAULT_RADIUS_KM`.
- **Privacy:** a candidate payload carries `area_label` and a coarse
  `distance_bucket` ("10–25 km") and nothing else locational. The exact distance
  is a sort key that never leaves the backend, and buckets are deliberately wide
  so repeated searches cannot trilaterate anyone. Asserted by tests.
- **Connections:** `POST /api/connections/` then `accept` / `decline` / `block`
  (and `unblock`, restricted to whoever blocked). Blocking is the hard stop — it
  prevents further requests from both sides, hides the pair from matching, and
  revokes messaging via `can_message()`, the predicate Phase 7 must consult.
- **Frontend:** `/buddies` — radius selector plus gender / age / destination
  filters held in the URL, candidate cards with avatar, approximate area,
  distance bucket, score meter and explanation chips, and an incoming-requests
  panel with accept / decline / block.

## Phase 7 prerequisites — messaging

- **Gating:** `apps.connections.views.can_message(user, other)` is the single
  predicate for "may these two exchange messages?" — true only on an `accepted`
  connection. Blocking sets the status away from `accepted`, so it revokes
  messaging with no extra check anywhere.
- **Model + RLS:** `messaging_message` has RLS enabled, no grants to `anon`, and
  `SELECT` only for `authenticated` through the
  `messaging_message_select_participants` policy.
- **Reads are gated on `accepted` too** (migration `0003`). The original policy
  only checked *participation*, which was weaker than the API rule: a blocked
  traveller kept live read access to the conversation history through Realtime.
  The policy now calls `tripbuddy_can_read_connection`, which requires
  `status = 'accepted'`, so a block revokes reading on the next query without any
  application code running.
- **Realtime** is enabled by migration `0004`, which adds the table to the
  `supabase_realtime` publication. It is a migration rather than a dashboard
  click so a fresh Supabase project is correct by construction — a project
  missing it looks fine and silently delivers nothing. Realtime evaluates the
  SELECT policy per subscriber, so the RLS rule above is what a subscriber gets.

### Phase 7 — real-time messaging

- **Write path (Django):** `GET`/`POST /api/connections/{id}/messages/`, plus
  `POST .../messages/read/` and `GET /api/messages/summary/` for the badges.
  Every one refuses unless the connection is `accepted` and the caller is one of
  its two participants — and refuses *identically* whether the thread is
  missing, someone else's, or blocked, so a refusal never confirms a block.
- **Read path (Realtime):** the client subscribes to INSERTs on
  `messaging_message` filtered by `connection_id`. The filter narrows what is
  asked for; the RLS policy is what makes it safe, and Postgres applies it per
  subscriber. `apps/messaging/test_rls.py` builds a Supabase-shaped database
  (an `auth.uid()` shim and the browser roles), applies the real migration SQL
  and queries *as the `authenticated` role* — so the policy's behaviour is
  tested, not just its text.
- **Pagination:** page 1 is the newest 30 messages, ordered oldest-to-newest
  within the page, and `next` walks backwards into history. A chat wants the
  tail first but rendered with the newest at the bottom.
- **XSS:** bodies are stored exactly as typed and never HTML-escaped on the way
  in — escaping on input would store `&lt;` forever and double-escape
  downstream. Escaping happens at render, where React escapes any interpolated
  string. Never pass a body to `dangerouslySetInnerHTML`. What *is* rejected on
  input is dangerous regardless of rendering: control characters, Unicode
  bidirectional overrides (the "Trojan Source" trick, which makes a message
  display differently from what is stored), and anything over 2000 characters.

### TBD-5 — notification mechanism: **in-app only**

In-app only for now, with email deliberately deferred rather than ruled out.

- There is no email infrastructure to build on: no `EMAIL_BACKEND`, no provider
  dependency, no verified sending domain. Adding it means a provider account and
  SPF/DKIM setup — real scope, not a flag.
- Supabase's built-in email is for auth and is rate-limited on the free tier
  (single-digit sends per hour). It cannot carry chat notifications.
- Realtime already delivers instantly while the app is open. Email only adds
  value for *offline* users, and doing that acceptably needs digesting and
  quiet-hours logic — one email per message is unacceptable. That is a feature,
  not a switch.
- Email leaks activity patterns into an inbox, which sits badly beside the
  privacy stance the rest of the app takes with location.
- Reliable sending needs a queue and worker; the backend runs on a single
  free-tier web service with neither.

To keep the door open, model notifications as **stored records with a delivery
channel**, plus a per-user preference — then adding email later is a new
delivery adapter over the same records, not a redesign. Do not scatter
`send_mail` calls through the message-create path.

Never expose exact coordinates to other users. Keep `SUPABASE_SERVICE_ROLE_KEY`
and `SUPABASE_JWT_SECRET` server-side only.

## License

TripBuddy is released under the [MIT License](LICENSE).
