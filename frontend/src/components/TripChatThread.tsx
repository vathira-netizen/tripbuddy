"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  listTripMessages,
  markTripChatRead,
  MAX_BODY_LENGTH,
  sendTripMessage,
} from "@/lib/messages";
import { dayLabels, getTrip, listItineraryItems } from "@/lib/trips";
import { ChatPanel, type ChatSource } from "@/components/ChatPanel";

/** The group chat for one trip — every owner/collaborator is in it. */
export function TripChatThread({
  tripId,
  title,
  members,
}: {
  tripId: number;
  title: string;
  members: string[];
}) {
  const [sharing, setSharing] = useState(false);

  const source = useMemo<ChatSource>(
    () => ({
      list: () => listTripMessages(tripId).then((p) => p.results),
      send: (body) => sendTripMessage(tripId, body),
      markRead: () => markTripChatRead(tripId),
    }),
    [tripId],
  );

  /** Posts the current itinerary into the chat as a plain-text summary. */
  const shareItinerary = async () => {
    setSharing(true);
    try {
      const [trip, items] = await Promise.all([getTrip(tripId), listItineraryItems(tripId)]);
      if (items.length === 0) {
        toast.info("Add something to the itinerary first.");
        return;
      }
      const labels = dayLabels(trip.start_date, trip.nights);
      const lines = [`📍 ${trip.title} — itinerary`];
      for (const day of [...new Set(items.map((i) => i.day_index))].sort((a, b) => a - b)) {
        lines.push("", labels[day] ?? `Day ${day + 1}`);
        items.filter((i) => i.day_index === day).forEach((i) => lines.push(`• ${i.title}`));
      }
      let body = lines.join("\n");
      if (body.length > MAX_BODY_LENGTH) body = body.slice(0, MAX_BODY_LENGTH - 1) + "…";
      await source.send(body);
      toast.success("Itinerary shared with the group");
    } catch {
      toast.error("Couldn't share the itinerary. Try again.");
    } finally {
      setSharing(false);
    }
  };

  return (
    <ChatPanel
      source={source}
      group
      avatar={
        <span
          aria-hidden="true"
          className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-brand-teal text-base text-background"
        >
          👥
        </span>
      }
      title={title}
      subtitle={members.join(", ")}
      composerExtra={
        <button
          type="button"
          onClick={shareItinerary}
          disabled={sharing}
          title="Post the current itinerary to the group"
          className="h-[38px] shrink-0 rounded-full border border-[#d5d9d0] px-3 text-xs font-bold text-brand-teal transition hover:border-brand-teal disabled:opacity-60"
        >
          {sharing ? "Sharing…" : "Share plan"}
        </button>
      }
    />
  );
}
