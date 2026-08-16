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

Browsable API documentation (drf-spectacular) is served alongside the API:

| URL | What |
| --- | --- |
| `/api/docs/` | Swagger UI |
| `/api/redoc/` | ReDoc |
| `/api/schema/` | raw OpenAPI 3 document |

The pages themselves need no token, but the endpoints they describe do — paste a
Supabase access token into Swagger's **Authorize** box to use "Try it out".

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
