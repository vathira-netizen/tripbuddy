"use client";

import { FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { updateChat, type ChatPlace, type Conversation } from "@/lib/chats";
import { applyItinerary, createTrip, type AssistantReply } from "@/lib/trips";
import { Button, FormError, Input, Select } from "@/components/ui";

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Create trip" button + dialog, pre-filled from what the chat has learned.
 * Creates the trip, optionally applies the latest plan to its itinerary, and
 * links the chat to it. */
export default function CreateTripFromChat({
  chat,
  places,
  plan,
}: {
  chat: Conversation;
  places: ChatPlace[];
  plan: AssistantReply["plan"] | undefined;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const ctx = chat.context;
  const guess = places.find((p) => p.name.toLowerCase() === ctx.destination?.toLowerCase()) ?? places[0];

  const [title, setTitle] = useState(ctx.destination ? `Trip to ${ctx.destination}` : chat.title);
  const [destination, setDestination] = useState(guess ? String(guess.id) : "");
  const [startDate, setStartDate] = useState("");
  const [days, setDays] = useState(String(ctx.days ?? (plan?.days.length || 3)));
  const [budget, setBudget] = useState(ctx.budget != null ? String(ctx.budget) : "");
  const [usePlan, setUsePlan] = useState(Boolean(plan));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const nights = Math.max(Number(days) - 1, 0);
      const trip = await createTrip({
        title: title.trim() || "My trip",
        destination: destination ? Number(destination) : null,
        start_date: startDate || null,
        end_date: startDate ? addDays(startDate, nights) : null,
        target_amount: budget || null,
      });
      if (usePlan && plan) await applyItinerary(trip.id, plan.days, false);
      await updateChat(chat.id, { trip: trip.id });
      router.push(`/trips/${trip.id}`);
    } catch {
      setError("Couldn't create the trip. Check the details and try again.");
      setSaving(false);
    }
  }

  if (chat.trip) {
    return (
      <Link
        href={`/trips/${chat.trip}`}
        className="rounded-full border border-line bg-white px-4 py-2 text-sm font-bold text-brand-teal hover:bg-surface"
      >
        Open trip
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="rounded-full bg-brand-coral px-4 py-2 text-sm font-bold text-white hover:brightness-95"
      >
        Create trip
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="create-trip-heading"
        className="m-auto w-[min(92vw,28rem)] rounded-[20px] border border-line p-0 backdrop:bg-black/40"
      >
        <form onSubmit={submit} className="space-y-3 p-5">
          <h2 id="create-trip-heading" className="font-serif text-xl text-brand-teal">
            Create a trip from this chat
          </h2>
          <Input label="Trip name" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          <Select label="Destination" value={destination} onChange={(e) => setDestination(e.target.value)}>
            <option value="">Not decided</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}, {p.state}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <Input label="Days" type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
          <Input label="Budget (₹, whole group)" type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} />
          {plan && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={usePlan} onChange={(e) => setUsePlan(e.target.checked)} />
              Add the suggested plan to the itinerary
            </label>
          )}
          <FormError message={error} />
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="w-full rounded-full border border-line px-5 py-2.5 text-sm font-bold"
            >
              Cancel
            </button>
            <Button type="submit" loading={saving}>
              Create trip
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
