import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { createClient } from "@/lib/supabase/server";

/* ------------------------------------------------------------------ */
/* Data — every figure below comes from backend/data/destination_seed.csv
   (typical spend per person per day, best season) so the page never
   promises a price the catalogue doesn't hold. Photos are Wikimedia
   Commons images already used by the Discover page. */
/* ------------------------------------------------------------------ */

const WIKI = "https://upload.wikimedia.org/wikipedia/commons/";
const IMG = {
  gokarna: `${WIKI}d/dd/Delight_india.jpg`,
  kasol: `${WIKI}a/a2/Kasol_mountain_view.jpg`,
  jodhpur: `${WIKI}9/99/Mehrangarh_Fort_sanhita.jpg`,
  varkala: `${WIKI}4/49/Varkala_Beach%2C_Varkala%2C_Kerala.jpg`,
  araku: `${WIKI}b/b0/Araku-valley.jpg`,
  cherrapunji: `${WIKI}f/ff/Cherrapunji.jpg`,
  vagamon: `${WIKI}e/eb/Vagamon_meadows.JPG`,
  pelling: `${WIKI}b/b3/Sunrise_over_Kangchenjunga.jpg`,
};

const PICKS = [
  { name: "Gokarna", state: "Karnataka", spend: "₹1,200", season: "Oct–Mar", tags: ["beach", "backpacking"], img: IMG.gokarna },
  { name: "Kasol", state: "Himachal Pradesh", spend: "₹1,100", season: "Mar–Jun", tags: ["backpacking", "trekking"], img: IMG.kasol },
  { name: "Jodhpur", state: "Rajasthan", spend: "₹1,800", season: "Oct–Mar", tags: ["heritage", "food"], img: IMG.jodhpur },
  { name: "Varkala", state: "Kerala", spend: "₹1,800", season: "Oct–Mar", tags: ["beach", "wellness"], img: IMG.varkala },
  { name: "Araku Valley", state: "Andhra Pradesh", spend: "₹1,500", season: "Oct–Mar", tags: ["nature", "trekking"], img: IMG.araku },
  { name: "Cherrapunji", state: "Meghalaya", spend: "₹1,700", season: "Oct–May", tags: ["nature", "trekking"], img: IMG.cherrapunji },
  { name: "Vagamon", state: "Kerala", spend: "₹1,700", season: "Sep–Mar", tags: ["nature", "adventure"], img: IMG.vagamon },
  { name: "Pelling", state: "Sikkim", spend: "₹1,900", season: "Mar–May", tags: ["nature", "photography"], img: IMG.pelling },
];

const COLLECTIONS = [
  { title: "Beach escapes", places: "Gokarna · Varkala · Puri", img: IMG.gokarna },
  { title: "Himalayan hideouts", places: "Kasol · Dharamshala · Bir", img: IMG.kasol },
  { title: "Heritage on a shoestring", places: "Hampi · Jodhpur · Orchha", img: IMG.jodhpur },
  { title: "Rain & waterfalls", places: "Cherrapunji · Dawki · Vagamon", img: IMG.cherrapunji },
  { title: "Valleys & viewpoints", places: "Araku · Pelling · Ziro", img: IMG.araku },
];

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

type IconName = "pin" | "users" | "wallet" | "shield" | "sparkle" | "compass" | "arrow" | "check";

const ICONS: Record<IconName, ReactNode> = {
  pin: (
    <>
      <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  wallet: (
    <>
      <rect x="2" y="6" width="20" height="14" rx="3" />
      <path d="M2 10h20M16 14.5h2" />
      <path d="M5 6l11-3v3" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" />,
  compass: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m16 8-2 6-6 2 2-6 6-2Z" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  check: <path d="m5 12 5 5 9-10" />,
};

function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {ICONS[name]}
    </svg>
  );
}

/** Photo with a colour wash underneath, so a slow or blocked image degrades to a tinted tile. */
function Photo({
  src,
  sizes,
  priority,
  className = "",
}: {
  src: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden bg-gradient-to-br from-indigo-300 to-brand-coral/60 ${className}`}>
      <Image src={src} alt="" fill sizes={sizes} priority={priority} className="object-cover" />
    </div>
  );
}

function Swoosh({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 600 300" fill="none" aria-hidden="true" className={`overflow-visible ${className}`}>
      <path
        d="M-20 270C110 40 290 10 340 150S520 290 640 60"
        stroke="currentColor"
        strokeWidth="68"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Frameless product card — the app is a responsive website, so no phone bezel. */
function Screen({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`relative mx-auto w-[260px] overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl ${className}`}
    >
      {children}
    </div>
  );
}

function Avatar({ letter, tone }: { letter: string; tone: string }) {
  return (
    <span
      className={`flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[9px] font-bold text-white ${tone}`}
    >
      {letter}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Product screens — illustrative UI built from the app's real features   */
/* ------------------------------------------------------------------ */

function TripScreen() {
  const rows = [
    ["Day 1", "Kudle Beach sunset", "₹600"],
    ["Day 2", "Om Beach to Half Moon trek", "₹900"],
    ["Day 3", "Beach shack dinner", "₹450"],
  ];
  return (
    <div className="px-4 pb-5 pt-4">
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-bold text-foreground">My trips</p>
        <span className="flex -space-x-1.5">
          <Avatar letter="A" tone="bg-brand-teal" />
          <Avatar letter="R" tone="bg-brand-coral" />
          <Avatar letter="S" tone="bg-indigo-400" />
        </span>
      </div>
      <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-white">
        <Photo src={IMG.gokarna} sizes="250px" className="relative h-28 w-full" />
        <div className="p-3">
          <p className="text-[13px] font-bold text-foreground">Gokarna long weekend</p>
          <p className="text-[10px] text-text-muted">4 days · 3 travellers</p>
          <div className="mt-2.5 flex justify-between text-[10px] font-bold text-foreground">
            <span>₹11,800 planned</span>
            <span className="text-text-muted">of ₹15,000</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-surface-alt">
            <div className="h-full w-[79%] rounded-full bg-brand-coral" />
          </div>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {rows.map(([day, what, cost]) => (
          <div key={day} className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-[10px]">
            <span className="rounded-md bg-surface-alt px-1.5 py-0.5 font-bold text-brand-teal">{day}</span>
            <span className="flex-1 font-medium text-foreground">{what}</span>
            <span className="font-bold text-brand-coral-ink">{cost}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiscoverScreen() {
  const rows = [
    { name: "Gokarna", note: "Oct–Mar · beach", cost: "₹1,200", img: IMG.gokarna },
    { name: "Kasol", note: "Mar–Jun · trekking", cost: "₹1,100", img: IMG.kasol },
    { name: "Varkala", note: "Oct–Mar · beach", cost: "₹1,800", img: IMG.varkala },
  ];
  return (
    <div className="px-4 pb-5 pt-4">
      <p className="text-[15px] font-bold text-foreground">Discover</p>
      <div className="mt-2.5 flex items-center justify-between rounded-full border border-line-input bg-white px-3 py-2 text-[10px]">
        <span className="font-medium text-text-muted">Max budget per day</span>
        <span className="font-bold text-brand-teal">₹2,000</span>
      </div>
      <div className="mt-2.5 flex gap-1.5 text-[9px] font-bold">
        <span className="rounded-full bg-brand-teal px-2.5 py-1 text-white">Beach</span>
        <span className="rounded-full bg-surface-alt px-2.5 py-1 text-brand-teal">Trek</span>
        <span className="rounded-full bg-surface-alt px-2.5 py-1 text-brand-teal">Heritage</span>
      </div>
      <div className="mt-3 space-y-2">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center gap-2.5 rounded-xl border border-line bg-white p-2">
            <Photo src={r.img} sizes="44px" className="relative h-11 w-11 shrink-0 rounded-lg" />
            <div className="flex-1">
              <p className="text-[11px] font-bold text-foreground">{r.name}</p>
              <p className="text-[9px] text-text-muted">{r.note}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-bold text-brand-coral-ink">{r.cost}</p>
              <p className="text-[8px] text-text-subtle">per day</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex h-14 items-center justify-center rounded-xl bg-surface-alt text-[9px] font-bold text-indigo-500">
        <Icon name="pin" className="mr-1 h-3.5 w-3.5" /> Live map of places near you
      </div>
    </div>
  );
}

function BuddyScreen() {
  const chips = ["3 shared interests", "Same budget style", "Both want Goa", "10–25 km"];
  return (
    <div className="px-4 pb-5 pt-4">
      <p className="text-[15px] font-bold text-foreground">Buddies near you</p>
      <div className="mt-3 rounded-2xl border border-line bg-white p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-teal text-sm font-bold text-white">A</span>
          <div className="flex-1">
            <p className="text-[12px] font-bold text-foreground">Ananya, 22</p>
            <p className="text-[9px] text-text-muted">Bengaluru area</p>
          </div>
          <span
            className="flex h-11 w-11 items-center justify-center rounded-full"
            style={{ background: "conic-gradient(#e8674c 86%, #eef2ef 0)" }}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-[10px] font-bold text-foreground">86</span>
          </span>
        </div>
        <p className="mt-3 text-[9px] font-bold uppercase tracking-wide text-text-subtle">Why you matched</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span key={c} className="rounded-full bg-brand-coral-tint px-2 py-1 text-[9px] font-bold text-brand-coral-ink">
              {c}
            </span>
          ))}
        </div>
        <div className="mt-3 rounded-full bg-brand-teal py-2 text-center text-[10px] font-bold text-white">Connect</div>
      </div>
      <div className="mt-2.5 flex items-center gap-2.5 rounded-2xl border border-line bg-white p-3 opacity-70">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-coral text-xs font-bold text-white">R</span>
        <div className="flex-1">
          <p className="text-[11px] font-bold text-foreground">Rohan, 24</p>
          <p className="text-[9px] text-text-muted">Common language · Similar budget</p>
        </div>
        <span className="text-[10px] font-bold text-foreground">78</span>
      </div>
    </div>
  );
}

function PlanScreen() {
  return (
    <div className="px-4 pb-5 pt-4">
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-bold text-foreground">Hampi · Day 2</p>
        <span className="rounded-full bg-surface-alt px-2 py-1 text-[9px] font-bold text-brand-teal">AI draft</span>
      </div>
      <div className="mt-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[9px] font-medium leading-snug text-amber-900">
        Heads up: these dates fall outside Hampi’s best season (Oct–Feb).
      </div>
      <div className="mt-2.5 space-y-2">
        <div className="rounded-xl border border-line bg-white px-3 py-2.5 text-[10px]">
          <div className="flex justify-between">
            <span className="font-bold text-foreground">Coracle ride</span>
            <span className="font-bold text-brand-coral-ink">₹300</span>
          </div>
          <p className="mt-0.5 text-text-muted">Morning · Tungabhadra river</p>
        </div>
        <div className="rounded-xl border border-line bg-white px-3 py-2.5 text-[10px]">
          <div className="flex justify-between">
            <span className="font-bold text-foreground">Rooftop dinner</span>
            <span className="font-bold text-brand-coral-ink">₹2,400</span>
          </div>
          <span className="mt-1 inline-block rounded-full bg-amber-100 px-1.5 py-0.5 text-[8px] font-bold text-amber-800">
            ⚠ pricier than usual
          </span>
        </div>
        <div className="rounded-xl border border-dashed border-line-input px-3 py-2.5 text-center text-[10px] font-bold text-text-subtle">
          + drag to add or reorder
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-[10px] font-bold text-foreground">
        <span>Shared budget</span>
        <span className="text-text-muted">₹5,900 / ₹9,000</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-surface-alt">
        <div className="h-full w-[66%] rounded-full bg-brand-teal" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed-out visitors are sent to sign-up from anywhere in the app.
  const go = (path: string) => (user ? path : "/register");
  const primaryHref = go("/discover");

  const btnTeal =
    "inline-flex items-center justify-center gap-2 rounded-full bg-brand-teal px-6 py-3 text-sm font-bold text-background shadow-sm transition hover:brightness-110";
  const btnCoral =
    "cta-coral inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-bold shadow-md transition hover:brightness-105";

  return (
    <main className="flex-1 overflow-x-clip">
      {/* ---------- Top bar (the app nav is hidden on "/") ---------- */}
      <header className="absolute inset-x-0 top-0 z-30">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5">
          <Link href="/" aria-label="TripBuddy — home">
            <Image src="/brand/logo-horizontal.svg" alt="TripBuddy" width={150} height={24} priority className="h-6 w-auto" />
          </Link>
          <nav aria-label="Sections" className="hidden items-center gap-7 text-sm font-medium text-foreground md:flex">
            <a href="#features" className="hover:text-brand-coral-ink">Features</a>
            <a href="#picks" className="hover:text-brand-coral-ink">Destinations</a>
            <a href="#responsible" className="hover:text-brand-coral-ink">Responsible AI</a>
          </nav>
          <div className="flex items-center gap-3">
            {user ? (
              <Link href="/discover" className={btnTeal}>Open TripBuddy</Link>
            ) : (
              <>
                <Link href="/login" className="hidden text-sm font-bold text-brand-teal hover:text-brand-coral-ink sm:inline">
                  Log in
                </Link>
                <Link href="/register" className={btnTeal}>Start planning</Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="relative px-4 pt-28 text-center sm:pt-32">
        <a
          href="#responsible"
          className="inline-flex items-center gap-2 rounded-full border border-line bg-surface py-1.5 pl-1.5 pr-4 text-xs font-bold text-brand-teal"
        >
          <span className="rounded-full bg-brand-coral px-2 py-0.5 text-[10px] text-white">NEW</span>
          AI itineraries are now cost-checked
          <Icon name="arrow" className="h-3.5 w-3.5" />
        </a>
        <h1 className="mx-auto mt-6 max-w-3xl text-5xl leading-[1.02] tracking-tight sm:text-7xl">
          Big trips. Small budgets.{" "}
          <span className="text-brand-coral">Better together.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-text-muted sm:text-lg">
          Discover destinations that fit what you can spend, match with travel buddies heading your way, and plan
          the whole trip together.
        </p>

        <form
          action={primaryHref}
          className="mx-auto mt-8 flex w-full max-w-lg items-center gap-2 rounded-full border border-line-input bg-white p-1.5 pl-5 shadow-sm"
        >
          <label htmlFor="hero-q" className="sr-only">Where to?</label>
          <input
            id="hero-q"
            name="q"
            placeholder="Try Goa, Manali, Jaipur…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-subtle"
          />
          <button type="submit" className={`${btnCoral} !px-6 !py-2.5`}>Search</button>
        </form>

        {/* Product card + tilted photo cards (full-bleed so the outer cards run off the edges) */}
        <div className="relative -mx-4 mt-14 h-[400px] overflow-clip sm:h-[500px]">
          <Swoosh className="absolute left-1/2 top-24 w-[900px] -translate-x-1/2 text-[#f6c8ba]" />

          <Photo src={IMG.kasol} sizes="200px" className="absolute top-24 hidden h-64 w-44 -rotate-12 rounded-3xl shadow-lg lg:left-1/2 lg:-ml-[600px] lg:block" />
          <Photo src={IMG.varkala} sizes="200px" className="absolute top-28 hidden h-64 w-44 rotate-12 rounded-3xl shadow-lg lg:left-1/2 lg:ml-[420px] lg:block" />

          <div className="absolute bottom-6 left-3 w-[34%] -rotate-6 sm:left-6 sm:w-[210px] lg:left-1/2 lg:-ml-[430px]">
            <Photo src={IMG.gokarna} sizes="220px" priority className="relative aspect-[3/4] w-full rounded-3xl shadow-xl" />
            <span className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold text-brand-teal">
              <Icon name="pin" className="h-3 w-3" /> Gokarna
            </span>
          </div>

          <div className="absolute bottom-6 right-3 w-[34%] rotate-6 sm:right-6 sm:w-[210px] lg:left-1/2 lg:right-auto lg:ml-[220px]">
            <Photo src={IMG.jodhpur} sizes="220px" priority className="relative aspect-[3/4] w-full rounded-3xl shadow-xl" />
            <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold text-brand-teal">
              <Icon name="pin" className="h-3 w-3" /> Jodhpur
            </span>
          </div>

          <div className="absolute left-1/2 top-0 -translate-x-1/2">
            <Screen>
              <TripScreen />
            </Screen>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-background to-transparent" />
        </div>
      </section>

      {/* ---------- Pitch ---------- */}
      <section className="mx-auto w-full max-w-3xl px-4 pb-14 pt-20 text-center">
        <h2 className="text-4xl leading-tight tracking-tight sm:text-5xl">
          The only travel planner your group chat needs
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-text-muted">
          Discovery, buddy matching, itineraries, a shared budget and chat — in one place instead of fifteen tabs and a
          spreadsheet.
        </p>
        <div className="mt-7">
          <Link href={go("/discover")} className={btnTeal}>
            {user ? "Open TripBuddy" : "Start planning now"} <Icon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* ---------- Feature cards ---------- */}
      <section id="features" className="mx-auto w-full max-w-6xl space-y-5 px-4">
        <article className="brand-teal relative grid items-center gap-8 overflow-hidden rounded-[2rem] p-8 text-white sm:p-12 md:grid-cols-2">
          <div className="relative z-10">
            <Icon name="wallet" className="h-8 w-8 text-brand-coral" />
            <h3 className="mt-4 font-serif text-4xl leading-tight sm:text-5xl">Budget-first, always</h3>
            <p className="mt-4 max-w-md text-lg text-white/85">
              Tell us what you can spend per day. TripBuddy shows only the places that fit, with typical daily costs and
              the best season to go.
            </p>
            <ul className="mt-5 space-y-2 text-white/90">
              {["Filter by rupees per day", "Live map of places near you", "Best-season hints on every destination"].map((t) => (
                <li key={t} className="flex items-center gap-2 text-sm font-medium">
                  <Icon name="check" className="h-4 w-4 text-brand-coral" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative flex justify-center pt-4 md:pt-10">
            <Swoosh className="absolute -bottom-10 left-1/2 w-[520px] -translate-x-1/2 text-brand-coral/80" />
            <div className="relative h-[360px] overflow-hidden">
              <Screen><DiscoverScreen /></Screen>
            </div>
          </div>
        </article>

        <article className="relative grid items-center gap-8 overflow-hidden rounded-[2rem] bg-brand-coral-ink p-8 text-white sm:p-12 md:grid-cols-2">
          <div className="relative z-10">
            <Icon name="users" className="h-8 w-8 text-white" />
            <h3 className="mt-4 font-serif text-4xl leading-tight sm:text-5xl">Travel buddies, matched in the open</h3>
            <p className="mt-4 max-w-md text-lg text-white/90">
              Find people heading your way with similar interests and budget — and see exactly why you matched. No
              mystery score.
            </p>
            <ul className="mt-5 space-y-2">
              {["Ranked by interests, budget, language, age and distance", "Reasons shown as plain-language chips", "Only your area and a distance range are ever shared"].map((t) => (
                <li key={t} className="flex items-center gap-2 text-sm font-medium">
                  <Icon name="check" className="h-4 w-4" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative flex justify-center pt-4 md:pt-10">
            <Swoosh className="absolute -bottom-10 left-1/2 w-[520px] -translate-x-1/2 text-[#f08a70]" />
            <div className="relative h-[360px] overflow-hidden">
              <Screen><BuddyScreen /></Screen>
            </div>
          </div>
        </article>

        <article className="relative grid items-center gap-8 overflow-hidden rounded-[2rem] bg-[#f3d9c4] p-8 text-brand-teal sm:p-12 md:grid-cols-2">
          <div className="relative z-10">
            <Icon name="sparkle" className="h-8 w-8 text-brand-coral-ink" />
            <h3 className="mt-4 font-serif text-4xl leading-tight sm:text-5xl">Plan together, with guardrails</h3>
            <p className="mt-4 max-w-md text-lg text-foreground/80">
              Drag-and-drop itineraries, a shared budget and AI drafts that get sanity-checked against what the
              destination typically costs.
            </p>
            <ul className="mt-5 space-y-2 text-foreground/90">
              {["Day-by-day boards your whole crew can edit", "Track every rupee and settle up", "AI drafts flag costs and seasons that look off"].map((t) => (
                <li key={t} className="flex items-center gap-2 text-sm font-medium">
                  <Icon name="check" className="h-4 w-4 text-brand-coral-ink" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative flex justify-center pt-4 md:pt-10">
            <Swoosh className="absolute -bottom-10 left-1/2 w-[520px] -translate-x-1/2 text-brand-teal/20" />
            <div className="relative h-[360px] overflow-hidden">
              <Screen><PlanScreen /></Screen>
            </div>
          </div>
        </article>
      </section>

      {/* ---------- Collections carousel ---------- */}
      <section className="pt-24">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h2 className="text-4xl leading-tight tracking-tight sm:text-5xl">
            Trips that fit{" "}
            <span className="underline decoration-brand-coral decoration-wavy decoration-2 underline-offset-[10px]">
              every
            </span>{" "}
            budget
          </h2>
          <div className="mt-6">
            <Link href={primaryHref} className={btnTeal}>Browse all destinations</Link>
          </div>
        </div>
        <div
          role="region"
          aria-label="Trip collections"
          tabIndex={0}
          className="mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 [scrollbar-width:none] sm:px-8 lg:px-[max(2rem,calc((100vw-72rem)/2))]"
        >
          {COLLECTIONS.map((c) => (
            <Link
              key={c.title}
              href={primaryHref}
              className="group relative aspect-[3/4] w-[260px] shrink-0 snap-start overflow-hidden rounded-3xl sm:w-[280px]"
            >
              <Photo src={c.img} sizes="280px" className="absolute inset-0 transition duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#061c1d]/85 via-[#061c1d]/10 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-5 text-white">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/75">Collection</p>
                <p className="mt-1 font-serif text-2xl leading-tight">{c.title}</p>
                <p className="mt-1 text-xs text-white/80">{c.places}</p>
                <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-brand-teal">
                  Explore <Icon name="arrow" className="h-3 w-3" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ---------- Budget picks grid ---------- */}
      <section id="picks" className="mx-auto w-full max-w-6xl px-4 pt-24">
        <div className="text-center">
          <h2 className="text-4xl leading-tight tracking-tight sm:text-5xl">
            Our budget picks across{" "}
            <span className="underline decoration-brand-coral decoration-wavy decoration-2 underline-offset-[10px]">
              India
            </span>
          </h2>
          <p className="mt-3 text-sm text-text-muted">Typical spend per person per day, from our destination catalogue.</p>
        </div>
        <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-4">
          {PICKS.map((p) => (
            <Link key={p.name} href={primaryHref} className="group block">
              <Photo src={p.img} sizes="(min-width:1024px) 280px, 45vw" className="relative aspect-[3/4] w-full rounded-2xl">
              </Photo>
              <p className="mt-3 text-base font-bold text-foreground group-hover:text-brand-coral-ink">{p.name}</p>
              <p className="text-xs text-text-muted">{p.state}</p>
              <p className="mt-1 text-sm font-bold text-brand-coral-ink">
                {p.spend} <span className="text-xs font-medium text-text-muted">/ day · best {p.season}</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {p.tags.map((t) => (
                  <span key={t} className="rounded-full bg-surface-alt px-2.5 py-0.5 text-[11px] font-bold capitalize text-brand-teal">
                    {t}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
        <div className="mt-10 text-center">
          <Link href={primaryHref} className={btnTeal}>
            Show more <Icon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* ---------- Under the hood (real facts, no invented numbers) ---------- */}
      <section className="mx-auto w-full max-w-4xl px-4 pt-24 text-center">
        <h2 className="text-4xl leading-tight tracking-tight sm:text-5xl">Built with care, not hype</h2>
        <dl className="mt-10 grid gap-8 sm:grid-cols-3">
          {[
            { icon: "compass" as const, n: "90+", l: "curated destinations, each with typical daily spend and best season" },
            { icon: "users" as const, n: "6", l: "tools in one place: discover, match, plan, budget, chat and AI drafts" },
            { icon: "shield" as const, n: "0", l: "exact coordinates ever shown to another traveller" },
          ].map((s) => (
            <div key={s.n} className="flex flex-col items-center">
              <Icon name={s.icon} className="h-8 w-8 text-brand-coral" />
              <dt className="mt-3 font-serif text-6xl leading-none text-brand-teal">{s.n}</dt>
              <dd className="mt-3 max-w-[16rem] text-sm text-text-muted">{s.l}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ---------- Responsible AI ---------- */}
      <section id="responsible" className="mx-auto w-full max-w-6xl px-4 pt-24">
        <div className="rounded-[2rem] border border-line bg-surface px-6 py-12 sm:px-12">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-coral-ink">Responsible AI</p>
            <h2 className="mt-3 text-4xl leading-tight tracking-tight sm:text-5xl">AI you can check, not just trust</h2>
            <p className="mt-4 text-text-muted">
              Travel plans involve your money and meeting strangers, so the AI parts of TripBuddy are built to be
              inspected.
            </p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              {
                icon: "users" as const,
                title: "Matching you can read",
                body: "Your buddy score is a plain weighted sum of interests, budget, language, age and distance — no trained black box — and every match shows the reasons behind it.",
              },
              {
                icon: "sparkle" as const,
                title: "Itineraries with guardrails",
                body: "AI drafts are checked against the destination’s typical spend and best season, and flagged when something looks off. Every draft carries a reminder that venues aren’t verified live.",
              },
              {
                icon: "shield" as const,
                title: "Privacy by design",
                body: "Other travellers see your area and a distance range, never coordinates. Chats are restricted at the database level to people whose connection you’ve accepted.",
              },
            ].map((c) => (
              <div key={c.title} className="rounded-2xl border border-line bg-white p-6">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-coral-tint text-brand-coral-ink">
                  <Icon name={c.icon} className="h-5 w-5" />
                </span>
                <h3 className="mt-4 font-serif text-2xl text-brand-teal">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-muted">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Final CTA + footer links ---------- */}
      <section className="brand-teal mt-24 text-white">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 pt-20 md:grid-cols-2">
          <div className="pb-4 md:pb-20">
            <h2 className="text-5xl leading-[1.05] tracking-tight text-white sm:text-6xl">
              Don’t just dream it. <span className="text-brand-coral">Budget it.</span>
            </h2>
            <p className="mt-4 max-w-md text-lg text-white/80">
              Join TripBuddy and start exploring places that fit what you can spend.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              {user ? (
                <Link href="/discover" className={btnCoral}>Start exploring</Link>
              ) : (
                <>
                  <Link href="/register" className={btnCoral}>Start planning for free</Link>
                  <Link
                    href="/login"
                    className="inline-flex items-center rounded-full border border-white/40 px-6 py-3 text-sm font-bold text-white transition hover:bg-white/10"
                  >
                    Sign in
                  </Link>
                </>
              )}
            </div>
          </div>
          <div className="relative flex justify-center">
            <Swoosh className="absolute -bottom-6 left-1/2 w-[560px] -translate-x-1/2 text-indigo-500" />
            <div className="relative h-[380px] overflow-hidden">
              <Screen><DiscoverScreen /></Screen>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10">
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-[1.5fr_1fr_1fr]">
            <div>
              <Image src="/brand/logo-horizontal-reversed.svg" alt="TripBuddy" width={150} height={24} className="h-6 w-auto" />
              <p className="mt-3 max-w-xs text-white/70">Budget-first travel planning for people who’d rather spend on the trip.</p>
            </div>
            <div>
              <p className="font-bold text-white">Explore</p>
              <ul className="mt-3 space-y-2 text-white/70">
                <li><Link href={go("/discover")} className="hover:text-white">Discover</Link></li>
                <li><Link href={go("/buddies")} className="hover:text-white">Find buddies</Link></li>
                <li><Link href={go("/trips")} className="hover:text-white">Plan a trip</Link></li>
              </ul>
            </div>
            <div>
              <p className="font-bold text-white">Account</p>
              <ul className="mt-3 space-y-2 text-white/70">
                {user ? (
                  <li><Link href="/profile" className="hover:text-white">Profile</Link></li>
                ) : (
                  <>
                    <li><Link href="/register" className="hover:text-white">Create account</Link></li>
                    <li><Link href="/login" className="hover:text-white">Log in</Link></li>
                  </>
                )}
              </ul>
            </div>
          </div>
          <p className="mx-auto w-full max-w-6xl px-4 pb-6 text-xs text-white/50">
            Destination photos are from Wikimedia Commons contributors; credits are listed on each destination page.
          </p>
        </div>
      </section>
    </main>
  );
}
