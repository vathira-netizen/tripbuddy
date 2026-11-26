"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Avatar } from "@/components/Avatar";
import { DeleteAccount } from "@/components/DeleteAccount";
import { SignOutButton } from "@/components/SignOutButton";
import { type Connection, listConnections, profileFacts, titleCase } from "@/lib/buddies";
import { listSaved, type SavedDestination } from "@/lib/discover";
import type { Profile } from "@/lib/schemas";
import { isPastTrip, listTrips, type Trip } from "@/lib/trips";

// A small picture per interest, for the "highlights" row under the bio.
const INTEREST_EMOJI: Record<string, string> = {
  adventure: "🧗",
  beach: "🏖️",
  backpacking: "🎒",
  culture: "🎭",
  food: "🍛",
  heritage: "🏛️",
  hiking: "🥾",
  history: "📜",
  nature: "🌿",
  nightlife: "🌃",
  photography: "📷",
  pilgrimage: "🛕",
  shopping: "🛍️",
  trekking: "⛰️",
  wildlife: "🐅",
  wellness: "🧘",
};

type Tab = "trips" | "saved" | "buddies";

function Icon({ path, className = "" }: { path: string; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  heart:
    "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  pin: "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0ZM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  pencil: "M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z",
  check: "M20 6 9 17l-5-5",
};

/** The Instagram-style profile: header, stats, highlights and a tile grid. */
export default function ProfileView({
  profile,
  onEdit,
}: {
  profile: Profile;
  onEdit: () => void;
}) {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [saved, setSaved] = useState<SavedDestination[] | null>(null);
  const [buddies, setBuddies] = useState<Connection[] | null>(null);
  const [tab, setTab] = useState<Tab>("trips");

  useEffect(() => {
    listTrips().then(setTrips).catch(() => setTrips([]));
    listSaved().then(setSaved).catch(() => setSaved([]));
    listConnections({ status: "accepted" })
      .then(setBuddies)
      .catch(() => setBuddies([]));
  }, []);

  const facts = profileFacts(profile);
  const { percent, missing } = profile.completeness;

  const stats: { key: Tab; label: string; count: number | undefined }[] = [
    { key: "trips", label: "trips", count: trips?.length },
    { key: "buddies", label: "buddies", count: buddies?.length },
    { key: "saved", label: "saved", count: saved?.length },
  ];

  return (
    <main className="w-full flex-1 pb-16">
      {/* Soft brand band behind the header, full width. */}
      <div className="h-28 bg-gradient-to-r from-brand-teal via-[#1f5657] to-brand-coral sm:h-36" />

      <div className="mx-auto w-full max-w-4xl px-4">
        <header className="-mt-14 flex flex-col gap-5 sm:-mt-16 sm:flex-row sm:items-end sm:gap-8">
          {/* Story-style ring around the photo. */}
          <div className="w-fit shrink-0 rounded-full bg-gradient-to-tr from-brand-coral via-[#f2a65a] to-brand-teal p-[3px] shadow-lg">
            <div className="rounded-full bg-background p-[3px]">
              <Avatar
                name={profile.display_name || "?"}
                src={profile.avatar_url}
                seed={profile.supabase_user_id}
                size={128}
              />
            </div>
          </div>

          <div className="min-w-0 flex-1 sm:pb-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="truncate font-serif text-3xl leading-tight text-brand-teal">
                {profile.display_name || "Traveller"}
              </h1>
              {profile.email_verified && (
                <span
                  title="Email verified"
                  className="grid h-5 w-5 place-items-center rounded-full bg-brand-teal text-background"
                >
                  <Icon path={ICONS.check} className="h-3 w-3" />
                  <span className="sr-only">Email verified</span>
                </span>
              )}
              <div className="flex gap-2 sm:ml-auto">
                <button
                  type="button"
                  onClick={onEdit}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand-teal px-4 py-2 text-sm font-bold text-background transition hover:brightness-90"
                >
                  <Icon path={ICONS.pencil} className="h-3.5 w-3.5" />
                  Edit profile
                </button>
                <SignOutButton className="rounded-xl border border-line-input bg-white px-4 py-2 text-sm font-semibold text-text-muted transition hover:border-brand-teal hover:text-brand-teal" />
              </div>
            </div>

            <ul className="mt-3 flex gap-6 text-sm">
              {stats.map((s) => (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => setTab(s.key)}
                    className="text-text-muted hover:text-brand-teal"
                  >
                    <span className="font-bold tabular-nums text-brand-teal">
                      {s.count ?? "–"}
                    </span>{" "}
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </header>

        <section className="mt-5 max-w-2xl space-y-2">
          {facts.length > 0 && (
            <p className="text-sm font-semibold text-text-muted">{facts.join(" · ")}</p>
          )}
          {profile.area_label && (
            <p className="flex items-center gap-1.5 text-sm text-text-subtle">
              <Icon path={ICONS.pin} className="h-4 w-4 shrink-0" />
              {profile.area_label}
            </p>
          )}
          {profile.bio ? (
            <p className="whitespace-pre-line text-[15px] leading-relaxed text-foreground">
              {profile.bio}
            </p>
          ) : (
            <button
              type="button"
              onClick={onEdit}
              className="text-sm font-semibold text-brand-coral-ink hover:underline"
            >
              + Add a bio so buddies know how you travel
            </button>
          )}
          {(profile.travel_styles.length > 0 || profile.languages.length > 0) && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {profile.travel_styles.map((s) => (
                <span
                  key={s}
                  className="rounded-full bg-brand-teal/10 px-3 py-1 text-xs font-semibold capitalize text-brand-teal"
                >
                  {s}
                </span>
              ))}
              {profile.languages.length > 0 && (
                <span className="rounded-full border border-line-input px-3 py-1 text-xs text-text-muted">
                  Speaks {profile.languages.map(titleCase).join(", ")}
                </span>
              )}
            </div>
          )}
        </section>

        {percent < 100 && (
          <button
            type="button"
            onClick={onEdit}
            className="mt-5 flex w-full max-w-2xl items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-left transition hover:border-brand-teal"
          >
            <span
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-xs font-bold text-brand-teal"
              style={{
                background: `conic-gradient(var(--color-brand-coral) ${percent * 3.6}deg, var(--color-line) 0deg)`,
              }}
            >
              <span className="grid h-9 w-9 place-items-center rounded-full bg-surface">
                {percent}%
              </span>
            </span>
            <span className="min-w-0 text-sm">
              <span className="block font-semibold text-brand-teal">Finish your profile</span>
              <span className="block truncate text-text-subtle">
                Add {missing.slice(0, 2).join(" and ")}
                {missing.length > 2 ? ` and ${missing.length - 2} more` : ""} to get more
                buddy matches.
              </span>
            </span>
          </button>
        )}

        {profile.interests.length > 0 && (
          <section aria-label="Interests" className="mt-7">
            <ul className="-mx-4 flex gap-5 overflow-x-auto px-4 pb-2">
              {profile.interests.map((i) => (
                <li key={i} className="flex w-[72px] shrink-0 flex-col items-center gap-1.5">
                  <span className="grid h-[68px] w-[68px] place-items-center rounded-full border border-line bg-surface text-[28px] shadow-sm ring-2 ring-white">
                    {INTEREST_EMOJI[i] ?? "✨"}
                  </span>
                  <span className="text-xs text-text-muted">{titleCase(i)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Tabs, then the grid. */}
        <nav
          role="tablist"
          aria-label="Profile sections"
          className="mt-6 flex justify-center gap-10 border-t border-line"
        >
          {(
            [
              ["trips", "Trips", ICONS.grid],
              ["saved", "Saved", ICONS.heart],
              ["buddies", "Buddies", ICONS.users],
            ] as const
          ).map(([key, label, path]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`-mt-px flex items-center gap-1.5 border-t-2 pt-3 text-xs font-bold uppercase tracking-widest transition ${
                tab === key
                  ? "border-brand-teal text-brand-teal"
                  : "border-transparent text-text-subtle hover:text-brand-teal"
              }`}
            >
              <Icon path={path} className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>

        <div role="tabpanel" className="mt-4">
          {tab === "trips" && <TripsGrid trips={trips} />}
          {tab === "saved" && <SavedGrid saved={saved} />}
          {tab === "buddies" && <BuddiesGrid buddies={buddies} />}
        </div>

        <DeleteAccount />
      </div>
    </main>
  );
}

function Empty({ text, href, cta }: { text: string; href: string; cta: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line-input py-12 text-center">
      <p className="text-sm text-text-subtle">{text}</p>
      <Link href={href} className="mt-2 inline-block text-sm font-bold text-brand-coral-ink hover:underline">
        {cta}
      </Link>
    </div>
  );
}

function Loading() {
  return (
    <div className="grid grid-cols-3 gap-1 sm:gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="aspect-square animate-pulse rounded-lg bg-surface-alt" />
      ))}
    </div>
  );
}

function TripsGrid({ trips }: { trips: Trip[] | null }) {
  if (!trips) return <Loading />;
  if (trips.length === 0) {
    return <Empty text="No trips yet." href="/trips" cta="Plan your first trip →" />;
  }
  return (
    <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3 sm:gap-2">
      {trips.map((t, i) => {
        const past = isPastTrip(t);
        return (
          <li key={t.id}>
            <Link
              href={`/trips/${t.id}`}
              className="group relative block aspect-square overflow-hidden rounded-lg"
            >
              {t.cover_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- user-uploaded cover
                <img
                  src={t.cover_image_url}
                  alt=""
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                />
              ) : (
                <div
                  className={`h-full w-full bg-gradient-to-br ${
                    i % 2 === 0
                      ? "from-brand-teal to-[#1f5657]"
                      : "from-brand-coral-ink to-brand-coral"
                  }`}
                />
              )}
              <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 via-black/10 to-transparent p-3 text-white">
                <p className="line-clamp-2 font-serif text-lg leading-tight">{t.title}</p>
                <p className="mt-0.5 truncate text-[11px] text-white/80">
                  {[t.destination_name, t.start_date ?? "Dates TBD"].filter(Boolean).join(" · ")}
                </p>
              </div>
              {past && (
                <span className="absolute left-2 top-2 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                  Past
                </span>
              )}
              {t.collaborators.length > 0 && (
                <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-brand-teal">
                  👥 {t.collaborators.length + 1}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function SavedGrid({ saved }: { saved: SavedDestination[] | null }) {
  if (!saved) return <Loading />;
  if (saved.length === 0) {
    return <Empty text="Nothing saved yet." href="/discover" cta="Find places to save →" />;
  }
  return (
    <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3 sm:gap-2">
      {saved.map(({ id, destination: d }) => (
        <li key={id}>
          <Link
            href={`/discover/${d.slug}`}
            className="group relative block aspect-square overflow-hidden rounded-lg bg-surface-alt"
          >
            {d.image_url && (
              // eslint-disable-next-line @next/next/no-img-element -- external destination photo
              <img
                src={d.image_url}
                alt=""
                className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
              />
            )}
            <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/70 to-transparent p-3 text-white">
              <p className="font-serif text-lg leading-tight">{d.name}</p>
              <p className="text-[11px] text-white/80">{d.state}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function BuddiesGrid({ buddies }: { buddies: Connection[] | null }) {
  if (!buddies) return <Loading />;
  if (buddies.length === 0) {
    return <Empty text="No travel buddies yet." href="/buddies" cta="Find travel buddies →" />;
  }
  return (
    <ul className="grid grid-cols-3 gap-4 sm:grid-cols-5">
      {buddies.map((c) => (
        <li key={c.id}>
          <Link
            href={`/messages?c=${c.id}`}
            className="flex flex-col items-center gap-2 rounded-xl p-2 text-center transition hover:bg-surface-alt"
          >
            <Avatar
              name={c.other?.display_name ?? "?"}
              src={c.other?.avatar_url}
              seed={c.other?.supabase_user_id ?? String(c.id)}
              size={64}
            />
            <span className="w-full truncate text-xs font-semibold text-brand-teal">
              {c.other?.display_name ?? "Traveller"}
            </span>
            {c.other?.area_label && (
              <span className="-mt-1.5 w-full truncate text-[11px] text-text-subtle">
                {c.other.area_label.split(",")[0]}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
