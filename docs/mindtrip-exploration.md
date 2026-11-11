# Mindtrip exploration notes

Explored 2026-11-01 as an anonymous (not signed-in) visitor, in Chrome.
These notes describe what each screen does and how it behaves, in our own
words, as a reference for building similar features into TripBuddy. They do
not reproduce Mindtrip's text, images or branding.

## Not explored

- **Sign-in only:** Agents (`/agents`), Setup assistant, and anything tied to
  a saved account. Clicking any of these opens a "Log in or sign up" screen
  with email, Google and Apple options.
- **Did not load:** the Guides tab inside Explore kept showing loading
  skeletons.
- **Not clicked:** Upload a booking receipt, voice mode, Share, Creator Hub's
  "Create guide" flow, and Trips → Receipts/Calendar with real data.

## Global layout

- **Dark theme.** Near-black background, white text, rounded cards with
  photos, and pill-shaped buttons.
- **Left icon rail** (always visible, expands to show labels):
  - Home, Chats, Trips, Agents, Explore, Saved, Updates, Inspiration, Create.
  - "New chat" button.
  - Profile chip ("Traveler" when anonymous) with a menu.
  - Footer links: Company, Contact, Help, Terms, Privacy.
- **Drawers vs pages.** Chats and Updates open as slide-out drawers over the
  page, not new pages.
- **Anonymous sessions.** You can chat, explore and even create a trip
  without signing in. A "Sign up to save trip" nudge appears on anything you
  create. The first visit runs a Cloudflare bot check before the anonymous
  session is created.
- **Persistent chat box.** The "Ask …" input sits at the bottom of Home, of
  the place detail panel, and of chat. It has an attach (+) button, dictation
  (mic) and voice mode.
- **URL-driven state.** For example `/explore?loc=<id>&type=guide&ref=<placeId>`,
  so views are shareable.
- **Cookie banner** along the bottom, with a single Dismiss button.

## Home (`/home`)

- **Top row: category pills** for Stays, Flights, Eats, Experiences, Events
  and Trips. Each pill opens the same modal pattern:
  - A heading asking what you want (for example, what kind of stay).
  - A free-text box with an example placeholder, a character counter (500)
    and a mic.
  - Three optional structured rows: **Where** (select destination), **When**
    (select dates), **Who** (add people).
  - A primary action, such as "Find stays". This turns the request into a chat.
- **Hero.** The assistant introduces itself and offers to learn how you
  travel. "Setup assistant" requires sign-in.
- **Four large gradient action cards:**
  - Finish setting up my assistant.
  - Plan a trip (illustrated with a mini itinerary card).
  - Get local recommendations.
  - Upload a booking receipt.
- **"More things I can do" box.** Three agent ideas: flight price watch,
  restaurant scout, weekly local gems. A "Put me to work" button leads to
  sign-in.
- **Chat input pinned at the bottom.**

## Explore (`/explore`)

- **Split layout.** Results list on the left, a large interactive map on the
  right. The map is dark-styled, with category icons (hotel, restaurant,
  temple) and clusters showing counts like "17". It has controls for locate
  me, layers, zoom and a "show/hide labels" eye. A collapse arrow hides the
  map.
- **Location switcher** (the city name with a chevron at the top left):
  - A search box with autocomplete; typing "Hampi" shows "Hampi, India" with
    a thumbnail.
  - "Use current location".
  - Defaults to your approximate location (it picked a nearby city for us).
- **Search bar and Filters button.** The Filters modal has:
  - Budget: four price levels (₹ to ₹₹₹₹), multi-select.
  - Community toggles: "only places often mentioned in community guides" and
    "only places from guides by people you follow".
  - A "Show places" button.
- **Tabs:** For you, Experiences, Restaurants, Stays, Locations, Guides. "For
  you" shows horizontal sections per category, each with "See more".
- **Place card:**
  - A photo carousel with dots.
  - Heart (save) and + (add to trip) buttons over the image.
  - Name, star rating with review count, category with an icon, and the
    city and state.
  - A price level for restaurants and stays.
  - Social proof such as "Mentioned by <creator>" or "Saved by N people".
- **Clicking a card** opens a **detail panel** in place of the map (the URL
  gains `ref=`):
  - **Header actions:** close, collapse, Save, Add to trip, an AI/audio
    action, and Share.
  - **Title block:** name, rating, review count, location and category.
  - **Photo mosaic:** one large image and four small ones.
  - **Sub-tabs:** Overview, Activities, Reviews, Location.
  - **Overview:**
    - A description with "Read more".
    - A **booking widget** (Date, Party size, "Check availability", which
      opens a partner site).
    - Address with "Get directions", hours (open or closed now), website and
      phone.
    - **Suggested questions** about the place. Clicking one asks the
      assistant.
  - **Activities:** cards for bookable tours from partners.
  - **The chat input floats over the panel**, so you can ask about this place.

## Chat (`/chat/<id>`)

- **Starting a chat.** Typing in any "Ask" box creates a chat, and the URL
  becomes `/chat/<id>`.
- **Chat layout:**
  - **Left:** the conversation.
  - **Right:** a map showing every place mentioned in the reply, clustered,
    with a "Hampi & 12 others" label.
  - **Header:**
    - An auto-generated chat title with a rename dropdown.
    - **Context chips** pulled from the message: destination, number of
      days, number of travellers, budget level. They are clickable to edit.
    - **"Create a trip"** and Share buttons.
- **Reply format:**
  - The reply streams in, with a stop button while it generates.
  - Rich markdown: headings per section, emoji section icons, bullet lists
    and bold numbers.
  - Sections we saw: the assumptions it made, a budget breakdown by category
    with ranges and a total, a day-by-day plan (Day 1, 2, 3 with morning,
    afternoon and sunset), where to stay, a food plan and what to carry.
  - Ends with **one clarifying question** (for example, where are you
    travelling from).
- **Inline place mentions.** Each place in the reply carries a category icon
  and is linked to the map and to a place card.
- **Place card carousel** under the reply (heart and + on each).
- **"Looks like you're headed to X" banner** with a "Create trip" button.
- **Disclaimer** under the input saying the AI can make mistakes.
- **Chats drawer** (left rail): search, New chat, Set up my assistant,
  Personalization, and a list of past chats with their linked trip.

## Create trip modal (from chat, a place's "Add to trip", or Trips → New trip)

- **Heading:** what to keep in mind for this trip.
- **Free-text notes:** up to 2,000 characters, with a mic.
- **Where / When / Who rows.** These are **pre-filled from the chat
  context**; in our test, Hampi, 3 days and 2 adults.
- **"Create" button.** It opens the trip panel beside the chat.

## Trip panel / page

- **Header:** close, back, collapse, a "Sign up to save trip" nudge (when
  anonymous), "Go to trip" (full page), Share, and a more (…) menu.
- **Title and chips:** the trip name ("Trip to <place>"), then chips for
  destination, days, travellers, budget level and **Preferences**.
- **Tabs:** Itinerary, Ideas, Bookings, Calendar, Chats, Media, plus undo and
  redo buttons and a **Map** toggle.
- **Itinerary tab:**
  - An **Ideas** shelf at the top for unscheduled saved places, with "+ Add".
  - Below it, **Day 1, Day 2 …** sections, each collapsible with "+ Add".
- **Adding a place.** Clicking + on any place card adds it to the **Ideas**
  shelf of the current trip. A toast ("<place> added to <trip> · Change")
  lets you pick another trip.
- **Calendar tab:** a week-style grid with one column per trip day, rows by
  hour and an all-day row.
- **Preferences modal:** an empty state inviting dietary needs, travel quirks
  and special requests, with an "+ Add" button. These feed recommendations.
- **Bookings / Chats / Media:** per-trip lists of bookings, linked chats and
  uploaded photos (empty in our test).

## Trips list (`/trips`)

- **Tabs:** Trips, Calendar, Receipts.
- **Controls:** a "Booked only" toggle and an "All" filter.
- **Empty state:** an illustration, a short message and a "Create a trip"
  button.
- **"+ New trip"** button at the top right.

## Saved (`/saved`)

- **Tabs:** Collections, Places, Guides, each with a count.
- **Empty state** with a "Create a collection" button. Collections are named
  themed folders of saved places.

## Updates (left rail drawer)

- **Notifications feed:** tabs All, @mentions and Actions, plus an "Unreads"
  toggle.
- **Empty state** explains you'll be alerted when someone joins your trip or
  a creator you follow posts, with a "Get inspired" button.

## Inspiration (`/inspiration`)

- **Search** by location or creator handle.
- **"Featured guides" grid.** Each card shows a place count badge, cover
  photos, heart and +, the title, location and the creator's handle.
- **Guide page** (`/inspiration/<slug>`):
  - Left: a hero cover with the title, creator, place count, location and
    last-updated date, plus "Plan a trip" (starts a chat from the guide).
    Save, Add to trip and Share are at the top.
  - Tabs: Overview (the author's write-up) and Places. Places is an ordered
    list of the guide's places grouped by section, with a table of contents.
  - Right: a map of all the guide's places.

## Create / Creator Hub (`/create`)

- **Purpose:** for creators to write public guides.
- **Header:** "Creator Academy" and "Create guide" buttons.
- **Body:** a hero empty state and a carousel of example guide covers.
- **Terms link:** a creator program terms link at the bottom.

## Patterns worth copying

1. **One chat box everywhere.** Any screen can start or continue a
   conversation, and the context (place or trip) is carried along.
2. **Chat ↔ map ↔ cards ↔ trip are linked.** The places a reply mentions
   become map pins and cards, and one click adds them to a trip.
3. **Structured chips from free text.** Destination, days, people and budget
   are pulled out of the message and shown as editable chips. They pre-fill
   the trip.
4. **Ideas shelf → day plan.** Saving and scheduling are separate steps.
5. **Clarifying question at the end of each reply.**
6. **Empty states everywhere** with one clear call to action.
7. **Anonymous use first,** with a sign-up nudge only when you want to keep
   something.
