# Mindtrip-style features for TripBuddy — implementation plan

Source: [mindtrip-exploration.md](mindtrip-exploration.md). The goal is to
rebuild Mindtrip's *interaction patterns* (chat-first planning, linked
chat/map/cards/trip, ideas shelf) on TripBuddy's own stack, branding, copy
and data. We keep what makes TripBuddy different: budget-first, every AI plan
budget-checked on the server, buddy matching, India-only catalogue, no
bookings or payments.

Stack: Django REST + GeoDjango (backend), Next.js 16 + Tailwind + Leaflet
(frontend), Supabase Postgres. LLM calls stay in
`backend/apps/trips/ai_service.py` behind `call_llm` (tests monkeypatch it).

Phases are ordered by value for effort. Each one ships on its own.

---

## Phase A — Chat becomes a real conversation (core)

Today: `POST /api/trips/{id}/ask/` answers one question at a time, tied to an
existing trip, and the panel lives inside the trip page.

**Target:** a standalone chat at `/chat/[id]` with history, a map of the
places mentioned, context chips, and "Create trip".

### Backend (`apps/trips` — new `Conversation`, `ChatMessage` models)

- **`Conversation`:**
  - `owner` (FK user)
  - `trip` (FK, nullable)
  - `title` (auto-generated)
  - `context` (JSON: `destination`, `days`, `travellers`, `budget`)
  - timestamps
- **`ChatMessage`:**
  - `conversation` (FK)
  - `role` (`user` or `assistant`)
  - `content` (text)
  - `data` (JSON: `places`, `plan`, `follow_up`)
  - `created_at`
- **Migration**, plus an RLS policy matching the existing pattern (`0002_*_rls`).
- **Endpoints** (owner-only, same permission style as trips):
  - `POST /api/chats/` with `{message, trip?}`: create a conversation and
    get the first reply.
  - `GET /api/chats/`: the list for the drawer.
  - `GET /api/chats/{id}/`: the conversation with its messages.
  - `POST /api/chats/{id}/messages/` with `{message}`: get the next reply.
  - `PATCH /api/chats/{id}/` with `{title}`: rename.
- **`ai_service.chat_reply(conversation, message)`**, extending `ask_assistant`:
  - It passes the last ~10 messages as history. `call_llm` gets a
    `messages` list instead of a single prompt.
  - It asks for JSON with these fields:
    - `answer`: markdown.
    - `context`: `{destination, days, travellers, budget}`, the values pulled
      out of the conversation.
    - `places`: destination **slugs from our catalogue only**. They are
      validated against `Destination` and unknown slugs are dropped.
    - `plan`: optional, and budget-checked with `validate_budget` as today.
    - `follow_up`: one clarifying question.
  - The `title` is set from the first reply.
- **Tests**, using recorded LLM responses as `tests.py` already does:
  - History is passed through.
  - Unknown slugs are dropped.
  - Plans are still flagged over budget.
  - A missing key returns 503.

### Frontend

- **`src/app/chat/[id]/page.tsx`** (split view):
  - **Left:** the message list, with the input pinned at the bottom.
  - **Right:** `DestinationMap` showing the `places` from every assistant
    message (reuse the existing component).
  - **Header:**
    - The editable title.
    - **Context chips** (destination · days · travellers · budget) from
      `conversation.context`.
    - A **"Create trip"** button.
- **`src/app/chat/page.tsx`** (`/chat`): the new-chat empty state with
  suggestion chips such as "Weekend under ₹5,000 from Bengaluru".
- **Assistant message rendering:**
  - Markdown: add `react-markdown` (small, the one new dependency).
  - The plan box from `TripAssistantPanel` (total, over-budget state,
    disclaimer).
  - A horizontal **destination card carousel** for `places`, linking to
    `/discover/[slug]`, with a "+" for Add to trip.
  - The `follow_up` question shown as a clickable chip that sends it.
- **"Create trip" modal:**
  - Free-text notes plus Where / When / Who / Budget rows, **pre-filled from
    the chips**.
  - It calls the existing `POST /api/trips/`, then `apply-itinerary` if the
    last reply had a plan, and links the conversation to the trip.
- **Chats drawer in the nav:** search, New chat, and the list of past chats
  with their trip name.
- **`TripAssistantPanel`** becomes a thin wrapper that opens or continues the
  trip's conversation.
- **Loading state:** a "thinking…" bubble. Add streaming later, and only if
  the provider supports it cheaply.

**Done when:** you can ask "3 days in Hampi under ₹5,000?", follow up with
"make it cheaper", see Hampi pinned on the map, and click Create trip to get a
trip with that plan on the board.

---

## Phase B — Chat-first home page

**Target:** `/` (when signed in) becomes a planning home instead of jumping
straight to Discover.

- **`src/app/page.tsx`** (signed in), with these parts:
  - **A greeting** and a large "Ask TripBuddy" input. Submitting creates a
    chat (Phase A).
  - **Category pills: Stays, Transport, Food, Things to do, Trips.** Each
    opens one shared `RequestModal`:
    - A prompt box.
    - Where (destination select from our catalogue), When (dates), Who
      (number of people), and Budget (₹).
    - Submitting composes a message and starts a chat.
  - **Four action cards:**
    - **Plan a trip** opens `RequestModal` set to trip.
    - **Find a travel buddy** goes to `/buddies`.
    - **Where can I go on my budget?** goes to `/discover?sort=budget`.
    - **Continue your trip** opens your most recent trip.
- **`Nav.tsx`** gets a **Home** link and a **Chats** drawer button.

**Done when:** each pill and card leads somewhere useful, with no dead ends.

---

## Phase C — Explore with a detail side panel

Today, `/discover` has filters, a map and cards, and `/discover/[slug]` is a
separate page.

- **Clicking a card** opens a **side panel over the map**, driven by
  `?ref=<slug>` in the URL. The full page stays for direct links.
- **Panel layout:**
  - **Header actions:** close, Save (existing `SavedDestination`), **Add to
    trip**, and Share (copy link).
  - **Photo mosaic** from `image_url` plus `image_urls`.
  - **Tabs:**
    - Overview: description, best season, typical daily spend, interests,
      state.
    - Reviews: the existing `DestinationReview`.
    - Location: a mini map, plus a distance from your starting city
      (FR-16).
  - **Suggested questions**, generated client-side from the destination's
    data. Examples: "Is ₹{avg×3} enough for 3 days in {name}?" and "Best
    time to visit {name}?". Clicking one starts a chat with that question.
  - **"Book" links** to IRCTC, RedBus and Hostelworld, reusing the trip
    page's booking hand-off. No in-app booking.
- **"+" button on every destination card** opens the **Add-to-trip popover**:
  - Pick an existing trip or create one.
  - A toast confirms with a "Change trip" undo.
- **Map:** cluster markers when zoomed out, and a collapse toggle for the map.

**Optional extension:** points of interest inside a destination (temples,
cafés, stays) need a new `Place` model and a seed CSV. That is a large data
task, so do it only if time allows.

---

## Phase D — Trip page: Ideas shelf, tabs, preferences

- **Ideas shelf:**
  - Allow `ItineraryItem.day_index` to be **null**, meaning an unscheduled
    idea (migration plus serializer).
  - The board shows an **Ideas** row above Day 1, and you drag ideas into a
    day with the existing dnd-kit.
  - "Add to trip" from Explore and from chat cards lands items in Ideas.
- **Tabs on `/trips/[id]`:**
  - Itinerary (the board).
  - Budget (move the existing budget page in).
  - Calendar (a read-only day × hour grid built from items with times; add
    an optional `start_time` field).
  - Chats (the conversations linked to this trip).
  - Buddies (collaborators and join requests, which already exist).
- **Trip preferences:**
  - A `Trip.preferences` text field (diet, pace, accessibility), edited in a
    small modal.
  - Included in the assistant's context.
- **Header chips:** destination · nights · travellers · budget · Preferences.

---

## Phase E — Saved collections and Updates

- **Collections:**
  - A `Collection` model (owner, name) with M2M to `Destination`.
  - `/discover/saved` gets two tabs: Places (today's list) and Collections.
  - Save offers "Add to collection".
- **Updates drawer:**
  - Built from data we already have: new buddy requests, accepted
    connections, unread messages, trip join requests and invites.
  - Tabs All and Actions, plus an unread toggle.
  - No new notification model at first: compute the feed from existing
    tables, and add a `Notification` table only if it gets slow.

---

## Phase F (optional) — Community guides

- **`Guide` model:** author, title, destination, body (markdown) and an
  ordered list of destinations or places.
- **`/guides` list:** search by destination or author.
- **Guide page:** the cover, an Overview tab, a Places tab with a map, and
  "Plan a trip from this guide", which starts a chat with the guide as
  context.
- **This is a large piece.** Only do it after A–E.

---

## Phase G — Booking tracker, receipt scanning, UPI settle-up (all free)

TripBuddy still makes no bookings and handles no money itself. Check this
scope with the project guide before building, because the abstract says
"no payments or bookings".

- **Booking tracker:**
  - A `Booking` model with: trip (FK), kind (train / bus / flight / stay /
    activity / other), provider, reference (PNR or confirmation number),
    start and end datetime, amount, an optional attachment, and
    `added_by`.
  - CRUD at `/api/bookings/`, restricted to trip members, with tests.
  - A **Bookings** tab on the trip page. Each booking shows on its day in
    the itinerary and calendar, and can optionally create a matching budget
    item.
  - The booking hand-off links (IRCTC, RedBus, Hostelworld) sit beside an
    "I booked it, add it here" action.
- **Receipt scanning:**
  - Upload an image or PDF to a Supabase Storage bucket (free tier).
    Access is limited by RLS to trip members, with a 5 MB limit and
    image/PDF types only.
  - Extract the amount, date and vendor: in the browser with
    `tesseract.js` (free), or on the server through the existing LLM seam.
  - Show an editable "Add as expense" form pre-filled with what was
    extracted. **Nothing is saved without the user confirming.**
  - A Receipts list on the trip, with each receipt linked to its budget
    item.
- **UPI settle-up:**
  - A `upi_id` field on Profile (optional, validated as `name@bank`).
  - On `SettleUpPanel`, each "A owes B ₹X" row gets a **Pay with UPI**
    button. It uses a `upi://pay?pa=<id>&pn=<name>&am=<X>&cu=INR&tn=TripBuddy
    <trip>` deep link, which opens the payer's UPI app on mobile. On desktop
    it shows a QR code of the same link (needs one small QR library).
  - "Mark as paid" records a `Settlement` (payer, payee, amount, trip,
    date) and updates the balances.
  - No gateway, no fees, and no money passes through TripBuddy.

## Out of scope (deliberately)

- **Real bookings, availability widgets and payment gateways.** TripBuddy
  links out to booking sites and settles up through the users' own UPI apps
  (Phase G).
- **Background "agents"** (price watch, scouts): they need scheduled jobs,
  and Render's free tier sleeps.
- **Voice mode and dictation:** browser dictation is an optional later extra.
- **Creator program and social follows.**
- **Copying Mindtrip's visual identity.** We use the TripBuddy palette,
  logo, text and photos.

## Order and rough size

| Phase | Size | Depends on |
|---|---|---|
| A Chat conversations | L | — |
| B Chat-first home | S | A |
| C Explore side panel + add-to-trip | M | D (Ideas shelf) for "+" landing |
| D Trip Ideas/tabs/preferences | M | — |
| E Collections + Updates | M | — |
| F Guides | L | A |
| G Bookings, receipts, UPI settle-up | M | D (Bookings tab) |

**Suggested order:** A, then D, C, B, E, and F if time allows.

## Testing

- **Backend:** pytest per endpoint with recorded LLM replies (no live calls
  in CI), in the existing Docker test setup.
- **Frontend:** extend `frontend/e2e/journey.spec.ts` to run home → chat →
  create trip → see the plan on the board, plus axe checks on the new pages
  (NFR-6).
